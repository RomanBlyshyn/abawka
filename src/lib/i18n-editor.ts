// Редактор багатомовних полів для адмінки: вкладки 9 мов, поля для поточної мови, кнопка «Перекласти».
// Рендериться в JS, бо сторінки адмінки повністю клієнтські.
import { ADMIN_LANGS, LANG_NAMES, translate, type Localized } from './admin';
import type { Locale } from '../i18n/config';

export interface I18nField { key: string; label: string; multiline?: boolean; maxLength?: number; required?: boolean }

export class I18nEditor {
  readonly root: HTMLElement;
  private values: Record<string, Localized> = {};
  private lang: Locale = 'uk';
  private inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  private status: HTMLElement;
  onChange: () => void = () => {};

  constructor(private fields: I18nField[], idPrefix: string) {
    this.root = document.createElement('div');
    this.root.className = 'i18n-editor';

    const tabs = document.createElement('div');
    tabs.className = 'i18n-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Мова');
    for (const l of ADMIN_LANGS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.lang = l;
      b.title = LANG_NAMES[l];
      b.innerHTML = `${l.toUpperCase()}<span class="dot" aria-hidden="true"></span>`;
      b.addEventListener('click', () => { this.lang = l; this.render(); });
      tabs.append(b);
    }
    this.root.append(tabs);

    for (const f of fields) {
      const id = `${idPrefix}-${f.key}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.innerHTML = `${f.label} <span class="lang-label"></span>`;
      const input = f.multiline ? document.createElement('textarea') : document.createElement('input');
      input.id = id;
      if (input instanceof HTMLTextAreaElement) input.rows = 3; else input.type = 'text';
      input.maxLength = f.maxLength ?? 200;
      input.addEventListener('input', () => {
        (this.values[f.key] ??= {})[this.lang] = input.value;
        this.render();
        this.onChange();
      });
      this.inputs.set(f.key, input);
      this.root.append(label, input);
    }

    const row = document.createElement('div');
    row.className = 'i18n-translate';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-light';
    btn.textContent = 'Перекласти на інші мови';
    btn.addEventListener('click', () => this.translate(btn));
    this.status = document.createElement('span');
    this.status.className = 'hint';
    this.status.setAttribute('role', 'status');
    row.append(btn, this.status);
    this.root.append(row);
  }

  set(values: Record<string, Localized>) {
    this.values = Object.fromEntries(this.fields.map((f) => [f.key, { ...(values[f.key] ?? {}) }]));
    const first = this.fields[0]!.key;
    if (!this.values[first]?.[this.lang]) {
      const any = ADMIN_LANGS.find((l) => this.values[first]?.[l]?.trim());
      if (any) this.lang = any;
    }
    this.status.textContent = '';
    this.render();
  }

  /** Значення без порожніх мов. */
  get(): Record<string, Localized> {
    return Object.fromEntries(this.fields.map((f) => [f.key, Object.fromEntries(
      Object.entries(this.values[f.key] ?? {}).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v),
    ) as Localized]));
  }

  /** Перевірка обов'язкових полів: хоча б одна мова. Повертає текст помилки або ''. */
  validate(): string {
    const v = this.get();
    const missing = this.fields.filter((f) => f.required && !Object.keys(v[f.key] ?? {}).length);
    return missing.length ? `Заповніть «${missing.map((f) => f.label).join('», «')}» хоча б однією мовою.` : '';
  }

  private render() {
    for (const f of this.fields) {
      const input = this.inputs.get(f.key)!;
      const v = this.values[f.key]?.[this.lang] ?? '';
      if (input.value !== v) input.value = v; // лише якщо змінилось — інакше курсор стрибав би
    }
    this.root.querySelectorAll('.lang-label').forEach((e) => (e.textContent = LANG_NAMES[this.lang]));
    const main = this.fields[0]!.key;
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
      const l = b.dataset.lang as Locale;
      b.setAttribute('aria-selected', String(l === this.lang));
      b.classList.toggle('filled', Boolean(this.values[main]?.[l]?.trim()));
    });
  }

  private async translate(btn: HTMLButtonElement) {
    const source: Record<string, string> = {};
    for (const f of this.fields) {
      const t = this.values[f.key]?.[this.lang]?.trim();
      if (t) source[f.key] = t;
    }
    if (!Object.keys(source).length) { this.status.textContent = `Спершу заповніть поля мовою «${LANG_NAMES[this.lang]}».`; return; }
    const main = this.fields[0]!.key;
    const others = ADMIN_LANGS.filter((l) => l !== this.lang);
    let targets = others.filter((l) => !this.values[main]?.[l]?.trim());
    if (!targets.length) {
      if (!confirm(`Усі мови вже заповнені. Перекласти заново з мови «${LANG_NAMES[this.lang]}»? Ручні правки буде замінено.`)) return;
      targets = others;
    }
    btn.disabled = true;
    this.status.textContent = 'Перекладаємо…';
    try {
      const result = await translate(this.lang, source, targets);
      for (const l of targets) for (const k of Object.keys(source)) {
        if (result[l]?.[k]) (this.values[k] ??= {})[l] = result[l][k];
      }
      this.status.textContent = `Готово: ${targets.length} мов. Перевірте й збережіть.`;
      this.render();
      this.onChange();
    } catch {
      this.status.textContent = 'Переклад зараз недоступний. Мови можна заповнити вручну.';
    } finally {
      btn.disabled = false;
    }
  }
}
