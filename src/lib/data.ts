// Єдина точка доступу до даних магазину. Читається один раз під час збірки (top-level await),
// у браузер не потрапляє нічого, крім уже зібраних сторінок.
//
// Джерело:
//   ABAWKA_TEST_DATA=1          → tests/fixtures/seed.json (e2e)
//   є PUBLIC_SUPABASE_URL і ключ → жива база Supabase; якщо вона недоступна — збірка падає,
//                                  щоб не викласти порожній чи застарілий сайт
//   інакше                      → src/data/seed.json (локально без .env)
import realSeed from '../data/seed.json';
import testSeed from '../../tests/fixtures/seed.json';
import type { Locale } from '../i18n/config';

export type Localized = Partial<Record<Locale, string>>;
export type Tint = 'pink' | 'yellow' | 'red' | 'blue' | 'green';

export interface Category { slug: string; icon: string; tint: Tint; name: Localized }
export interface Product {
  slug: string; category: string; name: Localized; description?: Localized;
  price: number; oldPrice?: number; ageMin: number; stock: number;
  hit: boolean; new: boolean; rating: number; reviews: number;
  /** Префікси фото в сховищі (без розміру й розширення), у порядку показу. */
  images?: string[];
}
export interface Slide { title: Localized; body: Localized; cta: Localized; href: string; tint: Tint; mascot: boolean }
export interface Review { author: string; country: string; rating: number; product: string; text: Localized }

interface ShopData {
  baseCurrency: string;
  categories: Category[];
  products: Product[];
  slides: Slide[];
  reviews: Review[];
}

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const testMode = process.env.ABAWKA_TEST_DATA === '1';

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY!, authorization: `Bearer ${SUPABASE_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]}: HTTP ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function fromSupabase(): Promise<ShopData> {
  // Публічний ключ: RLS віддає лише опубліковані товари, активні банери й схвалені відгуки.
  const [settings, categories, products, banners, reviews] = await Promise.all([
    rest<Row[]>('settings?select=base_currency'),
    rest<Row[]>('categories?select=slug,name,icon,tint&order=position,created_at'),
    rest<Row[]>('products?select=slug,name,description,price,old_price,stock,age_min,hit,is_new,category:categories(slug),images:product_images(path,position)&order=position,created_at'),
    rest<Row[]>('banners?select=title,body,cta,href,tint,mascot&active=is.true&order=position,created_at'),
    rest<Row[]>('reviews?select=author,country,rating,body,product:products(slug)&approved=is.true&order=created_at.desc'),
  ]);

  const stats = new Map<string, { sum: number; n: number }>();
  for (const r of reviews) {
    const s = stats.get(r.product.slug) ?? { sum: 0, n: 0 };
    stats.set(r.product.slug, { sum: s.sum + r.rating, n: s.n + 1 });
  }

  return {
    baseCurrency: settings[0]?.base_currency ?? 'EUR',
    categories: categories as Category[],
    products: products.map((p) => {
      const s = stats.get(p.slug);
      return {
        slug: p.slug,
        category: p.category.slug,
        name: p.name,
        description: p.description,
        price: p.price,
        oldPrice: p.old_price ?? undefined,
        ageMin: p.age_min,
        stock: p.stock,
        hit: p.hit,
        new: p.is_new,
        rating: s ? Math.round((s.sum / s.n) * 10) / 10 : 0,
        reviews: s?.n ?? 0,
        images: [...p.images].sort((a: Row, b: Row) => a.position - b.position).map((i: Row) => i.path),
      };
    }),
    slides: banners as Slide[],
    reviews: reviews.map((r) => ({ author: r.author, country: r.country, rating: r.rating, product: r.product.slug, text: r.body })),
  };
}

const data: ShopData = testMode
  ? (testSeed as unknown as ShopData)
  : SUPABASE_URL && SUPABASE_KEY
    ? await fromSupabase()
    : (realSeed as unknown as ShopData);

export const BASE_CURRENCY = data.baseCurrency;
export const getCategories = (): Category[] => data.categories;
export const getProducts = (): Product[] => data.products;
export const getSlides = (): Slide[] => data.slides;
export const getReviews = (): Review[] => data.reviews;

/** Адреса фото у сховищі Supabase; розміри 400 / 800 / 1600 готує адмінка при завантаженні. */
export const imageUrl = (path: string, width: 400 | 800 | 1600) =>
  `${SUPABASE_URL}/storage/v1/object/public/catalog/${path}-${width}.webp`;

/** Текст потрібною мовою; якщо перекладу ще нема — англійська, потім польська, потім будь-яка. */
export function pick(text: Localized | undefined, locale: Locale): string {
  if (!text) return '';
  return text[locale] || text.en || text.pl || Object.values(text).find(Boolean) || '';
}
