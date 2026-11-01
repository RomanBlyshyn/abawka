-- Статистика для власника (етап 6): без cookies і без IP — лише лічильники за день.
-- Що рахуємо: перегляди сторінок за типом, перегляди товарів, мову сайту, сайт, з якого прийшли.
create table public.daily_stats (
  day    date not null default current_date,
  metric text not null check (metric in ('page', 'product', 'locale', 'referrer')),
  key    text not null check (key ~ '^[a-z0-9._-]{1,100}$'),
  n      int not null default 0 check (n >= 0),
  primary key (day, metric, key)
);
alter table public.daily_stats enable row level security;
create policy "owner read stats" on public.daily_stats for select using (public.is_owner());

-- Відмітка перегляду з сайту. Приймає лише відомі значення: товар має існувати, мова — з дев'яти,
-- джерело — ім'я сайту (без адреси сторінки, щоб не зберігати нічого зайвого).
create function public.track_view(payload jsonb) returns void
  language plpgsql security definer set search_path = '' as
$$
declare
  v_page    text := coalesce(payload->>'page', '');
  v_product text := coalesce(payload->>'product', '');
  v_locale  text := coalesce(payload->>'locale', '');
  v_ref     text := regexp_replace(lower(coalesce(payload->>'referrer', '')), '^www\.', '');
begin
  if v_page not in ('home', 'catalog', 'category', 'product', 'cart', 'other') then return; end if;
  insert into public.daily_stats (metric, key, n) values ('page', v_page, 1)
    on conflict (day, metric, key) do update set n = daily_stats.n + 1;
  if v_product <> '' and exists (select 1 from public.products where slug = v_product and published) then
    insert into public.daily_stats (metric, key, n) values ('product', v_product, 1)
      on conflict (day, metric, key) do update set n = daily_stats.n + 1;
  end if;
  if v_locale in ('pl','en','uk','de','cs','lt','es','fr','ru') then
    insert into public.daily_stats (metric, key, n) values ('locale', v_locale, 1)
      on conflict (day, metric, key) do update set n = daily_stats.n + 1;
  end if;
  if v_ref ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and length(v_ref) <= 100 then
    insert into public.daily_stats (metric, key, n) values ('referrer', v_ref, 1)
      on conflict (day, metric, key) do update set n = daily_stats.n + 1;
  end if;
end
$$;
revoke all on function public.track_view(jsonb) from public;
grant execute on function public.track_view(jsonb) to anon, authenticated;

-- Зведення за період для сторінки «Статистика» (лише власник).
create function public.shop_stats(p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = '' as
$$
declare
  v_req   jsonb;
  v_views jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  with r as (
    select * from public.requests where created_at >= p_from and created_at < p_to + 1
  ), items as (
    select i->>'slug' as slug, coalesce(i->'name'->>'uk', i->'name'->>'en', i->>'slug') as name, (i->>'qty')::int as qty
    from r cross join jsonb_array_elements(r.items) i where r.status <> 'cancelled'
  )
  select jsonb_build_object(
    'total',     (select count(*) from r),
    'cancelled', (select count(*) from r where status = 'cancelled'),
    'sold',      (select count(*) from r where status in ('paid', 'shipped', 'done')),
    'revenue',   (select coalesce(sum(total), 0) from r where status in ('paid', 'shipped', 'done')),
    'by_day',    (select coalesce(jsonb_object_agg(d, n), '{}') from (select created_at::date as d, count(*) as n from r group by 1) x),
    'products',  (select coalesce(jsonb_agg(x order by x.qty desc, x.name), '[]') from (select slug, max(name) as name, sum(qty) as qty from items group by slug order by 3 desc limit 10) x),
    'countries', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select country as key, count(*) as n from r group by 1 order by 2 desc limit 10) x),
    'locales',   (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select locale as key, count(*) as n from r group by 1 order by 2 desc) x)
  ) into v_req;

  select jsonb_build_object(
    'pages',     (select coalesce(sum(n), 0) from public.daily_stats where metric = 'page' and day between p_from and p_to),
    'by_day',    (select coalesce(jsonb_object_agg(day, n), '{}') from (select day, sum(n) as n from public.daily_stats where metric = 'page' and day between p_from and p_to group by 1) x),
    'products',  (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select key, sum(n) as n from public.daily_stats where metric = 'product' and day between p_from and p_to group by 1 order by 2 desc limit 10) x),
    'locales',   (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select key, sum(n) as n from public.daily_stats where metric = 'locale' and day between p_from and p_to group by 1 order by 2 desc) x),
    'referrers', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (select key, sum(n) as n from public.daily_stats where metric = 'referrer' and day between p_from and p_to group by 1 order by 2 desc limit 10) x)
  ) into v_views;

  return jsonb_build_object('requests', v_req, 'views', v_views);
end
$$;
revoke all on function public.shop_stats(date, date) from public, anon;
grant execute on function public.shop_stats(date, date) to authenticated;
