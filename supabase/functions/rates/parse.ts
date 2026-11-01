// Розбір відповідей ЄЦБ і НБУ. Без Deno API — тестується в Node.
export interface Rate { currency: string; per_eur: number; source: 'ECB' | 'NBU'; rate_date: string }

/** ЄЦБ, eurofxref-daily.xml: <Cube time="2026-11-02"> <Cube currency="USD" rate="1.0812"/> … */
export function parseEcb(xml: string, wanted: string[]): Rate[] {
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) throw new Error('ECB: no date');
  const out: Rate[] = [];
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const rate = Number(m[2]);
    if (wanted.includes(m[1]!) && rate > 0) out.push({ currency: m[1]!, per_eur: rate, source: 'ECB', rate_date: date });
  }
  return out;
}

/** НБУ, exchange?valcode=EUR&json: [{"cc":"EUR","rate":48.1234,"exchangedate":"03.11.2026"}] — гривень за 1 EUR. */
export function parseNbuEur(json: unknown): Rate {
  const row = Array.isArray(json) ? json.find((r) => r?.cc === 'EUR') : null;
  const rate = Number(row?.rate);
  const d = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(row?.exchangedate ?? ''));
  if (!(rate > 0) || !d) throw new Error('NBU: bad response');
  return { currency: 'UAH', per_eur: rate, source: 'NBU', rate_date: `${d[3]}-${d[2]}-${d[1]}` };
}
