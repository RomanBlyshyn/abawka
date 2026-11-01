-- «Оновити сайт» в адмінці: коли востаннє запускали перезбірку на Netlify (пише функція publish).
alter table public.settings add column published_at timestamptz;
