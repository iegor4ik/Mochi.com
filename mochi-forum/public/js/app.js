/* Ядро M-o-chi.com: роутер, шапка, состояние пользователя */
window.App = (() => {
  const { esc, avatar, toast } = UI;
  let user = null;
  let unreadTimer = null;

  /* ---------- Роутер ---------- */
  const ROUTES = [
    { re: /^\/?$/, fn: () => Pages.home() },
    { re: /^\/feed$/, fn: (_m, q) => Pages.feed(_m, q) },
    { re: /^\/category\/([\w-]+)$/, fn: (m, q) => Pages.category(m[1], q) },
    { re: /^\/topic\/(\d+)$/, fn: (m) => Pages.topic(+m[1]) },
    { re: /^\/post\/(\d+)$/, fn: (m) => Pages.post(+m[1]) },
    { re: /^\/post-editor$/, fn: (_m, q) => Pages.postEditor(q) },
    { re: /^\/u\/([^/]+)$/, fn: (m) => Pages.profile(decodeURIComponent(m[1])) },
    { re: /^\/login$/, fn: () => Pages.login() },
    { re: /^\/register$/, fn: () => Pages.register() },
    { re: /^\/settings$/, fn: () => Pages.settings() },
    { re: /^\/notifications$/, fn: () => Pages.notifications() },
    { re: /^\/chat(?:\/(\d+))?$/, fn: (m, q) => Pages.chat(m[1], q) },
    { re: /^\/search$/, fn: (_m, q) => Pages.search(null, q) },
    { re: /^\/admin$/, fn: () => Pages.admin() },
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
          app.innerHTML = UI.emptyState('⚠️', e.message || 'Что-то пошло не так',
            e.status === 404 ? 'Проверьте адрес страницы.' : 'Попробуйте обновить страницу.');
        }
        return;
      }
    }
    app.innerHTML = UI.emptyState('🧭', 'Страница не найдена', 'Вернитесь на главную.');
  }

  /* ---------- Шапка ---------- */
  function renderHeader() {
    const nav = document.getElementById('mainNav');
    const authArea = document.getElementById('authArea');
    const mobileMenu = document.getElementById('mobileMenu');

    const links = [
      ['#/ ', 'Главная'],
      ['#/feed', 'Лента'],
      ['#/category/general', 'Форум'],
      ['#/chat', 'Чат'],
      ['#/notifications', 'Уведомления'],
      ...(user && user.role === 'admin' ? [['#/admin', 'Админка']] : []),
    ];
    // счётчик уведомлений
    const notifCount = window.__unreadNotif || 0;
    const notifIndex = links.findIndex(([_, label]) => label === 'Уведомления');
    nav.innerHTML = links.map(([href, label], i) => `
      <a href="${href.trim()}" class="${isActive(href.trim()) ? 'active' : ''}">
        ${label}${i === notifIndex && notifCount > 0 ? `<span class="badge-dot">${notifCount > 99 ? '99+' : notifCount}</span>` : ''}
      </a>`).join('');

    mobileMenu.innerHTML = links.map(([href, label]) =>
      `<a href="${href.trim()}">${label}</a>`).join('') +
      (user
        ? `<a href="#/settings">⚙ Настройки</a><a href="javascript:void(0)" id="mmLogout">🚪 Выйти</a>`
        : `<a href="#/login">Войти</a><a href="#/register">Регистрация</a>`);
    const mmLogout = document.getElementById('mmLogout');
    if (mmLogout) mmLogout.addEventListener('click', logout);

    if (user) {
      authArea.innerHTML = `
        <button class="btn ghost sm hide-sm" id="themeQuickBtn" title="Переключить тему">${Theme.current.mode === 'dark' ? '☀' : '🌙'}</button>
        <div class="user-menu">
          <button class="user-menu-btn" id="userMenuBtn">
            ${avatar(user, 32)}<span>${esc(user.username)}</span>
          </button>
          <div class="dropdown hidden" id="userDropdown">
            <a href="#/u/${esc(user.username)}">👤 Мой профиль</a>
            <a href="#/settings">⚙ Настройки и тема</a>
            ${user.role === 'admin' ? '<a href="#/admin">🛠 Админ-панель</a>' : ''}
            <hr>
            <button id="logoutBtn">🚪 Выйти</button>
          </div>
        </div>`;
      document.getElementById('userMenuBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('userDropdown').classList.toggle('hidden');
      });
      document.addEventListener('click', closeDropdownOnce);
      document.getElementById('logoutBtn').addEventListener('click', logout);
      document.getElementById('themeQuickBtn').addEventListener('click', () => {
        Theme.set({ mode: Theme.current.mode === 'dark' ? 'light' : 'dark' });
        renderHeader();
      });
    } else {
      authArea.innerHTML = `
        <button class="btn ghost sm hide-sm" id="themeQuickBtn" title="Переключить тему">${Theme.current.mode === 'dark' ? '☀' : '🌙'}</button>
        <a class="btn ghost sm" href="#/login">Войти</a>
        <a class="btn primary sm" href="#/register">Регистрация</a>`;
      document.getElementById('themeQuickBtn').addEventListener('click', () => {
        Theme.set({ mode: Theme.current.mode === 'dark' ? 'light' : 'dark' });
        renderHeader();
      });
    }

    function isActive(href) {
      const { path } = parseHash();
      if (href === '#/') return path === '/' ;
      return ('#' + path).startsWith(href.replace(/\/$/, '')) && href !== '#/';
    }
    function closeDropdownOnce(e) {
      const dd = document.getElementById('userDropdown');
      if (dd && !dd.classList.contains('hidden') && !e.target.closest('.user-menu')) {
        dd.classList.add('hidden');
      }
    }
  }

  /* ---------- Аутентификация ---------- */
  async function refreshUser() {
    if (!API.getToken()) { user = null; return; }
    try {
      const d = await API.get('/auth/me');
      user = d.user;
      window.__unreadNotif = d.unread_notifications || 0;
      // применяем сохранённую в профиле тему, если локально нет своей
      if (d.user.theme && !localStorage.getItem('mochi_theme_touched')) {
        Theme.apply({ ...Theme.DEFAULTS, ...d.user.theme });
      }
    } catch {
      API.setToken(null);
      user = null;
    }
  }

  function logout() {
    API.setToken(null);
    user = null;
    localStorage.removeItem('mochi_theme_touched');
    toast('Вы вышли из аккаунта');
    location.hash = '#/';
    renderHeader();
  }

  function requireLogin() {
    toast('Войдите, чтобы продолжить', 'error');
    location.hash = '#/login';
  }

  /* ---------- Поллинг непрочитанного ---------- */
  async function pollUnread() {
    if (!API.getToken()) return;
    try {
      const d = await API.get('/notifications/unread-count');
      const prev = window.__unreadNotif || 0;
      window.__unreadNotif = d.count;
      if (d.count !== prev) renderHeader();
    } catch { /* тихо */ }
  }

  /* ---------- Старт ---------- */
  async function boot() {
    // тема из URL (?theme=...) имеет приоритет
    if (!Theme.fromURL()) {
      Theme.apply();
    }
    localStorage.setItem('mochi_theme_touched', '1'); // локальная тема главнее серверной до сброса

    // поиск в шапке
    document.getElementById('searchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = document.getElementById('searchInput').value.trim();
      location.hash = v ? `#/search?q=${encodeURIComponent(v)}` : '#/search';
    });

    // бургер-меню
    document.getElementById('burgerBtn').addEventListener('click', () => {
      document.getElementById('mobileMenu').classList.toggle('open');
    });

    await refreshUser();
    renderHeader();

    window.addEventListener('hashchange', route);
    await route();

    unreadTimer = setInterval(pollUnread, 30000);
  }

  document.addEventListener('DOMContentLoaded', boot);

  return {
    get user() { return user; },
    refreshUser,
    renderHeader,
    requireLogin,
    pollUnread,
    logout,
  };
})();