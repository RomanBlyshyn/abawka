-- Telegram-сповіщення про заявки (етап 3).
-- Людина з команди натискає «Підключити» в адмінці, відкриває бота за посиланням з одноразовим кодом
-- і тисне Start — бот запам'ятовує її чат. Нові заявки приходять у ці чати.
alter table public.staff
  add column telegram_chat_id bigint,
  add column telegram_code    text unique,
  add column telegram_code_at timestamptz;

-- pg_net надсилає HTTP-запит з бази вже після коміту. У тестах (PGlite) розширення немає — там заглушка net.http_post.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end
$$;

-- Після нової заявки — сигнал функції telegram: передаємо лише номер, саму заявку функція читає з бази.
-- Підроблений виклик нічого не дасть: функція шле тільки свіжі заявки, про які ще не сповіщала (notified_at).
create function public.requests_notify() returns trigger
  language plpgsql security definer set search_path = '' as
$$
begin
  perform net.http_post(
    url  := 'https://uvpoanwkoikudjdbreys.supabase.co/functions/v1/telegram',
    body := jsonb_build_object('request', new.id)
  );
  return null;
exception when others then
  return null; -- без сповіщення заявка однаково збережена й видна в адмінці
end
$$;
create trigger requests_notify after insert on public.requests
  for each row execute function public.requests_notify();
