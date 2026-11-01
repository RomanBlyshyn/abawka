-- Акції й промокоди (етап 5). Розділ «Акції» в адмінці — лише для власника (ТЗ, ролі).

-- ── Найнижча ціна за 30 днів до знижки (директива Omnibus) ────────────────────
-- Ціни, що діяли у 30 днях перед встановленням поточної ціни: записи історії в цьому вікні
-- плюс останній запис перед ним (він теж діяв на початку вікна). Немає історії — поточна ціна.
create view public.product_lowest_30d with (security_invoker = true) as
select p.id as product_id, coalesce(low.price, p.price) as lowest_30d
from public.products p
left join lateral (select max(changed_at) as since from public.price_history where product_id = p.id) cur on true
left join lateral (
  select min(h.price) as price
  from public.price_history h
  where h.product_id = p.id and h.changed_at < cur.since
    and (h.changed_at >= cur.since - interval '30 days'
         or h.changed_at = (select max(h2.changed_at) from public.price_history h2
                            where h2.product_id = p.id and h2.changed_at <= cur.since - interval '30 days'))
) low on true;
grant select on public.product_lowest_30d to anon, authenticated;

-- ── Акція на товари: знижка у відсотках і повернення цін ─────────────────────
-- Стара ціна = ціна до акції (якщо товар уже в акції — лишається та, що була до першої).
create function public.start_sale(product_ids uuid[], percent int) returns int
  language plpgsql set search_path = '' as
$$
declare n int;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if percent not between 1 and 90 then raise exception 'invalid:percent' using errcode = '23514'; end if;
  update public.products
     set old_price = coalesce(old_price, price),
         price = greatest(1, round(coalesce(old_price, price) * (100 - percent) / 100.0)::int)
   where id = any(product_ids);
  get diagnostics n = row_count;
  return n;
end
$$;

create function public.end_sale(product_ids uuid[]) returns int
  language plpgsql set search_path = '' as
$$
declare n int;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.products set price = old_price, old_price = null
   where id = any(product_ids) and old_price is not null;
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.start_sale(uuid[], int), public.end_sale(uuid[]) from public, anon;
grant execute on function public.start_sale(uuid[], int), public.end_sale(uuid[]) to authenticated;

