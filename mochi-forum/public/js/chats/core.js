/* Ядро Mochi chats: тема секции, шапка, роутер, общие хелперы */
window.Chats = window.Chats || {};
window.Pages = window.Pages || {};

(() => {
  const { esc, toast } = UI;

  /* ---------- Тема секции чатсов (отдельная от основной) ---------- */
  const THEME_KEY = 'mochi_chats_theme';
  const DEFAULTS = {
    mode: 'light',
    accent: '#3aa0ff',
    accent2: '#6c7cff',
    radius: 16,
    gradient: true,
  };
  let current = loadTheme();

  function loadTheme() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(THEME_KEY) || '{}') };
    } catch { return { ...DEFAULTS }; }
  }
  function applyTheme(t = current) {
    current = t;
    const root = document.documentElement;
    root.setAttribute('data-theme', t.mode === 'dark' ? 'dark' : 'light');
    document.body.dataset.chatsDark = t.mode === 'dark' ? '1' : '0';
    document.body.classList.toggle('gradient-on', !!t.gradient);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent2', t.accent2);
    root.style.setProperty('--radius', `${t.radius}px`);
    localStorage.setItem(THEME_KEY, JSON.stringify(t));
  }
  function setTheme(patch) { applyTheme({ ...current, ...patch }); }

  /** Применить тему конкретного чатса: вся страница, кроме header/подвала */
  function applyChatTheme(theme) {
    const app = document.getElementById('app');
    if (!app) return;
    app.removeAttribute('style');
    // сброс фона страницы
    document.body.style.background = '';
    document.body.style.backgroundAttachment = '';
    document.body.classList.remove('chat-theme-dark', 'chat-theme-light');
    if (!theme || !Object.keys(theme).length) {
      document.body.dataset.chatsDark = current.mode === 'dark' ? '1' : '0';
      return;
    }
    if (theme.accent) app.style.setProperty('--accent', theme.accent);
    if (theme.accent2) app.style.setProperty('--accent2', theme.accent2);
    if (theme.radius) app.style.setProperty('--radius', `${theme.radius}px`);
    if (theme.pageBg) {
      document.body.style.background = theme.pageBg;
      document.body.style.backgroundAttachment = 'fixed';
    }
    if (theme.mode) document.body.dataset.chatsDark = theme.mode === 'dark' ? '1' : '0';
    document.body.classList.add(theme.mode === 'dark' ? 'chat-theme-dark' : 'chat-theme-light');
    if (theme.bgImage) {
      const base = theme.pageBg || 'var(--ch-bg)';
      document.body.style.backgroundImage = `linear-gradient(color-mix(in srgb, ${theme.pageBg || '#0c1424'} 82%, transparent), color-mix(in srgb, ${theme.pageBg || '#0c1424'} 82%, transparent)), url('${theme.bgImage}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundAttachment = 'fixed';
    }
    (theme.fonts || []).forEach((f) => injectFont(f));
  }

  /** @font-face для шрифтов описания/темы */
  function injectFont(f) {
    if (!f || !f.url || !f.name) return;
    const id = 'cfont-' + f.url.replace(/[^a-z0-9]/gi, '');
    if (document.getElementById(id)) return;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = `@font-face{font-family:'${f.name.replace(/'/g, "\\'")}';src:url('${esc(f.url)}');font-display:swap;}`;
    document.head.appendChild(st);
  }

  /* ---------- Пользователь (аккаунт общий с основным сайтом) ---------- */
  let user = null;
  async function refreshUser() {
    if (!API.getToken()) { user = null; return; }
    try {
      const d = await API.get('/auth/me');
      user = d.user;
    } catch { API.setToken(null); user = null; }
  }
  /* ---------- Роутер ---------- */
  const ROUTES = [
    { re: /^\/?$/, fn: (m, q) => Pages.chatsFeed(m, q) },
    { re: /^\/my$/, fn: () => Pages.chatsMine() },
    { re: /^\/chat\/(\d+)$/, fn: (m) => Pages.chatsChat(+m[1]) },
    { re: /^\/notifications$/, fn: () => Pages.chatsNotifications() },
    { re: /^\/create$/, fn: (m, q) => Pages.chatsCreate(q) },
  ];

  function parseHash() {
    let h = location.hash.slice(1) || '/';
    const qi = h.indexOf('?');
    let query = {};
    if (qi >= 0) {
      const qs = new URLSearchParams(h.slice(qi + 1));
      qs.forEach((v, k) => { query[k] = v; });
      h = h.slice(0, qi);
    }
    return { path: h || '/', query };
  }

  async function route() {
    const { path, query } = parseHash();
    renderHeader();
    const app = document.getElementById('app');
    app.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    window.scrollTo({ top: 0 });

    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (m) {
        try {
          await r.fn(m, query);
        } catch (e) {
          console.error(e);
          app.innerHTML = UI.emptyState('⚠️', e.message || 'Что-то пошло не так');
        }
        return;
      }
    }
    app.innerHTML = UI.emptyState('🧭', 'Страница не найдена', 'Вернитесь в ленту чатсов.');
  }
  /* ---------- Шапка чатсов ---------- */
  function renderHeader() {
    const nav = document.getElementById('chatsNav');
    const authArea = document.getElementById('chatsAuthArea');
    const mobileMenu = document.getElementById('chatsMobileMenu');
    const { path } = parseHash();

    const badge = window.__chatsBadge || 0;
    const links = [
      ['#/', 'Лента'],
      ['#/my', 'Мои чатсы'],
      ['#/notifications', 'Уведомления'],
    ];
    const notifIndex = links.findIndex(([_, l]) => l === 'Уведомления');
    nav.innerHTML = links.map(([href, label], i) => `
      <a href="${href}" class="${isActive(href) ? 'active' : ''}">
        ${label}${i === notifIndex && badge > 0 ? `<span class="badge-dot">${badge > 99 ? '99+' : badge}</span>` : ''}
      </a>`).join('') + `<a href="/#/" title="На основной сайт">🏚 На форум</a>`;

    if (user) {
      authArea.innerHTML = `
        <button class="btn ghost sm hide-sm" id="chThemeBtn" title="Светлая/тёмная">${current.mode === 'dark' ? '☀' : '🌙'}</button>
        <a class="btn primary sm" href="#/create">＋ Новый чатс</a>
        <div class="user-menu">
          <button class="user-menu-btn" id="chUserBtn">${UI.avatar(user, 32)}<span class="hide-sm">${esc(user.username)}</span></button>
          <div class="dropdown hidden" id="chUserDrop">
            <a href="/#/u/${esc(user.username)}">👤 Мой профиль</a>
            <hr>
            <button id="chLogout">🚪 Выйти</button>
          </div>
        </div>`;
      document.getElementById('chThemeBtn').addEventListener('click', () => { setTheme({ mode: current.mode === 'dark' ? 'light' : 'dark' }); renderHeader(); });
      document.getElementById('chUserBtn').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('chUserDrop').classList.toggle('hidden'); });
      document.getElementById('chLogout').addEventListener('click', () => {
        API.setToken(null); user = null; toast('Вы вышли из аккаунта');
        renderHeader(); location.hash = '#/';
      });
      document.addEventListener('click', closeDropdownOnce);
    } else {
      authArea.innerHTML = `
        <button class="btn ghost sm hide-sm" id="chThemeBtn" title="Светлая/тёмная">${current.mode === 'dark' ? '☀' : '🌙'}</button>
        <a class="btn ghost sm" href="/#/login">Войти</a>
        <a class="btn primary sm" href="/#/register">Регистрация</a>`;
      document.getElementById('chThemeBtn').addEventListener('click', () => { setTheme({ mode: current.mode === 'dark' ? 'light' : 'dark' }); renderHeader(); });
    }

    mobileMenu.innerHTML = links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('') +
      `<a href="/#/">🏚 На форум</a>` +
      (user ? `<a href="#/create">＋ Новый чатс</a><a href="/#/u/${esc(user.username)}">👤 Профиль</a>` : `<a href="/#/login">Войти</a>`);

    function isActive(href) {
      if (href === '#/') return path === '/';
      return ('#' + path).startsWith(href.replace(/\/$/, ''));
    }
    function closeDropdownOnce(e) {
      const dd = document.getElementById('chUserDrop');
      if (dd && !dd.classList.contains('hidden') && !e.target.closest('.user-menu')) {
        dd.classList.add('hidden');
      }
    }
  }

  /* ---------- Бейдж уведомлений чатсов ---------- */
  async function pollBadge() {
    if (!API.getToken()) return;
    try {
      const d = await API.get('/gchats/notif-badge');
      const prev = window.__chatsBadge || 0;
      window.__chatsBadge = d.total;
      if (d.total !== prev) renderHeader();
    } catch { /* тихо */ }
  }

  Object.assign(window.Chats, {
    THEME_KEY, DEFAULTS,
    refreshUser, applyTheme, setTheme, applyChatTheme, injectFont,
    route, renderHeader, pollBadge,
    requireLogin() {
      UI.toast('Войдите, чтобы продолжить', 'error');
      location.href = '/#/login';
    },
  });
  // живые геттеры (Object.assign скопировал бы значение, а не ссылку!)
  Object.defineProperties(window.Chats, {
    user: { get() { return user; }, configurable: true },
    theme: { get() { return current; }, configurable: true },
  });
})();


