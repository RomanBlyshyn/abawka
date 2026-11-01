// Поведінка CountryPicker: відкрити/закрити, пошук (без діакритики, за назвою, кодом чи «+48»),
// стрілки, Enter, Escape, клік поза списком. Значення — у прихованому input; при виборі шле input+change.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

/** Показати значення в кнопці (після вибору або відновлення чернетки). */
export function setPicker(hidden: HTMLInputElement, code: string) {
  const root = hidden.closest<HTMLElement>('[data-cp]')!;
  const opt = root.querySelector<HTMLElement>(`[data-code="${CSS.escape(code)}"]`);
  hidden.value = opt ? code : '';
  const text = root.querySelector<HTMLElement>('[data-cp-text]')!;
  text.textContent = opt ? (root.classList.contains('compact') ? opt.dataset.hint! : opt.dataset.label!) : '';
  root.querySelector<HTMLElement>('[data-cp-flag]')!.textContent = opt ? opt.querySelector('.cp-flag')!.textContent : '';
  root.querySelectorAll<HTMLElement>('[role=option]').forEach((o) => o.setAttribute('aria-selected', String(o === opt)));
}

export function initPickers(scope: ParentNode = document) {
  scope.querySelectorAll<HTMLElement>('[data-cp]:not([data-cp-ready])').forEach((root) => {
    root.dataset.cpReady = '';
    const btn = root.querySelector<HTMLButtonElement>('[data-cp-btn]')!;
    const pop = root.querySelector<HTMLElement>('[data-cp-pop]')!;
    const search = root.querySelector<HTMLInputElement>('[data-cp-search]')!;
    const hidden = root.querySelector<HTMLInputElement>('input[type=hidden]')!;
    const options = [...root.querySelectorAll<HTMLElement>('[role=option]')];
    const empty = root.querySelector<HTMLElement>('[data-cp-empty]')!;
    let active: HTMLElement | null = null;

    const visible = () => options.filter((o) => !o.hidden);
    const activate = (o: HTMLElement | null) => {
      active?.classList.remove('active');
      active = o;
      if (o) { o.classList.add('active'); o.scrollIntoView({ block: 'nearest' }); search.setAttribute('aria-activedescendant', o.id); }
      else search.removeAttribute('aria-activedescendant');
    };
    const open = () => {
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      search.value = '';
      filter();
      activate(options.find((o) => o.dataset.code === hidden.value) ?? visible()[0] ?? null);
      search.focus();
    };
    const close = (focusBtn = true) => {
      if (pop.hidden) return;
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (focusBtn) btn.focus();
    };
    const choose = (o: HTMLElement) => {
      setPicker(hidden, o.dataset.code!);
      close();
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    };
    function filter() {
      const q = norm(search.value.trim()).replace(/^\+/, '');
      for (const o of options) {
        o.hidden = q !== '' && !norm(`${o.dataset.label} ${o.dataset.code} ${o.dataset.hint}`).replace(/\+/g, '').includes(q);
      }
      // Розділювач після популярних — лише без пошуку.
      root.querySelector('[data-cp-list]')!.classList.toggle('searching', q !== '');
      empty.hidden = visible().length > 0;
      if (active?.hidden) activate(visible()[0] ?? null);
    }

    btn.addEventListener('click', () => (pop.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    search.addEventListener('input', () => { filter(); activate(visible()[0] ?? null); });
    search.addEventListener('keydown', (e) => {
      const list = visible();
      const i = active ? list.indexOf(active) : -1;
      if (e.key === 'ArrowDown') { e.preventDefault(); activate(list[Math.min(i + 1, list.length - 1)] ?? null); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activate(list[Math.max(i - 1, 0)] ?? null); }
      else if (e.key === 'Home') { e.preventDefault(); activate(list[0] ?? null); }
      else if (e.key === 'End') { e.preventDefault(); activate(list.at(-1) ?? null); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active) choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close(false);
    });
    options.forEach((o) => {
      o.addEventListener('click', () => choose(o));
      o.addEventListener('mousemove', () => { if (active !== o) activate(o); });
    });
    document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target as Node)) close(false); });
  });
}
