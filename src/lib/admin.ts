// Спільне для сторінок адмінки (працює в браузері).
import { supabase, currentRole, type StaffRole } from './supabase-client';
import { LOCALES, LOCALE_NAMES, type Locale } from '../i18n/config';

export { supabase };
export const ADMIN_LANGS = LOCALES;
export const LANG_NAMES = LOCALE_NAMES;
export type Localized = Partial<Record<Locale, string>>;

/** Пускає на сторінку лише команду магазину; інакше — на сторінку входу. */
export async function requireStaff(): Promise<{ email: string; role: StaffRole }> {
  const me = await currentRole().catch(() => null);
  if (!me) {
    location.replace('/admin/');
    throw new Error('redirect');
  }
  const who = document.querySelector<HTMLElement>('[data-who]');
  if (who) {
    who.querySelector('[data-who-email]')!.textContent = me.email;
    who.hidden = false;
  }
  const nav = document.querySelector<HTMLElement>('[data-who-nav]');
  if (nav) nav.hidden = false;
  document.querySelectorAll<HTMLElement>('[data-owner-only]').forEach((e) => (e.hidden = me.role !== 'owner'));
  document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
    await supabase?.auth.signOut();
    location.assign('/admin/');
  }));
  return me;
}

/** «19,99» або «19.99» → 1999 центів; порожнє → null; сміття → NaN. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
export const formatMoney = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '',
  ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'io', ъ: '', ł: 'l',
};
/** Адреса сторінки товару з назви: «Меч лицаря» → «mech-lytsaria», «Miecz rycerski» → «miecz-rycerski». */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Зрозуміле повідомлення про помилку бази. */
export function dbError(e: { code?: string; message?: string } | null): string {
  if (!e) return '';
  if (e.code === '23505') return 'Така адреса (slug) вже зайнята іншим записом — змініть її.';
  if (e.code === '23514') return 'Деякі поля заповнені неправильно — перевірте ціни, кількість і вік.';
  if (e.code === '23503') return 'Не можна видалити: на цей запис ще посилаються інші (наприклад, товари в категорії).';
  if (e.code === '42501' || e.code === 'PGRST301') return 'Немає прав на цю дію. Увійдіть знову.';
  return 'Не збережено. Перевірте інтернет і спробуйте ще раз — введене лишилося у формі.';
}

/**
 * Переклад через серверну функцію (ключ DeepL живе лише на сервері).
 * texts — поля однією мовою; повертає ті самі поля всіма мовами з targets.
 */
export async function translate(source: Locale, texts: Record<string, string>, targets: Locale[]) {
  const { data, error } = await supabase!.functions.invoke('translate', { body: { source, texts, targets } });
  if (error) throw error;
  return data.translations as Record<Locale, Record<string, string>>;
}

/** Попередження «є незбережені зміни» при спробі піти зі сторінки. */
export function guardUnsaved(isDirty: () => boolean) {
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
}
