// Тип сторінки за адресою — для лічильника переглядів (окремо від stats-client, щоб тестувати без збірки).
/** /pl/product/toy-sword/ → { page: 'product', product: 'toy-sword', locale: 'pl' } */
export function describePath(pathname: string): { page: string; product?: string; locale: string } {
  const [locale = '', section = '', slug = '', extra] = pathname.split('/').filter(Boolean);
  if (!section) return { page: 'home', locale };
  if (section === 'catalog') return { page: slug ? 'category' : 'catalog', locale };
  if (section === 'product' && slug && !extra) return { page: 'product', product: slug, locale };
  if (section === 'cart') return { page: 'cart', locale };
  return { page: 'other', locale };
}
