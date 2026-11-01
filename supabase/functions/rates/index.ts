// Edge Function: оновити курси валют (EUR→PLN/USD від ЄЦБ, EUR→UAH від НБУ).
// Кличе pg_cron щодня; без перевірки JWT, тому частіше ніж раз на годину нічого не робить.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseEcb, parseNbuEur, type Rate } from './parse.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);
  const { data: last } = await db.from('exchange_rates').select('updated_at').neq('currency', 'EUR').order('updated_at').limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.updated_at) < 3600e3) return reply({ skipped: 'fresh' });

  // Кожне джерело окремо: якщо одне недоступне, інше однаково оновиться, а старий курс лишиться.
  const rates: Rate[] = [];
  const errors: string[] = [];
  try {
    const res = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', { signal: AbortSignal.timeout(15_000) });
    rates.push(...parseEcb(await res.text(), ['PLN', 'USD']));
  } catch (e) { errors.push(`ECB: ${e}`); }
  try {
    const res = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&json', { signal: AbortSignal.timeout(15_000) });
    rates.push(parseNbuEur(await res.json()));
  } catch (e) { errors.push(`NBU: ${e}`); }

  if (rates.length) {
    const { error } = await db.from('exchange_rates').upsert(rates.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
    if (error) errors.push(`db: ${error.message}`);
  }
  if (errors.length) console.error(errors.join('; '));
  return reply({ updated: rates.map((r) => r.currency), errors }, errors.length && !rates.length ? 502 : 200);
});
