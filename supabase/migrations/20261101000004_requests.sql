-- Заявки покупців (етап 3). Покупець не пише в таблицю напряму — лише через submit_request(),
-- яка перевіряє дані, перераховує суму за цінами з бази й резервує товар в одній транзакції.

create table public.requests (
  id          bigint generated always as identity (start with 1001) primary key,
  created_at  timestamptz not null default now(),
  status      text not null default 'new' check (status in ('new', 'contacted', 'paid', 'shipped', 'done', 'cancelled')),
  locale      text not null check (locale in ('pl','en','uk','de','cs','lt','es','fr','ru')),
  name        text not null check (length(name) between 2 and 60),
  method      text not null check (method in ('call', 'telegram', 'viber', 'whatsapp', 'email')),
  contact     text not null check (length(contact) between 3 and 80),
  country     text not null check (country ~ '^[A-Z]{2}$'),
  delivery    text not null check (delivery ~ '^[a-z0-9-]{1,40}$'),
  comment     text not null default '' check (length(comment) <= 500),
  currency    text not null,
  total       int not null check (total >= 0),
  -- Знімок на момент заявки: назва, ціна й кількість не зміняться, навіть якщо товар потім відредагують.
  items       jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  ip          text not null default '',
  staff_note  text not null default '' check (length(staff_note) <= 2000),
  notified_at timestamptz,
  updated_at  timestamptz not null default now()
);
create index requests_created_idx on public.requests (created_at desc);
create index requests_ip_idx on public.requests (ip, created_at desc);

alter table public.requests enable row level security;
create policy "staff read requests"   on public.requests for select using (public.is_staff());
create policy "staff update requests" on public.requests for update using (public.is_staff()) with check (public.is_staff());
create policy "owner delete requests" on public.requests for delete using (public.is_owner());
-- insert — лише через submit_request (security definer), прямого дозволу немає ні в кого.

-- Персонал міняє тільки статус і нотатку; зміст заявки — це те, що надіслав покупець.
create function public.requests_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if (new.locale, new.name, new.method, new.contact, new.country, new.delivery, new.comment, new.currency, new.total, new.items, new.ip, new.created_at)
     is distinct from
     (old.locale, old.name, old.method, old.contact, old.country, old.delivery, old.comment, old.currency, old.total, old.items, old.ip, old.created_at) then
    raise exception 'Змінювати можна лише статус і нотатку заявки';
  end if;
  new.updated_at := now();
  return new;
end
$$;
create trigger requests_guard before update on public.requests
  for each row execute function public.requests_guard();

-- Скасування повертає зарезервований товар на склад; відновлення зі «скасовано» — знову резервує.
create function public.requests_stock() returns trigger
  language plpgsql security definer set search_path = '' as
$$
declare item jsonb;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for item in select * from jsonb_array_elements(new.items) loop
      update public.products set stock = stock + (item->>'qty')::int where slug = item->>'slug';
    end loop;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    for item in select * from jsonb_array_elements(new.items) loop
      update public.products set stock = stock - (item->>'qty')::int where slug = item->>'slug';
      -- check (stock >= 0) зупинить, якщо товару вже не вистачає
    end loop;
  end if;
  return new;
end
$$;
create trigger requests_stock after update of status on public.requests
  for each row execute function public.requests_stock();

-- ── Подати заявку ───────────────────────────────────────────────────────────
-- Помилки повертаються кодами (message), які сайт перекладає мовою покупця:
--   invalid:<поле>, empty, stock:<slug>, rate_limited
create function public.submit_request(payload jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as
$$
declare
  v_name     text := btrim(coalesce(payload->>'name', ''));
  v_method   text := coalesce(payload->>'method', '');
  v_contact  text := btrim(coalesce(payload->>'contact', ''));
  v_phone    text := regexp_replace(btrim(coalesce(payload->>'contact', '')), '[\s().-]', '', 'g');
  v_country  text := coalesce(payload->>'country', '');
  v_delivery text := coalesce(nullif(payload->>'delivery', ''), 'discuss');
  v_comment  text := left(btrim(coalesce(payload->>'comment', '')), 500);
  v_locale   text := coalesce(payload->>'locale', '');
  v_headers  json := nullif(current_setting('request.headers', true), '')::json;
  v_ip       text := btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
  v_lines    jsonb := coalesce(payload->'lines', '[]'::jsonb);
  v_line     jsonb;
  v_product  record;
  v_items    jsonb := '[]'::jsonb;
  v_total    int := 0;
  v_qty      int;
  v_id       bigint;
begin
  -- Пастка для ботів: поле, якого людина не бачить. Відповідаємо «успіхом», нічого не зберігаючи.
  if coalesce(payload->>'website', '') <> '' then
    return jsonb_build_object('id', 0);
  end if;

  -- Не більше 5 заявок за 10 хвилин з однієї адреси.
  if v_ip <> '' and (select count(*) from public.requests where ip = v_ip and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited';
  end if;

  if length(v_name) not between 2 and 60 then raise exception 'invalid:name'; end if;
  if v_method not in ('call', 'telegram', 'viber', 'whatsapp', 'email') then raise exception 'invalid:method'; end if;
  if v_method = 'email' then
    if v_contact !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(v_contact) > 80 then raise exception 'invalid:contact'; end if;
  elsif v_method = 'telegram' then
    if v_contact !~ '^@?[A-Za-z0-9_]{5,32}$' and v_phone !~ '^\+?\d{9,15}$' then raise exception 'invalid:contact'; end if;
  elsif v_phone !~ '^\+?\d{9,15}$' then raise exception 'invalid:contact';
  end if;
  if v_country !~ '^[A-Z]{2}$' then raise exception 'invalid:country'; end if;
  if v_delivery !~ '^[a-z0-9-]{1,40}$' then raise exception 'invalid:delivery'; end if;
  if v_locale not in ('pl','en','uk','de','cs','lt','es','fr','ru') then v_locale := 'en'; end if;
  if coalesce((payload->>'consent')::boolean, false) is not true then raise exception 'invalid:consent'; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then raise exception 'empty'; end if;
  if jsonb_array_length(v_lines) > 50 then raise exception 'invalid:lines'; end if;

  -- Ціни й наявність — з бази, а не з браузера. for update: дві одночасні заявки не продадуть останню штуку двічі.
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_qty := case when (v_line->>'qty') ~ '^\d{1,2}$' then (v_line->>'qty')::int else 0 end;
    if v_qty < 1 then raise exception 'invalid:lines'; end if;
    select id, slug, name, price, stock into v_product
      from public.products where slug = v_line->>'slug' and published for update;
    if not found or v_product.stock < v_qty then raise exception 'stock:%', coalesce(v_line->>'slug', '?'); end if;
    update public.products set stock = stock - v_qty where id = v_product.id;
    v_total := v_total + v_product.price * v_qty;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'slug', v_product.slug, 'name', v_product.name, 'price', v_product.price, 'qty', v_qty));
  end loop;

  insert into public.requests (locale, name, method, contact, country, delivery, comment, currency, total, items, ip)
  values (v_locale, v_name, v_method, v_contact, v_country, v_delivery, v_comment,
          (select base_currency from public.settings), v_total, v_items, v_ip)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end
$$;

revoke all on function public.submit_request(jsonb) from public;
grant execute on function public.submit_request(jsonb) to anon, authenticated;
