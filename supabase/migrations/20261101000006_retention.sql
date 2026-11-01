-- Строки зберігання персональних даних — ті самі, що в політиці конфіденційності (/privacy/):
--   IP-адреса потрібна лише проти спаму — стирається через 30 днів;
--   заявки без покупки (new, contacted, cancelled) — видаляються через 12 місяців;
--   покупки (paid, shipped, done) — через 5 років після кінця року покупки (податковий облік).

-- Стерти IP можна; решту змісту заявки, як і раніше, змінювати не можна.
create or replace function public.requests_guard() returns trigger
  language plpgsql set search_path = '' as
$$
begin
  if (new.locale, new.name, new.method, new.contact, new.country, new.delivery, new.comment, new.currency, new.total, new.items, new.created_at)
     is distinct from
     (old.locale, old.name, old.method, old.contact, old.country, old.delivery, old.comment, old.currency, old.total, old.items, old.created_at)
     or (new.ip is distinct from old.ip and new.ip <> '') then
    raise exception 'Змінювати можна лише статус і нотатку заявки';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create function public.cleanup_personal_data() returns void
  language sql security definer set search_path = '' as
$$
  update public.requests set ip = '' where ip <> '' and created_at < now() - interval '30 days';
  delete from public.requests where status in ('new', 'contacted', 'cancelled') and created_at < now() - interval '12 months';
  delete from public.requests where status in ('paid', 'shipped', 'done') and created_at < date_trunc('year', now()) - interval '5 years';
$$;
revoke all on function public.cleanup_personal_data() from public;

-- Щоночі о 03:17 UTC. У тестах (PGlite) pg_cron немає — функцію там викликаємо вручну.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cleanup-personal-data', '17 3 * * *', 'select public.cleanup_personal_data()');
  end if;
end
$$;
