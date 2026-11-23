/* Темы оформления M-o-chi.com: светлая/тёмная/кастом + конструктор и шеринг */
window.Theme = (() => {
  const KEY = 'mochi_theme';

  const DEFAULTS = {
    mode: 'dark',
    accent: '#ff5c8a',
    accent2: '#7c5cff',
    radius: 16,
    fontScale: 1,
    gradient: true,
  };

  const PRESETS = [
    { name: 'Моти',    accent: '#ff5c8a', accent2: '#7c5cff' },
    { name: 'Матча',   accent: '#3ecf8e', accent2: '#0ea5a4' },
    { name: 'Сакура',  accent: '#f472b6', accent2: '#fb923c' },
    { name: 'Океан',   accent: '#38bdf8', accent2: '#6366f1' },
    { name: 'Закат',   accent: '#fb7185', accent2: '#f59e0b' },
    { name: 'Виноград',accent: '#a78bfa', accent2: '#22d3ee' },
  ];

  let current = load();

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { ...DEFAULTS, ...saved };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(current));
  }

  /** Применить тему к документу */
  function apply(t = current) {
    current = t;
    const root = document.documentElement;
    root.setAttribute('data-theme', t.mode === 'light' ? 'light' : 'dark');
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent2', t.accent2);
    root.style.setProperty('--radius', `${t.radius}px`);
    root.style.setProperty('--font-scale', t.fontScale);
    document.body.classList.toggle('gradient-on', !!t.gradient);
    save();
  }

  function set(patch) {
    apply({ ...current, ...patch });
  }

  function reset() {
    apply({ ...DEFAULTS });
  }

  /** Код темы для шеринга (base64 JSON) */
  function encode(t = current) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(t))));
    } catch {
      return '';
    }
  }

  function decode(code) {
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      if (!obj || !['light', 'dark'].includes(obj.mode)) return null;
      return { ...DEFAULTS, ...obj };
    } catch {
      return null;
    }
  }

  /** Применить тему из ?theme= в URL (шеринг ссылкой) */
  function fromURL() {
    const m = location.search.match(/[?&]theme=([^&]+)/);
    if (!m) return false;
    const t = decode(m[1]);
    if (t) {
      apply(t);
      history.replaceState(null, '', location.pathname + location.hash);
      return true;
    }
    return false;
  }

  return { DEFAULTS, PRESETS, get current() { return current; }, apply, set, reset, save, encode, decode, fromURL };
})();