// Єдина точка доступу до даних. На етапі 2 тіло функцій заміниться на запити до Supabase, сигнатури лишаться.
import realSeed from '../data/seed.json';
import testSeed from '../../tests/fixtures/seed.json';
import type { Locale } from '../i18n/config';

// E2E-тести збирають сайт на тестовому наборі (ABAWKA_TEST_DATA=1), щоб не залежати від справжніх товарів.
// Дані читаються лише під час збірки, у браузер жоден із наборів не потрапляє.
const seed = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ABAWKA_TEST_DATA === '1' ? testSeed : realSeed;

export type Localized = Partial<Record<Locale, string>>;
export type Tint = 'pink' | 'yellow' | 'red' | 'blue' | 'green';

export interface Category { slug: string; icon: string; tint: Tint; name: Localized }
export interface Product {
  slug: string; category: string; name: Localized;
  price: number; oldPrice?: number; ageMin: number; stock: number;
  hit: boolean; new: boolean; rating: number; reviews: number;
}
export interface Slide { key: string; tint: Tint; href: string; mascot: boolean }
export interface Review { author: string; country: string; rating: number; product: string; text: Localized }

export const BASE_CURRENCY = seed.baseCurrency;
export const getCategories = (): Category[] => seed.categories as Category[];
export const getProducts = (): Product[] => seed.products as Product[];
export const getSlides = (): Slide[] => seed.slides as Slide[];
export const getReviews = (): Review[] => seed.reviews as Review[];

/** Текст потрібною мовою; якщо перекладу ще нема — англійська, потім польська. */
export function pick(text: Localized, locale: Locale): string {
  return text[locale] ?? text.en ?? text.pl ?? '';
}
