/* Страницы: главная, категория, тема, поиск */
window.Pages = window.Pages || {};
(() => {
  const { esc, fmtNum, timeAgo, fullDate, avatar, roleChip, toast, err, openModal,
          confirmDialog, pager, bindPager, uploadImage, emptyState } = UI;

  /* ================= ГЛАВНАЯ ================= */
  Pages.home = async function () {
    const app = document.getElementById('app');
    const [cats, topics] = await Promise.all([
      API.get('/categories'),
      API.get('/topics?limit=6&sort=activity'),
    ]);

    const totalTopics = cats.items.reduce((s, c) => s + (+c.topic_count || 0), 0);
    const totalPosts = cats.items.reduce((s, c) => s + (+c.post_count || 0), 0);

    app.innerHTML = `
      <section class="hero">
        <h1>Добро пожаловать на <span style="background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent">M-o-chi.com</span></h1>
        <p>Уютный форум о технологиях, играх и искусстве. Обсуждайте темы, заводите друзей в личном чате и настраивайте оформление под себя 🍡</p>
        <div class="hero-actions">
          ${App.user
            ? `<a class="btn primary lg" href="#/category/general">Перейти к обсуждениям</a>
               <button class="btn ghost lg" id="heroNewTopic">✏️ Создать тему</button>`
            : `<a class="btn primary lg" href="#/register">Присоединиться</a>
               <a class="btn ghost lg" href="#/login">Войти</a>`}
        </div>
        <div class="hero-balls"><span></span><span></span><span></span></div>
      </section>

      <div class="stats-row">
        <div class="stat-tile"><b>${cats.items.length}</b><span>категорий</span></div>
        <div class="stat-tile"><b>${fmtNum(totalTopics)}</b><span>тем</span></div>
        <div class="stat-tile"><b>${fmtNum(totalPosts)}</b><span>сообщений</span></div>
      </div>

      <div class="section-head"><h2>📚 Категории</h2></div>
      <div class="grid-cats">
        ${cats.items.map((c) => `
          <a class="cat-card" href="#/category/${esc(c.slug)}">
            <div class="cat-icon">${esc(c.icon)}</div>
            <div style="min-width:0">
              <h3>${esc(c.name)}</h3>
              <p>${esc(c.description)}</p>
              <div class="cat-meta">
                <span>🗂 ${fmtNum(c.topic_count)} тем</span>
                <span>💬 ${fmtNum(c.post_count)} сообщений</span>
                ${c.last_activity ? `<span>🕒 ${timeAgo(c.last_activity)}</span>` : ''}
              </div>
            </div>
          </a>`).join('')}
      </div>

      <div class="section-head"><h2>🔥 Активные темы</h2><a href="#/search" class="muted" style="font-size:.9rem">поиск →</a></div>
      <div id="hotTopics">
        ${topics.items.map(topicRow).join('')}
      </div>
    `;

    const btn = document.getElementById('heroNewTopic');
    if (btn) btn.addEventListener('click', () => newTopicModal());
  };

  function topicRow(t) {
    return `
      <article class="topic-row ${t.pinned ? 'pinned' : ''}">
        <div class="topic-main">
          <h3><a href="#/topic/${t.id}">${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(t.title)}</a></h3>
          <div class="topic-tags">
            <span class="chip accent">${esc(t.category_name)}</span>
            <span>${UI.avatar({ username: t.author_username, avatar_url: t.author_avatar }, 18)} ${esc(t.author_username)}</span>
            <span>· ${timeAgo(t.created_at)}</span>
          </div>
        </div>
        <div class="topic-stats">
          <div><b>${fmtNum(t.post_count)}</b>ответов</div>
          <div><b>${fmtNum(t.views)}</b>просмотров</div>
        </div>
      </article>`;
  }

  /* ================= КАТЕГОРИЯ ================= */
  Pages.category = async function (slug, query = {}) {
    const app = document.getElementById('app');
    let page = Math.max(1, parseInt(query.page, 10) || 1);
    let sort = ['activity', 'new', 'top', 'discussed'].includes(query.sort) ? query.sort : 'activity';

    async function load() {
      const [catsRes, data] = await Promise.all([
        API.get('/categories'),
        API.get(`/topics?category=${encodeURIComponent(slug)}&sort=${sort}&page=${page}`),
      ]);
      const cat = catsRes.items.find((c) => c.slug === slug);

      app.innerHTML = `
        <nav class="muted" style="margin-bottom:14px;font-size:.88rem"><a href="#/">Главная</a> / ${cat ? esc(cat.name) : 'Категория'}</nav>
        ${cat ? `
        <div class="card" style="display:flex;gap:16px;align-items:center;margin-bottom:20px">
          <div class="cat-icon" style="width:60px;height:60px;font-size:1.9rem">${esc(cat.icon)}</div>
          <div style="flex:1">
            <h1 style="margin:0 0 4px">${esc(cat.name)}</h1>
            <p class="muted" style="margin:0">${esc(cat.description)}</p>
          </div>
          <button class="btn primary" id="newTopicBtn">✏️ Новая тема</button>
        </div>` : emptyState('🗂', 'Категория не найдена')}

        <div class="section-head">
          <h2>Темы <span class="muted" style="font-weight:400;font-size:.9rem">(${data.total})</span></h2>
          <div class="sort-tabs">
            ${[['activity', 'Активность'], ['new', 'Новые'], ['top', 'Популярные'], ['discussed', 'Обсуждаемые']]
              .map(([k, l]) => `<a href="#/category/${esc(slug)}?sort=${k}" class="${sort === k ? 'active' : ''}">${l}</a>`).join('')}
          </div>
        </div>

        <div id="topicList">
          ${data.items.length ? data.items.map(topicRow).join('') : emptyState('🍡', 'Тем пока нет', 'Станьте первым — создайте новую тему!')}
        </div>

        <div id="pagerBox"></div>
      `;

      UI.bindPager(document.getElementById('pagerBox'), (p) => {
        location.hash = `#/category/${slug}?sort=${sort}&page=${p}`;
      });
      if (data.totalPages > 1) {
        document.getElementById('pagerBox').innerHTML = pager(page, data.totalPages);
        UI.bindPager(document.getElementById('pagerBox'), (p) => {
          page = p;
          history.replaceState(null, '', `#/category/${slug}?sort=${sort}&page=${p}`);
          load();
          window.scrollTo({ top: 0 });
        });
      }

      const nb = document.getElementById('newTopicBtn');
      if (nb) nb.addEventListener('click', () => newTopicModal(cat));
    }
    await load();
  };

  /* ---------- Модалка создания темы ---------- */
  async function newTopicModal(preselectCat) {
    if (!App.user) return App.requireLogin();
    const cats = (await API.get('/categories')).items;
    const m = openModal(`
      <h3>✏️ Новая тема</h3>
      <div class="form-group">
        <label>Категория</label>
        <select class="input" id="ntCat">
          ${cats.map((c) => `<option value="${c.id}" ${preselectCat && preselectCat.id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Заголовок</label>
        <input class="input" id="ntTitle" maxlength="200" placeholder="О чём поговорим?">
      </div>
      <div class="form-group">
        <label>Текст темы</label>
        <textarea class="input" id="ntContent" maxlength="20000" placeholder="Раскройте мысль…"></textarea>
      </div>
      <div class="form-group">
        <label>Изображение (необязательно)</label>
        <input type="file" id="ntImage" accept="image/*" class="input">
        <div class="upload-preview hidden" id="ntPreview"></div>
      </div>
      <div class="form-error" id="ntError"></div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="ntSubmit">Создать</button>
      </div>
    `);

    let imageUrl = null;
    m.el.querySelector('#ntImage').addEventListener('change', async (e) => {
      try {
        imageUrl = await uploadImage(e.target.files[0]);
        m.el.querySelector('#ntPreview').classList.remove('hidden');
        m.el.querySelector('#ntPreview').innerHTML = `<img src="${esc(imageUrl)}" alt="">`;
      } catch (ex) { err(ex); }
    });

    m.el.querySelector('#ntSubmit').addEventListener('click', async () => {
      const submit = m.el.querySelector('#ntSubmit');
      submit.disabled = true;
      try {
        const fd = new FormData();
        fd.append('category_id', m.el.querySelector('#ntCat').value);
        fd.append('title', m.el.querySelector('#ntTitle').value.trim());
        fd.append('content', m.el.querySelector('#ntContent').value.trim());
        if (imageUrl) fd.append('image_url', imageUrl);
        // отправляем как JSON (картинка уже загружена отдельным запросом)
        const body = {
          category_id: +fd.get('category_id'),
          title: fd.get('title'),
          content: fd.get('content'),
          ...(imageUrl ? { image_url: imageUrl } : {}),
        };
        const r = await API.post('/topics', body);
        m.close();
        toast('Тема создана!', 'ok');
        location.hash = `#/topic/${r.topic.id}`;
      } catch (ex) {
        m.el.querySelector('#ntError').textContent = ex.message;
        submit.disabled = false;
      }
    });
  }
  Pages.newTopicModal = newTopicModal;

  /* ================= ТЕМА ================= */
  Pages.topic = async function (id) {
    const app = document.getElementById('app');
    let page = 1;
    let parentPost = null; // {id, username}
    let imageData = null;

    async function load() {
      const [tRes, pRes] = await Promise.all([
        API.get(`/topics/${id}`),
        API.get(`/topics/${id}/posts?page=${page}&limit=20`),
      ]);
      const t = tRes.topic;
      const me = App.user;
      const isStaff = me && ['moderator', 'admin'].includes(me.role);
      document.title = `${t.title} · M-o-chi.com`;

      const canModerate = isStaff;
      const lockedBlock = t.locked && !isStaff
        ? `<div class="ban-banner">🔒 Тема закрыта для новых сообщений</div>` : '';

      app.innerHTML = `
        <nav class="muted" style="margin-bottom:14px;font-size:.88rem">
          <a href="#/">Главная</a> / <a href="#/category/${esc(t.category_slug)}">${esc(t.category_name)}</a>
        </nav>

        <div class="card pad-lg" style="margin-bottom:22px">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <h1 style="margin:0;font-size:1.45rem">${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(t.title)}</h1>
            ${(me && (me.id === t.author_id || isStaff)) ? `
            <div style="display:flex;gap:8px;flex-shrink:0">
              ${canModerate ? `
                <button class="btn ghost sm" id="tPin">${t.pinned ? 'Открепить' : '📌 Закрепить'}</button>
                <button class="btn ghost sm" id="tLock">${t.locked ? 'Открыть' : '🔒 Закрыть'}</button>` : ''}
              <button class="btn danger sm" id="tDelete">Удалить</button>
            </div>` : ''}
          </div>
          <div class="topic-tags" style="margin-top:8px">
            <span class="chip accent">${esc(t.category_name)}</span>
            <span>👁 ${fmtNum(t.views)} просмотров</span>
            <span>💬 ${fmtNum(t.post_count)} ответов</span>
          </div>
        </div>

        <!-- Первый пост -->
        ${postCard({
          id: t.id, content: t.content, image_url: t.image_url,
          created_at: t.created_at, edited: false,
          author_username: t.author_username, author_avatar: t.author_avatar,
          author_role: t.author_role, author_signature: t.author_signature,
          like_count: 0, liked_by_me: false, parent_username: null,
        }, true)}

        <div class="section-head"><h2>Ответы <span class="muted" style="font-weight:400;font-size:.9rem">(${pRes.total})</span></h2></div>
        <div id="postsList">
          ${pRes.items.length ? pRes.items.map((p) => postCard(p, false)).join('')
            : emptyState('💬', 'Ответов пока нет', 'Будьте первым, кто ответит!')}
        </div>
        <div id="pagerBox"></div>

        ${lockedBlock}

        ${me && (!t.locked || isStaff) ? `
        <div class="card reply-box" id="replyBox">
          <div class="reply-context hidden" id="replyContext">
            <span>↩️ Ответ пользователю <b id="replyToName"></b></span>
            <button class="btn ghost sm" id="replyCancel">отменить</button>
          </div>
          <textarea class="input" id="replyText" placeholder="Напишите ответ…" maxlength="20000"></textarea>
          <div style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">
            <input type="file" id="replyImage" accept="image/*" class="hidden">
            <button class="icon-btn" id="replyImgBtn" title="Прикрепить фото">🖼</button>
            <span class="muted" id="replyImgName" style="font-size:.82rem"></span>
            <button class="btn primary" id="replySend" style="margin-left:auto">Отправить</button>
          </div>
          <div class="upload-preview hidden" id="replyPreview"></div>
        </div>` : ''}
      `;

      /* --- пагинация --- */
      if (pRes.totalPages > 1) {
        document.getElementById('pagerBox').innerHTML = pager(page, pRes.totalPages);
        UI.bindPager(document.getElementById('pagerBox'), (p) => { page = p; load(); window.scrollTo({ top: 0 }); });
      }

      /* --- действия с темой --- */
      const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.addEventListener('click', fn); };
      on('tPin', async () => { try { await API.patch(`/topics/${id}`, { pinned: !t.pinned }); load(); } catch (e) { err(e); } });
      on('tLock', async () => { try { await API.patch(`/topics/${id}`, { locked: !t.locked }); load(); } catch (e) { err(e); } });
      on('tDelete', async () => {
        if (!(await confirmDialog('Удалить тему?', 'Тема и все сообщения будут удалены безвозвратно.'))) return;
        try { await API.del(`/topics/${id}`); toast('Тема удалена', 'ok'); location.hash = `#/category/${t.category_slug}`; } catch (e) { err(e); }
      });

      /* --- лайки / ответы / правка / жалобы --- */
      app.querySelectorAll('[data-like]').forEach((b) => b.addEventListener('click', async () => {
        if (!me) return App.requireLogin();
        try {
          const r = await API.post(`/posts/${b.dataset.like}/like`);
          b.classList.toggle('liked', r.liked);
          b.querySelector('.cnt').textContent = r.like_count;
        } catch (e) { err(e); }
      }));

      app.querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => {
        parentPost = { id: +b.dataset.reply, username: b.dataset.uname };
        document.getElementById('replyContext').classList.remove('hidden');
        document.getElementById('replyToName').textContent = b.dataset.uname;
        document.getElementById('replyText').focus();
      }));
      on('replyCancel', () => { parentPost = null; document.getElementById('replyContext').classList.add('hidden'); });

      app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => startEdit(+b.dataset.edit)));
      app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить сообщение?', 'Сообщение будет помечено как удалённое.'))) return;
        try { await API.del(`/posts/${b.dataset.del}`); toast('Удалено', 'ok'); load(); } catch (e) { err(e); }
      }));
      app.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () =>
        reportModal(b.dataset.reportType, +b.dataset.report)));

      /* --- отправка ответа --- */
      on('replyImgBtn', () => document.getElementById('replyImage').click());
      const fileInput = document.getElementById('replyImage');
      if (fileInput) fileInput.addEventListener('change', async (e) => {
        try {
          imageData = await uploadImage(e.target.files[0]);
          document.getElementById('replyImgName').textContent = 'фото прикреплено ✓';
          const pv = document.getElementById('replyPreview');
          pv.classList.remove('hidden');
          pv.innerHTML = `<img src="${esc(imageData)}" alt="">`;
        } catch (ex) { err(ex); }
      });
      on('replySend', async () => {
        const textEl = document.getElementById('replyText');
        const text = textEl.value.trim();
        if (!text && !imageData) return toast('Введите текст или прикрепите фото', 'error');
        const send = document.getElementById('replySend');
        send.disabled = true;
        try {
          await API.post(`/topics/${id}/posts`, {
            content: text || '📷',
            ...(parentPost ? { parent_post_id: parentPost.id } : {}),
            ...(imageData ? { image_url: imageData } : {}),
          });
          toast('Ответ отправлен!', 'ok');
          // переходим на последнюю страницу
          const cnt = t.post_count + 1;
          page = Math.ceil(cnt / 20);
          load();
        } catch (e) { err(e); send.disabled = false; }
      });

      /* --- инлайн-редактирование поста --- */
      function startEdit(postId) {
        const card = app.querySelector(`[data-post-card="${postId}"]`);
        const contentEl = card.querySelector('.post-content');
        const original = contentEl.textContent;
        contentEl.outerHTML = `
          <div>
            <textarea class="input" id="editArea-${postId}" maxlength="20000">${esc(original)}</textarea>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn primary sm" id="editSave-${postId}">Сохранить</button>
              <button class="btn ghost sm" id="editCancel-${postId}">Отмена</button>
            </div>
          </div>`;
        card.querySelector(`#editSave-${postId}`).addEventListener('click', async () => {
          try {
            await API.patch(`/posts/${postId}`, { content: card.querySelector(`#editArea-${postId}`).value.trim() });
            toast('Сохранено', 'ok'); load();
          } catch (e) { err(e); }
        });
        card.querySelector(`#editCancel-${postId}`).addEventListener('click', load);
      }
    }

    await load();
  };

  function postCard(p, isOp) {
    const me = App.user;
    const isStaff = me && ['moderator', 'admin'].includes(me.role);
    const own = me && me.username === p.author_username;
    const deleted = false;
    return `
      <article class="post ${isOp ? 'op' : ''}" data-post-card="${p.id}">
        <aside class="post-side">
          <a href="#/u/${esc(p.author_username)}">${avatar({ username: p.author_username, avatar_url: p.author_avatar }, 52)}</a>
          <a class="uname" href="#/u/${esc(p.author_username)}">${esc(p.author_username)}</a>
          ${roleChip(p.author_role)}
        </aside>
        <div class="post-body">
          <div class="post-head">
            ${isOp ? '<span class="chip accent">Автор темы</span>' : `<span class="muted" style="font-size:.78rem">#${p.id}</span>`}
            <time title="${fullDate(p.created_at)}">${timeAgo(p.created_at)}</time>
            ${p.edited ? '<span class="muted" style="font-size:.75rem">(изменено)</span>' : ''}
          </div>
          ${p.parent_username ? `<div class="post-quote">↩️ В ответ <b>${esc(p.parent_username)}</b></div>` : ''}
          <div class="post-content">${esc(p.content)}</div>
          ${p.image_url ? `<img class="post-image" src="${esc(p.image_url)}" alt="" loading="lazy">` : ''}
          ${p.author_signature && !isOp ? `<div class="signature">${esc(p.author_signature)}</div>` : ''}
          <div class="post-actions">
            <button class="like-btn ${p.liked_by_me ? 'liked' : ''}" data-like="${p.id}">❤ <span class="cnt">${p.like_count || 0}</span></button>
            ${!isOp && me && (!isOpLocked() ) ? `<button class="btn ghost sm" data-reply="${p.id}" data-uname="${esc(p.author_username)}">↩️ Ответить</button>` : ''}
            ${own || isStaff ? `<button class="btn ghost sm" data-edit="${p.id}">✏️ Изменить</button>` : ''}
            ${own || isStaff ? `<button class="btn danger sm" data-del="${p.id}">🗑</button>` : ''}
            ${me && !own ? `<button class="btn ghost sm" data-report="${p.id}" data-report-type="post">⚠ Жалоба</button>` : ''}
          </div>
        </div>
      </article>`;
    function isOpLocked() { return false; }
  }

  /* ================= ПОИСК ================= */
  Pages.search = async function (_params, query = {}) {
    const app = document.getElementById('app');
    const q = (query.q || '').trim();

    app.innerHTML = `
      <div class="section-head"><h2>🔍 Поиск по форуму</h2></div>
      <form class="card" id="bigSearchForm" style="display:flex;gap:10px;margin-bottom:22px">
        <input class="input" id="bigSearchInput" placeholder="Введите запрос…" value="${esc(q)}" maxlength="100">
        <button class="btn primary" type="submit">Найти</button>
      </form>
      <div id="searchResults"></div>
    `;

    document.getElementById('bigSearchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = document.getElementById('bigSearchInput').value.trim();
      location.hash = v ? `#/search?q=${encodeURIComponent(v)}` : '#/search';
    });

    const box = document.getElementById('searchResults');
    if (q.length < 2) {
      box.innerHTML = emptyState('🔎', 'Введите минимум 2 символа', 'Поиск работает по темам, сообщениям и пользователям.');
      return;
    }

    box.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await API.get(`/search?q=${encodeURIComponent(q)}`);
      const sections = [];
      if (r.tagPosts?.items.length) {
        sections.push(`<div class="section-head"><h2>#️⃣ Посты по тегу «${esc(r.tagPosts.tag)}» (${r.tagPosts.total})</h2></div>` +
          r.tagPosts.items.map((p) => `
            <article class="topic-row">
              <div class="topic-main">
                <h3><a href="#/post/${p.id}">${esc(p.title)}</a></h3>
                <div class="topic-tags">
                  ${UI.avatar({ username: p.author_username, avatar_url: p.author_avatar }, 18)} ${esc(p.author_username)} · ${timeAgo(p.created_at)} · 👁 ${fmtNum(p.views)}
                </div>
              </div>
            </article>`).join(''));
      }
      if (r.topics?.items.length) {
        sections.push(`<div class="section-head"><h2>Темы (${r.topics.total})</h2></div>` +
          r.topics.items.map(topicRow).join(''));
      }
      if (r.posts?.items.length) {
        sections.push(`<div class="section-head"><h2>Сообщения (${r.posts.total})</h2></div>` +
          r.posts.items.map((p) => `
            <article class="topic-row">
              <div class="topic-main">
                <h3><a href="#/topic/${p.topic_id}">${esc(p.topic_title)}</a></h3>
                <p class="muted" style="margin:4px 0 0;font-size:.88rem;white-space:pre-wrap;overflow-wrap:anywhere">${esc(p.content.slice(0, 220))}${p.content.length > 220 ? '…' : ''}</p>
                <div class="topic-tags" style="margin-top:6px">
                  ${UI.avatar({ username: p.author_username, avatar_url: p.author_avatar }, 18)} ${esc(p.author_username)} · ${timeAgo(p.created_at)}
                </div>
              </div>
            </article>`).join(''));
      }
      if (r.articles?.items.length) {
        sections.push(`<div class="section-head"><h2>📜 Посты (${r.articles.total})</h2></div>` +
          r.articles.items.map((p) => `
            <article class="topic-row">
              <div class="topic-main">
                <h3><a href="#/post/${p.id}">${esc(p.title)}</a></h3>
                <div class="topic-tags">
                  ${UI.avatar({ username: p.author_username, avatar_url: p.author_avatar }, 18)} ${esc(p.author_username)} · ${timeAgo(p.created_at)} · 👁 ${fmtNum(p.views)}
                </div>
              </div>
            </article>`).join(''));
      }
      if (r.users?.items.length) {
        sections.push(`<div class="section-head"><h2>Пользователи (${r.users.total})</h2></div>` +
          `<div class="grid-cats">` + r.users.items.map((u) => `
            <a class="cat-card" href="#/u/${esc(u.username)}">
              ${avatar(u, 48)}
              <div><h3>${esc(u.username)} ${roleChip(u.role)}</h3>
              <p>${esc(u.bio || 'Без описания')}</p></div>
            </a>`).join('') + `</div>`);
      }
      box.innerHTML = sections.length ? sections.join('')
        : emptyState('🫥', 'Ничего не найдено', `По запросу «${q}» нет результатов.`);
    } catch (e) {
      box.innerHTML = emptyState('⚠️', e.message);
    }
  };

  /* ================= МОДАЛКА ЖАЛОБЫ ================= */
  function reportModal(targetType, targetId) {
    if (!App.user) return App.requireLogin();
    const m = openModal(`
      <h3>⚠ Отправить жалобу</h3>
      <p class="muted" style="margin-top:-6px">Опишите нарушение — модераторы рассмотрят обращение.</p>
      <div class="form-group">
        <label>Причина</label>
        <textarea class="input" id="rpReason" maxlength="500" placeholder="Что не так?" style="min-height:90px"></textarea>
      </div>
      <div class="form-error" id="rpError"></div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="rpSend">Отправить</button>
      </div>
    `);
    m.el.querySelector('#rpSend').addEventListener('click', async () => {
      try {
        await API.post('/reports', {
          target_type: targetType,
          target_id: targetId,
          reason: m.el.querySelector('#rpReason').value.trim(),
        });
        m.close();
        toast('Жалоба отправлена модераторам', 'ok');
      } catch (e) {
        m.el.querySelector('#rpError').textContent = e.message;
      }
    });
  }
  Pages.reportModal = reportModal;
})();