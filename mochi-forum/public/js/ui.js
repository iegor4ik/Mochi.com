/* UI-хелперы M-o-chi.com */
window.UI = (() => {

  // экранирование HTML (через карту символов, чтобы не зависеть от сущностей в исходнике)
  const ESC_MAP = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&${ESC_MAP[ch]};`);

  const fmtNum = (n) => {
    n = +n || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return String(n);
  };

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'только что';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} мин назад`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ч назад`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days} дн назад`;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }

  function fullDate(dateStr) {
    return dateStr ? new Date(dateStr).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }

  /** Аватар: картинка или градиентный шар с буквой */
  function avatar(userOrName, size = 40) {
    const name = typeof userOrName === 'string' ? userOrName : (userOrName?.username || '?');
    const url = typeof userOrName === 'object' ? userOrName?.avatar_url : null;
    const letter = esc(name.charAt(0).toUpperCase());
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * .42)}px`;
    if (url) {
      return `<span class="avatar" style="${style}"><img src="${esc(url)}" alt="" loading="lazy"
        onerror="this.remove();this.parentElement.textContent='${letter}'"></span>`;
    }
    return `<span class="avatar" style="${style}">${letter}</span>`;
  }

  const roleChip = (role) => {
    const map = { admin: ['admin', 'админ'], moderator: ['moderator', 'модератор'], user: ['user', 'юзер'] };
    const [cls, label] = map[role] || map.user;
    return `<span class="role-chip role-${cls}">${label}</span>`;
  };

  /* ---------- Тосты ---------- */
  function toast(message, type = 'info', ms = 3500) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(() => el.remove(), 320);
    }, ms);
  }
  const err = (e) => toast(e?.message || String(e), 'error');

  /* ---------- Модалки ---------- */
  function openModal(html, { onClose } = {}) {
    const root = document.getElementById('modalRoot');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">${html}</div>`;
    const close = () => { overlay.remove(); onClose && onClose(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    root.appendChild(overlay);
    return { el: overlay, close };
  }

  function confirmDialog(title, text, okLabel = 'Удалить') {
    return new Promise((resolve) => {
      const m = openModal(`
        <h3>${esc(title)}</h3>
        <p class="muted">${esc(text)}</p>
        <div class="modal-actions">
          <button class="btn ghost" data-close>Отмена</button>
          <button class="btn danger" id="cfOk">${esc(okLabel)}</button>
        </div>`);
      m.el.querySelector('#cfOk').addEventListener('click', () => { m.close(); resolve(true); });
      m.el.querySelector('[data-close]').addEventListener('click', () => resolve(false));
      m.el.addEventListener('click', (e) => { if (e.target === m.el) resolve(false); });
    });
  }

  /* ---------- Пагинация ---------- */
  function pager(page, totalPages, onGo) {
    if (totalPages <= 1) return '';
    const btn = (p, label, opts = {}) =>
      `<button data-page="${p}" ${opts.disabled ? 'disabled' : ''} class="${opts.current ? 'current' : ''}">${label}</button>`;
    let html = '<div class="pager">';
    html += btn(page - 1, '←', { disabled: page <= 1 });
    const win = [];
    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || Math.abs(p - page) <= 2) win.push(p);
    }
    let prev = 0;
    for (const p of win) {
      if (p - prev > 1) html += `<button disabled>…</button>`;
      html += btn(p, p, { current: p === page });
      prev = p;
    }
    html += btn(page + 1, '→', { disabled: page >= totalPages });
    html += '</div>';
    // навешиваем обработчики после вставки — caller делает это через делегирование,
    // поэтому просто вернём HTML с data-атрибутами
    void onGo;
    return html;
  }

  /** Подключить клики пагинации к контейнеру */
  function bindPager(container, onGo) {
    container.querySelectorAll('.pager button[data-page]').forEach((b) => {
      b.addEventListener('click', () => onGo(+b.dataset.page));
    });
  }

  const debounce = (fn, ms = 300) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  /* ---------- Markdown-рендер сообщений (Discord/c.ai-стиль) ---------- */
  /** Схлопывает 3+ перевода строки до 2, экранирует и применяет **жирный**, *курсив*,
      __подчёркнутый__, ~~зачёркнутый~~, `код`, ||спойлер||, @упоминания */
  function renderMd(raw) {
    let s = String(raw || '').replace(/\n{3,}/g, '\n\n');
    s = esc(s);
    // спойлеры ||…||
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="md-spoiler" title="Нажмите, чтобы показать">$1</span>');
    // `код`
    s = s.replace(/`([^`\n]+)`/g, '<span class="md-code">$1</span>');
    // **жирный**
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    // __подчёркнутый__
    s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');
    // ~~зачёркнутый~~
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    // *курсив* (после жирного)
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>');
    // @упоминания
    s = s.replace(/@([A-Za-z0-9_а-яёА-ЯЁ.-]{2,32})/g,
      '<span style="color:var(--accent);font-weight:700">@$1</span>');
    return s;
  }

  /** Обернуть выделение в текстовом поле маркерами: insertMd(ta, '**', 'жирный') */
  function insertMd(ta, marker, placeholder = 'текст') {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const sel = value.slice(a, b) || placeholder;
    ta.value = value.slice(0, a) + marker + sel + marker + value.slice(b);
    const pos = b + marker.length * 2;
    ta.setSelectionRange(pos - marker.length - sel.length, pos - marker.length);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Активирует клики по спойлерам внутри контейнера */
  function bindSpoilers(root) {
    root.querySelectorAll('.md-spoiler:not(.revealed)').forEach((sp) => {
      sp.addEventListener('click', () => sp.classList.add('revealed'));
    });
  }

  /** Панель форматирования под полем ввода (только desktop) */
  function mdToolbar() {
    return `<div class="md-toolbar hide-sm" id="mdToolbar" hidden>
      <button type="button" data-md="**" data-ph="жирный текст" title="Жирный (или **текст**)"><b>Ж</b></button>
      <button type="button" data-md="*" data-ph="курсив" title="Курсив (или *текст*)"><i>К</i></button>
      <button type="button" data-md="__" data-ph="подчёркнутый текст" title="Подчёркнутый (или __текст__)"><u>Ч</u></button>
      <button type="button" data-md="~~" data-ph="зачёркнутый текст" title="Зачёркнутый (или ~~текст~~)"><s>З</s></button>
      <button type="button" data-md="\`" data-ph="код" title="Код (или \`текст\`)">&lt;/&gt;</button>
      <button type="button" data-md="||" data-ph="скрытый текст" title="Спойлер (или ||текст||)">👁</button>
    </div>`;
  }

  /** Подключить тумблер и панель форматирования к полю ввода */
  function bindMdToggle(btn, toolbar, textarea) {
    if (!btn || !toolbar || !textarea) return;
    btn.addEventListener('click', () => {
      const on = toolbar.hasAttribute('hidden');
      if (on) toolbar.removeAttribute('hidden');
      else toolbar.setAttribute('hidden', '');
      btn.classList.toggle('active', on);
      if (on) textarea.focus();
    });
    toolbar.querySelectorAll('[data-md]').forEach((b) => b.addEventListener('click', () => {
      insertMd(textarea, b.dataset.md, b.dataset.ph || 'текст');
    }));
  }

  /** Загрузка файла на сервер → url */
  async function uploadImage(file) {
    if (!file) throw new Error('Файл не выбран');
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) throw new Error('Только изображения JPEG/PNG/GIF/WebP');
    if (file.size > 5 * 1024 * 1024) throw new Error('Максимальный размер — 5 МБ');
    const fd = new FormData();
    fd.append('image', file);
    const r = await API.upload('/upload', fd);
    return r.url;
  }

  const emptyState = (emoji, title, sub = '') =>
    `<div class="empty-state"><div class="big">${emoji}</div><h3>${esc(title)}</h3>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>`;

  /* ---------- Мини-профиль при наведении на никнейм ----------
     Работает везде, где есть ссылка вида #/u/<username>:
     форум, посты, сообщения, чатсы, списки участников. */
  const profilePop = { el: null, showT: null, hideT: null, cache: new Map() };

  function profilePopHide() {
    clearTimeout(profilePop.hideT);
    clearTimeout(profilePop.showT);
    if (profilePop.el) { profilePop.el.remove(); profilePop.el = null; }
  }

  async function profilePopFetch(username) {
    const key = String(username).toLowerCase();
    const cached = profilePop.cache.get(key);
    if (cached && Date.now() - cached.ts < 60000) return cached.data;
    const d = await API.get(`/users/${encodeURIComponent(username)}`);
    profilePop.cache.set(key, { data: d.user, ts: Date.now() });
    if (profilePop.cache.size > 100) profilePop.cache.clear();
    return d.user;
  }

  function profilePopShow(username, anchor) {
    profilePopFetch(username).then((u) => {
      if (!u) return;
      profilePopHide();
      const el = document.createElement('div');
      el.className = 'profile-pop';
      const since = new Date(u.created_at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      el.innerHTML = `
        <div class="pp-head">
          ${avatar(u, 56)}
          <div style="min-width:0">
            <a class="pp-uname" href="#/u/${esc(u.username)}">${esc(u.username)}</a>
            ${roleChip(u.role)}
          </div>
        </div>
        <div class="pp-meta">
          <span>🗓 На форуме с ${esc(since)}</span>
          <span>👥 ${fmtNum(u.followers_count)} подписчиков · ${fmtNum(u.following_count)} подписок</span>
        </div>
        ${u.bio ? `<div class="pp-bio">${esc(String(u.bio).slice(0, 160))}</div>` : ''}`;
      el.addEventListener('mouseenter', () => clearTimeout(profilePop.hideT));
      el.addEventListener('mouseleave', () => { profilePop.hideT = setTimeout(profilePopHide, 250); });
      document.body.appendChild(el);
      profilePop.el = el;
      // позиция у якоря, с учётом границ экрана
      const r = anchor.getBoundingClientRect();
      const w = 280;
      const h = el.offsetHeight || 140;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }).catch(() => { /* пользователь не найден / нет сети — просто не показываем */ });
  }

  function initProfileHover() {
    if (initProfileHover._done) return;
    initProfileHover._done = true;
    const POP_RE = /#\/u\/([^/?#]+)$/;
    document.addEventListener('mouseover', (e) => {
      const a = e.target.closest ? e.target.closest('a[href*="#/u/"]') : null;
      if (!a) return;
      clearTimeout(profilePop.showT);
      clearTimeout(profilePop.hideT);
      const m = (a.getAttribute('href') || '').match(POP_RE);
      let uname = m ? m[1] : '';
      try { uname = decodeURIComponent(uname); } catch { /* оставим как есть */ }
      if (!uname) return;
      profilePop.showT = setTimeout(() => profilePopShow(uname, a), 350);
    });
    document.addEventListener('mouseout', (e) => {
      const a = e.target.closest ? e.target.closest('a[href*="#/u/"]') : null;
      if (!a) return;
      clearTimeout(profilePop.showT);
      profilePop.hideT = setTimeout(profilePopHide, 250);
    });
    document.addEventListener('scroll', profilePopHide, { capture: true, passive: true });
    window.addEventListener('resize', profilePopHide);
    window.addEventListener('click', profilePopHide);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProfileHover);
  } else {
    initProfileHover();
  }

  return { esc, fmtNum, timeAgo, fullDate, avatar, roleChip, toast, err, openModal, confirmDialog, pager, bindPager, debounce, uploadImage, emptyState,
    renderMd, insertMd, bindSpoilers, mdToolbar, bindMdToggle };
})();