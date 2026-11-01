// Дані продавця (src/data/shop.json) для юридичних і інфо-сторінок.
import data from '../data/shop.json';

/** null — клієнт ще не дав; сторінки показують позначку «to be added». */
export interface Shop {
  seller: string;
  address: { street: string; postcode: string | null; city: string; country: string };
  email: string | null;
  phone: string | null;
  telegram: string | null;
  hours: { from: string; to: string; timezone: string };
  shippingPaidBy: 'buyer' | 'seller';
  returnShippingPaidBy: 'buyer' | 'seller';
  legalUpdated: string;
}
export const shop = data as Shop;
export const hours = `${shop.hours.from}–${shop.hours.to}`;