-- ── Промокоди ────────────────────────────────────────────────────────────────
create table public.promo_codes (
  code       text primary key check (code ~ '^[A-Z0-9-]{3,30}$'),
  kind       text not null check (kind in ('percent', 'amount')),
  value      int not null check ((kind = 'percent' and value between 1 and 90) or (kind = 'amount' and value > 0)),
  min_total  int not null default 0 check (min_total >= 0),
  starts_at  timestamptz,
  ends_at    timestamptz,
  max_uses   int check (max_uses is null or max_uses > 0),
  used       int not null default 0 check (used >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);
alter table public.promo_codes enable row level security;
-- Покупці список кодів не бачать — лише перевіряють свій через check_promo().
create policy "owner manage promo codes" on public.promo_codes for all using (public.is_owner()) with check (public.is_owner());

-- Знижка за кодом для суми (у центах). Помилки: promo:invalid, promo:min:<мінімальна сума>.
create function public.promo_discount(p_code text, p_subtotal int, p_lock boolean default false)
  returns table (code text, discount int)
  language plpgsql security definer set search_path = '' as
$$
declare c public.promo_codes;
begin
  if p_lock then
    select * into c from public.promo_codes where promo_codes.code = upper(btrim(p_code)) for update;
  else
    select * into c from public.promo_codes where promo_codes.code = upper(btrim(p_code));
  end if;
  if not found or not c.active
     or (c.starts_at is not null and now() < c.starts_at)
     or (c.ends_at is not null and now() >= c.ends_at)
     or (c.max_uses is not null and c.used >= c.max_uses) then
    raise exception 'promo:invalid';
  end if;
  if p_subtotal < c.min_total then raise exception 'promo:min:%', c.min_total; end if;
  code := c.code;
  discount := least(p_subtotal, case when c.kind = 'percent' then round(p_subtotal * c.value / 100.0)::int else c.value end);
  return next;
end
$$;
revoke all on function public.promo_discount(text, int, boolean) from public, anon, authenticated;

-- Сума кошика за цінами з бази (без резерву) — для перевірки коду до надсилання заявки.
create function public.cart_subtotal(p_lines jsonb) returns int
  language plpgsql stable security definer set search_path = '' as
$$
declare v_line jsonb; v_price int; v_total int := 0; v_qty int;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then raise exception 'empty'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := case when (v_line->>'qty') ~ '^\d{1,2}$' then (v_line->>'qty')::int else 0 end;
    select price into v_price from public.products where slug = v_line->>'slug' and published;
    if not found or v_qty < 1 then raise exception 'invalid:lines'; end if;
    v_total := v_total + v_price * v_qty;
  end loop;
  return v_total;
end
$$;
revoke all on function public.cart_subtotal(jsonb) from public, anon, authenticated;

-- Кошик: «Застосувати» промокод. Повертає суму, знижку й підсумок — їх рахує сервер.
create function public.check_promo(payload jsonb) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare v_sub int := public.cart_subtotal(coalesce(payload->'lines', '[]'::jsonb)); d record;
begin
  select * into d from public.promo_discount(coalesce(payload->>'promo', ''), v_sub);
  return jsonb_build_object('code', d.code, 'subtotal', v_sub, 'discount', d.discount, 'total', v_sub - d.discount);
end
$$;
revoke all on function public.check_promo(jsonb) from public;
grant execute on function public.check_promo(jsonb) to anon, authenticated;

-- ── Заявка зі знижкою ─────────────────────────────────────────────────────────
alter table public.requests
  add column promo_code text,
  add column discount   int not null default 0 check (discount >= 0);

create or replace function public.requests_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if (new.locale, new.name, new.method, new.contact, new.country, new.delivery, new.comment, new.currency, new.total, new.items, new.created_at, new.promo_code, new.discount)
     is distinct from
     (old.locale, old.name, old.method, old.contact, old.country, old.delivery, old.comment, old.currency, old.total, old.items, old.created_at, old.promo_code, old.discount)
     or (new.ip is distinct from old.ip and new.ip <> '') then
    raise exception 'Змінювати можна лише статус і нотатку заявки';
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Скасована заявка не забирає використання промокоду; відновлена — забирає знову.
create function public.requests_promo_uses() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if new.promo_code is null then return null; end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.promo_codes set used = greatest(0, used - 1) where code = new.promo_code;
  elsif old.status = 'cancelled' and new.status <> 'cancelled' then
    update public.promo_codes set used = used + 1 where code = new.promo_code;
  end if;
  return null;
end
$$;
create trigger requests_promo_uses after update of status on public.requests
  for each row execute function public.requests_promo_uses();

create or replace function public.submit_request(payload jsonb) returns jsonb
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
  v_promo    text := btrim(coalesce(payload->>'promo', ''));
  v_headers  json := nullif(current_setting('request.headers', true), '')::json;
  v_ip       text := btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1));
  v_lines    jsonb := coalesce(payload->'lines', '[]'::jsonb);
  v_line     jsonb;
  v_product  record;
  v_items    jsonb := '[]'::jsonb;
  v_total    int := 0;
  v_qty      int;
  v_id       bigint;
  v_code     text;
  v_discount int := 0;
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

  -- Промокод: перевірка й знижка тут же, у тій самій транзакції; for update — ліміт використань не перевищать.
  if v_promo <> '' then
    select d.code, d.discount into v_code, v_discount from public.promo_discount(v_promo, v_total, true) d;
    update public.promo_codes set used = used + 1 where code = v_code;
  end if;

  insert into public.requests (locale, name, method, contact, country, delivery, comment, currency, total, items, ip, promo_code, discount)
  values (v_locale, v_name, v_method, v_contact, v_country, v_delivery, v_comment,
          (select base_currency from public.settings), v_total - v_discount, v_items, v_ip, v_code, v_discount)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end
$$;
