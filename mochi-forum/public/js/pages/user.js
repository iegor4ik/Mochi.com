/* Страницы: вход, регистрация, профиль, настройки (конструктор тем), уведомления */
window.Pages = window.Pages || {};
(() => {
  const { esc, fmtNum, timeAgo, fullDate, avatar, roleChip, toast, err,
          openModal, confirmDialog, pager, bindPager, uploadImage, emptyState } = UI;

  /* ================= ВХОД ================= */
  Pages.login = async function () {
    if (App.user) return (location.hash = '#/');
    document.getElementById('app').innerHTML = `
      <div class="card pad-lg auth-card">
        <h1>С возвращением! 🍡</h1>
        <p class="muted">Войдите, чтобы продолжить общение.</p>
        <div class="form-group">
          <label>Логин или email</label>
          <input class="input" id="lgLogin" autocomplete="username">
        </div>
        <div class="form-group">
          <label>Пароль</label>
          <input class="input" type="password" id="lgPass" autocomplete="current-password">
        </div>
        <div class="form-error" id="lgError"></div>
        <button class="btn primary block" id="lgSubmit">Войти</button>
        <p class="auth-switch">Нет аккаунта? <a href="#/register">Зарегистрируйтесь</a></p>
      </div>`;
    const submit = async () => {
      try {
        const r = await API.post('/auth/login', {
          login: document.getElementById('lgLogin').value.trim(),
          password: document.getElementById('lgPass').value,
        });
        API.setToken(r.token);
        await App.refreshUser();
        toast(`С возвращением, ${r.user.username}!`, 'ok');
        location.hash = '#/';
      } catch (e) {
        document.getElementById('lgError').textContent = e.message;
      }
    };
    document.getElementById('lgSubmit').addEventListener('click', submit);
    document.getElementById('app').querySelectorAll('input').forEach((i) =>
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  };

  /* ================= РЕГИСТРАЦИЯ ================= */
  Pages.register = async function () {
    if (App.user) return (location.hash = '#/');
    document.getElementById('app').innerHTML = `
      <div class="card pad-lg auth-card">
        <h1>Присоединяйтесь 🎉</h1>
        <p class="muted">Регистрация займёт меньше минуты.</p>
        <div class="form-group">
          <label>Имя пользователя</label>
          <input class="input" id="rgName" maxlength="24" placeholder="latin_буквы_цифры">
          <div class="form-hint">3–24 символа: латиница, цифры, _</div>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input class="input" type="email" id="rgEmail" maxlength="255">
        </div>
        <div class="form-group">
          <label>Пароль</label>
          <input class="input" type="password" id="rgPass" autocomplete="new-password">
          <div class="form-hint">Минимум 8 символов</div>
        </div>
        <div class="form-error" id="rgError"></div>
        <button class="btn primary block" id="rgSubmit">Создать аккаунт</button>
        <p class="auth-switch">Уже есть аккаунт? <a href="#/login">Войдите</a></p>
      </div>`;
    const submit = async () => {
      try {
        const r = await API.post('/auth/register', {
          username: document.getElementById('rgName').value.trim(),
          email: document.getElementById('rgEmail').value.trim(),
          password: document.getElementById('rgPass').value,
        });
        API.setToken(r.token);
        await App.refreshUser();
        toast('Аккаунт создан! Добро пожаловать 🍡', 'ok');
        location.hash = '#/';
      } catch (e) {
        document.getElementById('rgError').textContent = e.message;
      }
    };
    document.getElementById('rgSubmit').addEventListener('click', submit);
    document.getElementById('app').querySelectorAll('input').forEach((i) =>
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
  };

  /* ================= ПРОФИЛЬ ================= */
  Pages.profile = async function (username) {
    const app = document.getElementById('app');
    let tab = 'topics';
    let page = 1;

    async function load() {
      const u = (await API.get(`/users/${encodeURIComponent(username)}`)).user;
      const isMe = App.user && App.user.id === u.id;
      document.title = `${u.username} · M-o-chi.com`;

      let listHtml = '';
      if (tab === 'topics') {
        const d = await API.get(`/users/${encodeURIComponent(username)}/topics?page=${page}`);
        listHtml = d.items.length ? d.items.map((t) => `
          <article class="topic-row">
            <div class="topic-main">
              <h3><a href="#/topic/${t.id}">${esc(t.title)}</a></h3>
              <div class="topic-tags"><span class="chip accent">${esc(t.category_name)}</span><span>${timeAgo(t.created_at)}</span></div>
            </div>
            <div class="topic-stats"><div><b>${fmtNum(t.post_count)}</b>ответов</div><div><b>${fmtNum(t.views)}</b>просм.</div></div>
          </article>`).join('')
          : emptyState('🗂', 'Тем пока нет');
        if (d.totalPages > 1) {
          listHtml += pager(page, d.totalPages);
          setTimeout(() => bindPager(app, (p) => { page = p; load(); }), 0);
        }
      } else if (tab === 'userposts') {
        const d = await API.get(`/user-posts?author=${encodeURIComponent(username)}&page=${page}`);
        listHtml = d.items.length
          ? d.items.map((p) => Pages.postCard(p, { showVisibility: isMe, manage: isMe })).join('')
          : emptyState('📜', 'Постов пока нет', isMe ? 'Создайте свой первый пост!' : '');
        if (d.totalPages > 1) {
          listHtml += pager(page, d.totalPages);
          setTimeout(() => bindPager(app, (p) => { page = p; load(); }), 0);
        }
        setTimeout(() => {
          app.querySelectorAll('[data-delpost]').forEach((b) => b.addEventListener('click', async () => {
            if (!(await confirmDialog('Удалить пост?', 'Пост будет удалён безвозвратно.'))) return;
            try { await API.del(`/user-posts/${b.dataset.delpost}`); toast('Пост удалён', 'ok'); load(); } catch (e) { err(e); }
          }));
        }, 0);
      } else {
        const d = await API.get(`/users/${encodeURIComponent(username)}/posts?page=${page}`);
        listHtml = d.items.length ? d.items.map((p) => `
          <article class="topic-row">
            <div class="topic-main">
              <h3 style="font-size:.95rem"><a href="#/topic/${p.topic_id}">${esc(p.topic_title)}</a></h3>
              <p class="muted" style="margin:4px 0;font-size:.88rem;white-space:pre-wrap;overflow-wrap:anywhere">${esc(p.content.slice(0, 200))}${p.content.length > 200 ? '…' : ''}</p>
              <div class="topic-tags"><span>❤ ${fmtNum(p.like_count)}</span><span>${timeAgo(p.created_at)}</span></div>
            </div>
          </article>`).join('')
          : emptyState('💬', 'Сообщений пока нет');
        if (d.totalPages > 1) {
          listHtml += pager(page, d.totalPages);
          setTimeout(() => bindPager(app, (p) => { page = p; load(); }), 0);
        }
      }

      app.innerHTML = `
        ${u.is_banned ? `<div class="ban-banner">⛔ Этот пользователь забанен${u.banned_until ? ` до ${fullDate(u.banned_until)}` : ' навсегда'}</div>` : ''}
        <div class="card pad-lg">
          <div class="profile-head">
            ${avatar(u, 84)}
            <div class="profile-info" style="flex:1;min-width:220px">
              <h1>${esc(u.username)} ${roleChip(u.role)}</h1>
              <p class="muted" style="margin:0">На форуме с ${fullDate(u.created_at)}</p>
              ${u.bio ? `<p style="margin:10px 0 0">${esc(u.bio)}</p>` : ''}
              ${u.signature ? `<div class="signature" style="margin-top:8px">${esc(u.signature)}</div>` : ''}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${isMe ? `<a class="btn primary" href="#/post-editor">✍️ Создать пост</a>` : ''}
              ${isMe ? `<a class="btn ghost" href="#/settings">⚙ Настройки</a>` : ''}
              ${App.user && !isMe ? `<button class="btn ${u.is_following ? 'ghost' : 'primary'}" id="followBtn">${u.is_following ? '✓ Вы подписаны' : '＋ Подписаться'}</button>` : ''}
              ${App.user && !isMe ? `<button class="btn primary" id="pmBtn">✉ Написать</button>` : ''}
              ${App.user && !isMe ? `<button class="btn ghost sm" id="repUserBtn">⚠ Жалоба</button>` : ''}
            </div>
          </div>
          <div class="profile-stats">
            <div><b>${fmtNum(u.topics_count)}</b><span>тем</span></div>
            <div><b>${fmtNum(u.posts_count)}</b><span>сообщений</span></div>
            <div><b>${fmtNum(u.user_posts_count)}</b><span>постов</span></div>
            <div><b>${fmtNum(u.likes_received)}</b><span>лайков</span></div>
            <div><b>${fmtNum(u.followers_count)}</b><span>подписчиков</span></div>
            <div><b>${fmtNum(u.following_count)}</b><span>подписок</span></div>
          </div>
        </div>

        <div class="tabs">
          <button data-tab="topics" class="${tab === 'topics' ? 'active' : ''}">Темы</button>
          <button data-tab="posts" class="${tab === 'posts' ? 'active' : ''}">Сообщения</button>
          <button data-tab="userposts" class="${tab === 'userposts' ? 'active' : ''}">Посты</button>
        </div>
        <div id="profileList">${listHtml}</div>
      `;

      app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        tab = b.dataset.tab; page = 1; load();
      }));

      const fb = document.getElementById('followBtn');
      if (fb) fb.addEventListener('click', async () => {
        try {
          const r = u.is_following
            ? await API.del(`/users/${encodeURIComponent(u.username)}/follow`)
            : await API.post(`/users/${encodeURIComponent(u.username)}/follow`, {});
          toast(r.following ? 'Вы подписались 👥' : 'Вы отписались', 'ok');
          load();
        } catch (e) { err(e); }
      });

      const pm = document.getElementById('pmBtn');
      if (pm) pm.addEventListener('click', async () => {
        try {
          const r = await API.post('/chat/conversations', { username: u.username });
          location.hash = `#/chat/${r.conversation.id}`;
        } catch (e) { err(e); }
      });
      const ru = document.getElementById('repUserBtn');
      if (ru) ru.addEventListener('click', () => Pages.reportModal('user', u.id));
    }
    await load();
  };

  /* ================= НАСТРОЙКИ ================= */
  Pages.settings = async function () {
    if (!App.user) return App.requireLogin();
    const app = document.getElementById('app');
    const me = App.user;
    const t = Theme.current;

    app.innerHTML = `
      <div class="section-head"><h2>⚙ Настройки</h2></div>
      <div class="settings-layout">

        <!-- Профиль -->
        <div class="card pad-lg">
          <h3 style="margin-top:0">👤 Профиль</h3>
          <div style="display:flex;gap:16px;align-items:center;margin-bottom:18px">
            <span id="avatarBox">${avatar(me, 72)}</span>
            <div>
              <input type="file" id="avatarFile" accept="image/*" class="hidden">
              <button class="btn ghost sm" id="avatarBtn">📷 Сменить аватар</button>
              <div class="form-hint">JPEG/PNG/GIF/WebP до 5 МБ</div>
            </div>
          </div>
          <div class="form-group">
            <label>О себе</label>
            <textarea class="input" id="stBio" maxlength="500" style="min-height:80px">${esc(me.bio || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Подпись под сообщениями</label>
            <input class="input" id="stSig" maxlength="200" value="${esc(me.signature || '')}">
          </div>
          <button class="btn primary" id="stSaveProfile">Сохранить профиль</button>
        </div>

        <!-- Приватность -->
        <div class="card pad-lg">
          <h3 style="margin-top:0">🔒 Приватность</h3>
          <div class="form-group">
            <label>Кто может писать мне в личные сообщения</label>
            <select class="input" id="stDmPolicy">
              <option value="all" ${(me.dm_policy || 'all') === 'all' ? 'selected' : ''}>🌐 Все</option>
              <option value="followers" ${me.dm_policy === 'followers' ? 'selected' : ''}>👥 Только подписчики</option>
              <option value="following" ${me.dm_policy === 'following' ? 'selected' : ''}>↔ Только те, на кого я подписан(а)</option>
            </select>
            <div class="form-hint">Ограничение работает при создании диалога и отправке сообщений. Модераторы могут писать всегда.</div>
          </div>
          <button class="btn primary" id="stSavePrivacy">Сохранить приватность</button>
        </div>

        <!-- Конструктор темы -->
        <div class="card pad-lg">
          <h3 style="margin-top:0">🎨 Конструктор темы</h3>
          <div class="theme-controls">
            <div>
              <label style="font-weight:600;font-size:.88rem;display:block;margin-bottom:6px">Режим</label>
              <div class="seg" id="modeSeg">
                <button data-mode="light" class="${t.mode === 'light' ? 'active' : ''}">☀ Светлая</button>
                <button data-mode="dark" class="${t.mode === 'dark' ? 'active' : ''}">🌙 Тёмная</button>
              </div>
            </div>

            <div>
              <label style="font-weight:600;font-size:.88rem;display:block;margin-bottom:6px">Готовые палитры</label>
              <div class="presets" id="presets">
                ${Theme.PRESETS.map((p) => `
                  <span class="preset-dot" title="${esc(p.name)}" data-a="${p.accent}" data-b="${p.accent2}"
                    style="background:linear-gradient(135deg,${p.accent},${p.accent2})"></span>`).join('')}
              </div>
            </div>

            <div class="color-row">
              <input type="color" id="cAccent" value="${esc(t.accent)}" title="Основной цвет">
              <div><b style="font-size:.9rem">Основной цвет</b><div class="muted" style="font-size:.78rem">кнопки, ссылки, акценты</div></div>
            </div>
            <div class="color-row">
              <input type="color" id="cAccent2" value="${esc(t.accent2)}" title="Второй цвет">
              <div><b style="font-size:.9rem">Второй цвет</b><div class="muted" style="font-size:.78rem">градиенты и выделения</div></div>
            </div>

            <div class="range-row">
              <span style="font-size:.85rem;width:110px">Скругления</span>
              <input type="range" id="rRadius" min="4" max="28" step="1" value="${+t.radius}">
              <span class="range-val" id="rRadiusVal">${+t.radius}px</span>
            </div>
            <div class="range-row">
              <span style="font-size:.85rem;width:110px">Размер шрифта</span>
              <input type="range" id="rFont" min="0.85" max="1.25" step="0.05" value="${+t.fontScale}">
              <span class="range-val" id="rFontVal">${Math.round(+t.fontScale * 100)}%</span>
            </div>

            <div class="switch-row">
              <span style="font-size:.9rem">Фоновое свечение (градиент)</span>
              <label class="switch"><input type="checkbox" id="cbGradient" ${t.gradient ? 'checked' : ''}><span></span></label>
            </div>

            <div class="theme-preview" id="themePreview">
              <b>Живой предпросмотр</b>
              <p class="muted" style="font-size:.85rem;margin:6px 0 12px">Изменения применяются мгновенно ко всему сайту.</p>
              <button class="btn primary sm">Кнопка</button>
              <button class="btn ghost sm">Вторая</button>
              <span class="chip accent" style="margin-left:6px">чип</span>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn primary" id="thSave">💾 Сохранить тему</button>
              <button class="btn ghost" id="thShare">🔗 Поделиться</button>
              <button class="btn ghost" id="thExport">📋 Код темы</button>
              <button class="btn ghost" id="thImport">📥 Импорт</button>
              <button class="btn danger" id="thReset">Сброс</button>
            </div>
            <textarea class="input hidden" id="thCode" rows="3" placeholder="Вставьте код темы и нажмите «Импорт» ещё раз"></textarea>
          </div>
        </div>
      </div>`;

    /* --- профиль --- */
    document.getElementById('avatarBtn').addEventListener('click', () => document.getElementById('avatarFile').click());
    document.getElementById('avatarFile').addEventListener('change', async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        // FormData отправляем строго через API.upload (иначе multer не увидит файл)
        const fd = new FormData();
        fd.append('image', file);
        await API.upload('/users/me/avatar', fd);
        await App.refreshUser();
        document.getElementById('avatarBox').innerHTML = avatar(App.user, 72);
        App.renderHeader();
        toast('Аватар обновлён!', 'ok');
      } catch (ex) { err(ex); }
    });
    document.getElementById('stSaveProfile').addEventListener('click', async () => {
      try {
        await API.put('/users/me', {
          bio: document.getElementById('stBio').value.trim(),
          signature: document.getElementById('stSig').value.trim(),
        });
        await App.refreshUser();
        toast('Профиль сохранён', 'ok');
      } catch (e) { err(e); }
    });
    document.getElementById('stSavePrivacy').addEventListener('click', async () => {
      try {
        await API.put('/users/me', { dm_policy: document.getElementById('stDmPolicy').value });
        await App.refreshUser();
        toast('Настройки приватности сохранены', 'ok');
      } catch (e) { err(e); }
    });

    /* --- конструктор --- */
    const $ = (id) => document.getElementById(id);
    $('modeSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      Theme.set({ mode: b.dataset.mode });
      $('modeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('presets').querySelectorAll('.preset-dot').forEach((d) => d.addEventListener('click', () => {
      Theme.set({ accent: d.dataset.a, accent2: d.dataset.b });
      $('cAccent').value = d.dataset.a;
      $('cAccent2').value = d.dataset.b;
    }));
    $('cAccent').addEventListener('input', (e) => Theme.set({ accent: e.target.value }));
    $('cAccent2').addEventListener('input', (e) => Theme.set({ accent2: e.target.value }));
    $('rRadius').addEventListener('input', (e) => {
      Theme.set({ radius: +e.target.value });
      $('rRadiusVal').textContent = `${e.target.value}px`;
    });
    $('rFont').addEventListener('input', (e) => {
      Theme.set({ fontScale: +e.target.value });
      $('rFontVal').textContent = `${Math.round(e.target.value * 100)}%`;
    });
    $('cbGradient').addEventListener('change', (e) => Theme.set({ gradient: e.target.checked }));

    $('thSave').addEventListener('click', async () => {
      try {
        await API.put('/users/me', { theme: Theme.current });
        toast('Тема сохранена в профиле ✓', 'ok');
      } catch (e) { err(e); }
    });
    $('thShare').addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}?theme=${Theme.encode()}`;
      try { await navigator.clipboard.writeText(url); toast('Ссылка на тему скопирована 🔗', 'ok'); }
      catch { openModal(`<h3>🔗 Ссылка на тему</h3><textarea class="input" rows="3">${esc(url)}</textarea>`); }
    });
    $('thExport').addEventListener('click', async () => {
      const code = Theme.encode();
      try { await navigator.clipboard.writeText(code); toast('Код темы скопирован 📋', 'ok'); }
      catch { /* покажем ниже */ }
      const ta = $('thCode');
      ta.classList.remove('hidden');
      ta.value = code;
    });
    let importArmed = false;
    $('thImport').addEventListener('click', () => {
      const ta = $('thCode');
      if (!importArmed) {
        ta.classList.remove('hidden');
        ta.value = '';
        ta.focus();
        importArmed = true;
        toast('Вставьте код темы и нажмите «Импорт» ещё раз');
        return;
      }
      const t2 = Theme.decode(ta.value);
      if (!t2) return toast('Некорректный код темы', 'error');
      Theme.apply(t2);
      importArmed = false;
      Pages.settings();
      toast('Тема импортирована! Не забудьте сохранить 💾', 'ok');
    });
    $('thReset').addEventListener('click', () => { Theme.reset(); Pages.settings(); });
  };

  /* ================= УВЕДОМЛЕНИЯ ================= */
  const NOTIF_META = {
    reply: ['↩️', 'ответил(а) вам в теме'],
    like: ['❤️', 'поставил(а) лайк вашему сообщению'],
    message: ['✉️', 'отправил(а) вам личное сообщение'],
    follow: ['👥', 'подписался(ась) на вас'],
    report: ['⚠️', 'новая жалоба требует рассмотрения'],
    report_resolved: ['✅', 'ваша жалоба обработана'],
    role_changed: ['🎖', 'вам изменили роль'],
    banned: ['⛔', 'вы были забанены'],
    unbanned: ['🕊', 'бан снят'],
  };

  Pages.notifications = async function () {
    if (!App.user) return App.requireLogin();
    const app = document.getElementById('app');

    async function load() {
      const d = await API.get('/notifications?page=1&limit=50');
      app.innerHTML = `
        <div class="section-head">
          <h2>🔔 Уведомления</h2>
          <button class="btn ghost sm" id="markAll">Отметить всё прочитанным</button>
        </div>
        <div id="notifList">
          ${d.items.length ? d.items.map((n) => {
            const [icon, verb] = NOTIF_META[n.type] || ['🔔', 'событие'];
            const payload = n.payload || {};
            let link = '#/';
            if (n.type === 'reply' || n.type === 'like') link = payload.topic_id ? `#/topic/${payload.topic_id}` : '#/';
            else if (n.type === 'message') link = n.entity_id ? `#/chat/${n.entity_id}` : '#/chat';
            else if (n.type === 'follow') link = `#/u/${encodeURIComponent(payload.username || n.actor_username || '')}`;
            else if (n.type === 'report') link = '#/admin';
            const text = n.type === 'reply' ? `${verb} «${payload.topic_title || ''}»`
              : n.type === 'report_resolved' ? `${verb} (${payload.status === 'resolved' ? 'принята' : 'отклонена'})`
              : n.type === 'role_changed' ? `${verb}: теперь вы — ${payload.role}`
              : n.type === 'banned' ? `${verb}. Причина: ${payload.reason || 'не указана'}${payload.until ? `, до ${fullDate(payload.until)}` : ' (навсегда)'}`
              : verb;
            return `
              <a class="notif-row ${n.read ? '' : 'unread'}" href="${link}" data-id="${n.id}">
                <span class="notif-icon">${icon}</span>
                <div class="notif-body">
                  <p><b>${esc(n.actor_username || 'Система')}</b> ${esc(text)}</p>
                  <time>${timeAgo(n.created_at)}</time>
                </div>
              </a>`;
          }).join('') : emptyState('🔕', 'Уведомлений нет', 'Здесь появятся ответы, лайки и сообщения.')}
        </div>
        ${d.totalPages > 1 ? pager(d.page ?? 1, d.totalPages) : ''}
      `;
      bindPager(app, () => {});
      document.getElementById('markAll').addEventListener('click', async () => {
        try {
          await API.post('/notifications/read', {});
          App.pollUnread();
          load();
        } catch (e) { err(e); }
      });
      app.querySelectorAll('.notif-row.unread').forEach((row) => {
        row.addEventListener('click', () => {
          API.post('/notifications/read', { ids: [row.dataset.id] }).then(() => App.pollUnread()).catch(() => {});
        });
      });
    }
    await load();
  };
})();