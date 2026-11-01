-- Email у заявці — латиницею (як у браузері): без кирилиці, двох крапок підряд і крапки перед @.
-- Решта submit_request — без змін (див. 012).
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
    if v_contact !~ '^[A-Za-z0-9._%+-]+@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$' or v_contact ~ '(^\.|\.\.|\.@)' or length(v_contact) > 80 then raise exception 'invalid:contact'; end if;
  elsif v_method = 'telegram' then
    if v_contact !~ '^@?[A-Za-z0-9_]{5,32}$' and v_phone !~ '^\+[1-9]\d{7,14}$' then raise exception 'invalid:contact'; end if;
  elsif v_phone !~ '^\+[1-9]\d{7,14}$' then raise exception 'invalid:contact';
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
