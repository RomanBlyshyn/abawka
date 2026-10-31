import type { Tint } from './data';

export interface AgeGroup { key: string; label: string; max: number; tint: Tint }

/** Групи для «Підбору за віком» і фільтра каталогу. Ключ іде в URL: ?age=3-5 */
export const AGE_GROUPS: AgeGroup[] = [
  { key: '0-2', label: '0–2', max: 2, tint: 'pink' },
  { key: '3-5', label: '3–5', max: 5, tint: 'yellow' },
  { key: '6-8', label: '6–8', max: 8, tint: 'blue' },
  { key: '9-99', label: '9+', max: 99, tint: 'green' },
];

/** Іграшка «від 3 років» підходить і 3–5, і 6–8, і 9+: важливо лише, щоб дитина вже доросла. */
export const fitsAge = (ageMin: number, group: Pick<AgeGroup, 'max'>) => ageMin <= group.max;
