-- Відгуки від покупців без акаунтів (етап 5): форма на сайті → перевірка в адмінці → публікація.
-- Відгук може бути про конкретний товар або про магазин загалом (product_id = null).
alter table public.reviews
  alter column product_id drop not null,
  add column locale      text not null default 'en' check (locale in ('pl','en','uk','de','cs','lt','es','fr','ru')),
  add column ip          text not null default '',
  add column notified_at timestamptz;
create index reviews_ip_idx on public.reviews (ip, created_at desc);
drop index public.reviews_product_idx;
create index reviews_approved_idx on public.reviews (created_at desc) where approved;

-- Персонал публікує, ховає й видаляє; зміст відгуку — те, що написав покупець.
create policy "staff delete reviews" on public.reviews for delete using (public.is_staff());
create function public.reviews_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if (new.product_id, new.author, new.country, new.rating, new.body, new.locale, new.created_at)
     is distinct from (old.product_id, old.author, old.country, old.rating, old.body, old.locale, old.created_at)
     or (new.ip is distinct from old.ip and new.ip <> '') then
    raise exception 'Змінювати можна лише публікацію відгуку';
  end if;
  return new;
end
$$;
create trigger reviews_guard before update on public.reviews
  for each row execute function public.reviews_guard();

-- ── Надіслати відгук ──────────────────────────────────────────────────────────
-- Помилки кодами, які сайт перекладає: invalid:<поле>, rate_limited.
create function public.submit_review(payload jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_name    text := btrim(coalesce(payload->>'name', ''));
  v_text    text := btrim(coalesce(payload->>'text', ''));
  v_rating  text := coalesce(payload->>'rating', '');
  v_locale  text := coalesce(payload->>'locale', '');
  v_slug    text := coalesce(payload->>'product', '');
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip      text := btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
  v_product uuid;
begin
  if coalesce(payload->>'website', '') <> '' then return jsonb_build_object('ok', true); end if; -- пастка для ботів
  if v_ip <> '' and (select count(*) from public.reviews where ip = v_ip and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'rate_limited';
  end if;
  if length(v_name) not between 2 and 40 then raise exception 'invalid:name'; end if;
  if v_rating !~ '^[1-5]$' then raise exception 'invalid:rating'; end if;
  if length(v_text) not between 10 and 1000 then raise exception 'invalid:text'; end if;
  if coalesce((payload->>'consent')::boolean, false) is not true then raise exception 'invalid:consent'; end if;
  if v_locale not in ('pl','en','uk','de','cs','lt','es','fr','ru') then v_locale := 'en'; end if;
  if v_slug <> '' then
    select id into v_product from public.products where slug = v_slug and published;
    if not found then raise exception 'invalid:product'; end if;
  end if;
  insert into public.reviews (product_id, author, rating, body, locale, ip)
  values (v_product, v_name, v_rating::int, jsonb_build_object(v_locale, v_text), v_locale, v_ip);
  return jsonb_build_object('ok', true);
end
$$;
revoke all on function public.submit_review(jsonb) from public;
grant execute on function public.submit_review(jsonb) to anon, authenticated;

-- Новий відгук — сигнал функції telegram (як і для заявок): власник дізнається, що є що перевірити.
create function public.reviews_notify() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  perform net.http_post(
    url  := 'https://uvpoanwkoikudjdbreys.supabase.co/functions/v1/telegram',
    body := jsonb_build_object('review', new.id)
  );
  return null;
exception when others then
  return null;
end
$$;
create trigger reviews_notify after insert on public.reviews
  for each row execute function public.reviews_notify();

-- IP відгуків, як і заявок, — лише проти спаму: стирається через 30 днів.
create or replace function public.cleanup_personal_data() returns void
  language sql security definer set search_path = '' as
$$
  update public.requests set ip = '' where ip <> '' and created_at < now() - interval '30 days';
  update public.reviews set ip = '' where ip <> '' and created_at < now() - interval '30 days';
  delete from public.requests where status in ('new', 'contacted', 'cancelled') and created_at < now() - interval '12 months';
  delete from public.requests where status in ('paid', 'shipped', 'done') and created_at < date_trunc('year', now()) - interval '5 years';
$$;
