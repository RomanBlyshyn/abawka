-- Курси валют для перемикача на сайті (етап 6). Ціни й заявки — у базовій валюті (settings.base_currency),
-- інші валюти — лише орієнтовний показ. Курс — скільки одиниць валюти за 1 EUR.
create table public.exchange_rates (
  currency   text primary key check (currency ~ '^[A-Z]{3}$'),
  per_eur    numeric(14, 6) not null check (per_eur > 0),
  source     text not null check (source in ('ECB', 'NBU', 'fixed')),
  rate_date  date not null,
  updated_at timestamptz not null default now()
);
alter table public.exchange_rates enable row level security;
-- Читати може будь-хто (сайт), писати — лише функція rates (service role, повз RLS).
create policy "public read rates" on public.exchange_rates for select using (true);
insert into public.exchange_rates (currency, per_eur, source, rate_date) values ('EUR', 1, 'fixed', current_date);

-- Щодня о 16:30 UTC (ЄЦБ публікує курси близько 16:00 за центральноєвропейським часом).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('refresh-exchange-rates', '30 16 * * *',
      $job$ select net.http_post(url := 'https://uvpoanwkoikudjdbreys.supabase.co/functions/v1/rates', body := '{}'::jsonb) $job$);
  end if;
end
$$;
