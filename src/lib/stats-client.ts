// Лічильник переглядів для статистики власника: без cookies, без IP, без ідентифікаторів.
// Надсилаємо лише тип сторінки, товар, мову і назву сайту, з якого прийшли.
// Одна й та сама сторінка рахується раз за сесію вкладки, щоб оновлення не накручували лічильник.
import { describePath } from './stats-path';

const URL_ = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

export function trackView(): void {
  if (!URL_ || !KEY) return;
  const key = `seen:${location.pathname}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* приватний режим — рахуємо як є */ }
  let referrer = '';
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.host !== location.host && /^https?:$/.test(ref.protocol)) referrer = ref.hostname;
  } catch { /* дивний referrer — без джерела */ }
  fetch(`${URL_}/rest/v1/rpc/track_view`, {
    method: 'POST',
    keepalive: true,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ payload: { ...describePath(location.pathname), referrer } }),
  }).catch(() => { /* статистика не важливіша за сторінку */ });
}
