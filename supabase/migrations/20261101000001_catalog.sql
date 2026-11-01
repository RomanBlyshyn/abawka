-- ABAWKA: каталог, банери, відгуки, персонал. Етап 2 (база) під адмінку етапу 4.
-- Тексти, що перекладаються, — jsonb виду {"pl": "...", "uk": "...", ...}.
-- Ціни — цілі числа в мінорних одиницях базової валюти (центи).

-- ── Персонал і ролі ─────────────────────────────────────────────────────────
create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('owner', 'manager')),
  created_at timestamptz not null default now()
);

-- security definer: політики інших таблиць можуть питати про роль, не маючи прав на staff.
create function public.is_staff() returns boolean
  language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.staff where user_id = auth.uid()) $$;

create function public.is_owner() returns boolean
  language sql stable security definer set search_path = '' as
$$ select exists (select 1 from public.staff where user_id = auth.uid() and role = 'owner') $$;

-- Перекладний текст: об'єкт, лише відомі мови, хоча б одна непорожня.
create function public.valid_i18n(t jsonb, required boolean default true) returns boolean
  language sql immutable set search_path = '' as
$$
  select jsonb_typeof(t) = 'object'
     and not exists (select 1 from jsonb_object_keys(t) k where k not in ('pl','en','uk','de','cs','lt','es','fr','ru'))
     and not exists (select 1 from jsonb_each(t) e where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 5000)
     and (not required or exists (select 1 from jsonb_each_text(t) e where length(trim(e.value)) > 0))
$$;

-- ── Каталог ─────────────────────────────────────────────────────────────────
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  name       jsonb not null check (public.valid_i18n(name)),
  icon       text not null default 'star' check (length(icon) <= 30),
  tint       text not null default 'pink' check (tint in ('pink', 'yellow', 'red', 'blue', 'green')),
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  category_id uuid not null references public.categories (id) on delete restrict,
  name        jsonb not null check (public.valid_i18n(name)),
  description jsonb not null default '{}' check (public.valid_i18n(description, false)),
  price       int not null check (price > 0 and price <= 100000000),
  old_price   int check (old_price is null or old_price > price),
  stock       int not null default 0 check (stock >= 0 and stock <= 100000),
  age_min     int not null default 3 check (age_min between 0 and 18),
  hit         boolean not null default false,
  is_new      boolean not null default false,
  published   boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);

-- Фото: path — префікс у сховищі; файли <path>-400.webp, -800.webp, -1600.webp готує адмінка перед завантаженням.
create table public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  path       text not null check (path ~ '^products/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

-- Історія цін для директиви Omnibus: «найнижча ціна за 30 днів до знижки».
create table public.price_history (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  price      int not null,
  changed_at timestamptz not null default now()
);
create index price_history_product_idx on public.price_history (product_id, changed_at desc);

-- security definer: історію пише тригер, хоча самим користувачам запис у неї заборонено.
create function public.products_price_history() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into public.price_history (product_id, price) values (new.id, new.price);
  end if;
  return null;
end
$$;
-- after, бо для insert потрібен уже існуючий рядок (зовнішній ключ історії).
create trigger products_price_history after insert or update of price on public.products
  for each row execute function public.products_price_history();
create function public.products_updated_at() returns trigger
  language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create trigger products_updated_at before update on public.products
  for each row execute function public.products_updated_at();

-- ── Головна: банери ─────────────────────────────────────────────────────────
create table public.banners (
  id         uuid primary key default gen_random_uuid(),
  title      jsonb not null check (public.valid_i18n(title)),
  body       jsonb not null default '{}' check (public.valid_i18n(body, false)),
  cta        jsonb not null default '{}' check (public.valid_i18n(cta, false)),
  href       text not null default 'catalog/' check (href ~ '^[a-z0-9/?=&_.-]*$' and length(href) <= 200),
  tint       text not null default 'pink' check (tint in ('pink', 'yellow', 'red', 'blue', 'green')),
  image_path text check (image_path is null or image_path ~ '^banners/[0-9a-f-]{36}$'),
  mascot     boolean not null default false,
  active     boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

-- ── Відгуки (на сайті лише після модерації) ─────────────────────────────────
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  author     text not null check (length(trim(author)) between 1 and 60),
  country    text not null default '' check (country ~ '^([A-Z]{2})?$'),
  rating     int not null check (rating between 1 and 5),
  body       jsonb not null check (public.valid_i18n(body)),
  approved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_product_idx on public.reviews (product_id) where approved;

-- ── Налаштування магазину (один рядок) ──────────────────────────────────────
create table public.settings (
  id            boolean primary key default true check (id),
  base_currency text not null default 'EUR' check (base_currency in ('EUR', 'PLN', 'UAH', 'USD')),
  contact_url   text not null default 'https://t.me/abawka' check (contact_url ~ '^https://'),
  reply_hours   int check (reply_hours is null or reply_hours between 1 and 168),
  updated_at    timestamptz not null default now()
);
insert into public.settings default values;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.staff          enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.product_images enable row level security;
alter table public.price_history  enable row level security;
alter table public.banners        enable row level security;
alter table public.reviews        enable row level security;
alter table public.settings       enable row level security;

-- Публічне читання: тільки те, що має бачити покупець.
create policy "public read categories" on public.categories for select using (true);
create policy "public read products"   on public.products   for select using (published or public.is_staff());
create policy "public read images"     on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id and (p.published or public.is_staff())));
create policy "public read prices"     on public.price_history for select using (true);
create policy "public read banners"    on public.banners  for select using (active or public.is_staff());
create policy "public read reviews"    on public.reviews  for select using (approved or public.is_staff());
create policy "public read settings"   on public.settings for select using (true);

-- Персонал (власник і менеджери) керує каталогом.
create policy "staff write categories" on public.categories     for all using (public.is_staff()) with check (public.is_staff());
create policy "staff write products"   on public.products       for all using (public.is_staff()) with check (public.is_staff());
create policy "staff write images"     on public.product_images for all using (public.is_staff()) with check (public.is_staff());
create policy "staff write banners"    on public.banners        for all using (public.is_staff()) with check (public.is_staff());
create policy "staff write reviews"    on public.reviews        for all using (public.is_staff()) with check (public.is_staff());
-- Історію цін пише лише тригер; руками її не змінює ніхто.

-- Налаштування й склад команди — тільки власник.
create policy "owner update settings" on public.settings for update using (public.is_owner()) with check (public.is_owner());
create policy "staff read staff"      on public.staff for select using (public.is_staff());
create policy "owner manage staff"    on public.staff for all using (public.is_owner()) with check (public.is_owner());

-- Власник не може випадково лишити магазин без власника.
create function public.keep_one_owner() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  if (tg_op = 'DELETE' and old.role = 'owner') or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    if (select count(*) from public.staff where role = 'owner' and user_id <> old.user_id) = 0 then
      raise exception 'Магазин не може лишитися без власника';
    end if;
  end if;
  return coalesce(new, old);
end
$$;
create trigger staff_keep_owner before update or delete on public.staff
  for each row execute function public.keep_one_owner();

-- ── Сховище фото: читати можуть усі, змінювати — лише персонал ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog', 'catalog', true, 5 * 1024 * 1024, array['image/webp', 'image/jpeg', 'image/png']);

create policy "staff upload catalog" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalog' and public.is_staff());
create policy "staff update catalog" on storage.objects for update to authenticated
  using (bucket_id = 'catalog' and public.is_staff());
create policy "staff delete catalog" on storage.objects for delete to authenticated
  using (bucket_id = 'catalog' and public.is_staff());
