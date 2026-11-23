/* Посты профиля: лента (недавние/популярные/подписки), редактор, страница поста */
window.Pages = window.Pages || {};
(() => {
  const { esc, fmtNum, timeAgo, fullDate, avatar, roleChip, toast, err, openModal,
          confirmDialog, pager, bindPager, uploadImage, emptyState } = UI;

  const VIS_META = {
    public:   ['🌐', 'Публичный', 'Появляется в общей ленте, находится по #тегу'],
    personal: ['👤', 'Личный', 'Виден только в профиле'],
    private:  ['🔒', 'Приватный', 'Доступен только по прямой ссылке'],
  };

  const WEB_FONTS = [
    ['Arial, sans-serif', 'Arial'],
    ['Georgia, serif', 'Georgia'],
    ["'Times New Roman', serif", 'Times New Roman'],
    ["'Courier New', monospace", 'Courier New'],
    ['Verdana, sans-serif', 'Verdana'],
    ["'Trebuchet MS', sans-serif", 'Trebuchet MS'],
  ];

  // соответствие execCommand fontSize (1..7) → em
  const SIZE_MAP = { 1: '.75em', 2: '.85em', 3: '1em', 4: '1.15em', 5: '1.35em', 6: '1.65em', 7: '2em' };

  /** Подключить @font-face для шрифтов поста */
  function injectFonts(fonts) {
    (fonts || []).forEach((f) => {
      if (!f || !f.url || !f.name) return;
      const id = 'font-face-' + f.url.replace(/[^a-z0-9]/gi, '');
      if (document.getElementById(id)) return;
      const st = document.createElement('style');
      st.id = id;
      st.textContent = `@font-face{font-family:'${f.name.replace(/'/g, "\\'")}';src:url('${esc(f.url)}');font-display:swap;}`;
      document.head.appendChild(st);
    });
  }

  const visibilityChip = (v) => {
    const m = VIS_META[v] || VIS_META.public;
    return `<span class="chip vis-chip" title="${esc(m[2])}">${m[0]} ${m[1]}</span>`;
  };
  const postLink = (id) => `#/post/${id}`;
  const fullPostUrl = (id) => `${location.origin}${location.pathname}#/post/${id}`;

  /** Карточка поста (лента, профиль, поиск) */
  function postCard(p, opts = {}) {
    return `
      <article class="post-card" data-post="${p.id}">
        ${p.cover_image ? `<a class="post-card-cover" href="${postLink(p.id)}"><img src="${esc(p.cover_image)}" alt="" loading="lazy"></a>` : ''}
        <div class="post-card-body">
          <div class="post-card-head">
            <a href="#/u/${esc(p.author_username)}">${avatar({ username: p.author_username, avatar_url: p.author_avatar }, 34)}</a>
            <div style="min-width:0">
              <a class="uname" href="#/u/${esc(p.author_username)}">${esc(p.author_username)}</a>
              <div class="muted" style="font-size:.76rem">${timeAgo(p.created_at)} · 👁 ${fmtNum(p.views)}</div>
            </div>
            <span style="flex:1"></span>
            ${opts.showVisibility ? visibilityChip(p.visibility) : ''}
          </div>
          <h3><a href="${postLink(p.id)}">${esc(p.title)}</a></h3>
          ${p.excerpt ? `<p class="muted" style="margin:4px 0 0;font-size:.88rem;overflow-wrap:anywhere">${esc(p.excerpt)}</p>` : ''}
          ${p.tags && p.tags.length ? `<div class="post-tags">${p.tags.map((t) => `<a class="tag-chip" href="#/search?q=%23${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
          ${opts.manage ? `
            <div class="post-card-actions">
              <a class="btn ghost sm" href="#/post-editor?id=${p.id}">✏️ Изменить</a>
              <button class="btn danger sm" data-delpost="${p.id}">🗑</button>
            </div>` : ''}
        </div>
      </article>`;
  }
  Pages.postCard = postCard;

  function bindDeleteButtons(root) {
    root.querySelectorAll('[data-delpost]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить пост?', 'Пост будет удалён безвозвратно.'))) return;
      try {
        await API.del(`/user-posts/${b.dataset.delpost}`);
        toast('Пост удалён', 'ok');
        b.closest('.post-card')?.remove();
      } catch (e) { err(e); }
    }));
  }

  /* ================= ЛЕНТА ================= */
  Pages.feed = async function (_params, query = {}) {
    const app = document.getElementById('app');
    let tab = ['recent', 'popular', 'following'].includes(query.tab) ? query.tab : 'recent';
    let page = 1;

    const tabsHtml = () =>
      [['recent', '🕒 Недавние'], ['popular', '🔥 Популярные'], ['following', '👥 Подписки']]
        .map(([k, l]) => `<a href="javascript:void(0)" data-ftab="${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('');

    async function load() {
      let d = null;
      let loadError = null;
      try {
        d = await API.get(`/feed?tab=${tab}&page=${page}`);
      } catch (e) { loadError = e; }

      const emptyByTab = {
        recent: ['🍡', 'Постов пока нет', 'Станьте первым — опубликуйте пост в профиле!'],
        popular: ['📈', 'Ещё нет популярных постов', 'Посты набирают просмотры — загляните позже.'],
        following: ['👥', 'В ваших подписках тихо', 'Подпишитесь на авторов в их профилях, чтобы видеть их посты здесь.'],
      };
      const [em, et, es] = emptyByTab[tab];

      app.innerHTML = `
        <div class="section-head">
          <h2>📰 Лента</h2>
          ${App.user ? `<a class="btn primary sm" href="#/post-editor">✍️ Создать пост</a>` : ''}
        </div>
        <div class="sort-tabs feed-tabs">${tabsHtml()}</div>
        ${loadError
          ? (loadError.status === 401
            ? emptyState('🔐', 'Войдите в аккаунт', 'Лента подписок доступна авторизованным пользователям.')
            : emptyState('⚠️', loadError.message))
          : (d.items.length
            ? d.items.map((p) => postCard(p)).join('')
            : emptyState(em, et, es))}
        <div id="feedPager"></div>
      `;

      if (d && d.totalPages > 1) {
        document.getElementById('feedPager').innerHTML = pager(d.page ?? page, d.totalPages);
        bindPager(document.getElementById('feedPager'), (pg) => { page = pg; load(); window.scrollTo({ top: 0 }); });
      }

      app.querySelectorAll('[data-ftab]').forEach((a) => a.addEventListener('click', () => {
        tab = a.dataset.ftab; page = 1;
        history.replaceState(null, '', `#/feed?tab=${tab}`);
        load();
      }));
      bindDeleteButtons(app);
    }
    await load();
  };

  /* ================= РЕДАКТОР ================= */
  function renderEditorShell(app, init, editId, coverUrl, loadedFonts) {
    app.innerHTML = `
      <div class="section-head"><h2>${editId ? '✏️ Редактирование поста' : '✨ Новый пост'}</h2></div>
      <div class="editor-layout">
        <div class="card pad-lg">
          <div class="form-group">
            <label>Название *</label>
            <input class="input" id="peTitle" maxlength="200" value="${esc(init.title)}" placeholder="О чём пост? (единственное обязательное поле)">
          </div>

          <label style="font-weight:600;font-size:.88rem">Содержание</label>
          <div class="editor-toolbar" id="peToolbar">
            <button type="button" data-cmd="bold" title="Полужирный"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Курсив"><i>I</i></button>
            <button type="button" data-cmd="underline" title="Подчёркнутый"><u>U</u></button>
            <button type="button" data-cmd="strikeThrough" title="Зачёркнутый"><s>S</s></button>
            <span class="tb-sep"></span>
            <button type="button" data-block="h1" title="Заголовок 1">H1</button>
            <button type="button" data-block="h2" title="Заголовок 2">H2</button>
            <button type="button" data-block="h3" title="Заголовок 3">H3</button>
            <button type="button" data-block="p" title="Обычный текст">¶</button>
            <span class="tb-sep"></span>
            <select id="peFontSize" title="Размер текста">
              <option value="">Размер</option>
              <option value="1">Мелкий</option>
              <option value="3">Обычный</option>
              <option value="4">Крупный</option>
              <option value="5">Очень крупный</option>
              <option value="6">Огромный</option>
            </select>
            <select id="peFontFamily" title="Шрифт">
              <option value="">Шрифт</option>
              ${WEB_FONTS.map((f) => `<option value="${esc(f[0])}">${esc(f[1])}</option>`).join('')}
              ${loadedFonts.map((f) => `<option value="${esc(f.name)}">🎨 ${esc(f.name)}</option>`).join('')}
            </select>
            <button type="button" id="peFontUpload" title="Загрузить свой шрифт (TTF/OTF/WOFF/WOFF2)">🎨+</button>
            <input type="file" id="peFontFile" accept=".ttf,.otf,.woff,.woff2" class="hidden">
            <span class="tb-sep"></span>
            <button type="button" data-align="justifyLeft" title="По левому краю">⬅</button>
            <button type="button" data-align="justifyCenter" title="По центру">↔</button>
            <span class="tb-sep"></span>
            <button type="button" id="peImgBtn" title="Вставить изображение в текущую позицию">🖼</button>
            <input type="file" id="peImgFile" accept="image/*" class="hidden">
            <button type="button" data-cmd="removeFormat" title="Очистить форматирование">⌫𝑓</button>
          </div>
          <div class="editor-area" id="peArea" contenteditable="true" data-placeholder="Пишите здесь… вставляйте фото, меняйте шрифты и размеры"></div>

          <div class="form-group" style="margin-top:16px">
            <label>Теги (для поиска по #, через запятую)</label>
            <input class="input" id="peTags" value="${esc((init.tags || []).map((t) => '#' + t).join(', '))}" placeholder="#моти, #дизайн">
          </div>
        </div>

        <div class="editor-side">
          <div class="card pad-lg">
            <h3 style="margin-top:0">👁 Как отображать</h3>
            ${Object.entries(VIS_META).map(([k, [icon, name, desc]]) => `
              <label class="vis-option">
                <input type="radio" name="peVis" value="${k}" ${init.visibility === k ? 'checked' : ''}>
                <span><b>${icon} ${name}</b><br><span class="muted" style="font-size:.8rem">${desc}</span></span>
              </label>`).join('')}
          </div>

          <div class="card pad-lg">
            <h3 style="margin-top:0">🖼 Обложка</h3>
            <input type="file" id="peCover" accept="image/*" class="hidden">
            <div id="peCoverPreview" class="cover-preview ${coverUrl ? '' : 'hidden'}">${coverUrl ? `<img src="${esc(coverUrl)}" alt="">` : ''}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn ghost sm" id="peCoverBtn">Выбрать обложку</button>
              <button class="btn ghost sm ${coverUrl ? '' : 'hidden'}" id="peCoverDel">Убрать</button>
            </div>
          </div>

          <div class="card pad-lg">
            <div class="form-error" id="peError"></div>
            <button class="btn primary block" id="peSubmit">${editId ? '💾 Сохранить изменения' : '✨ Опубликовать'}</button>
            <a class="btn ghost block" style="margin-top:8px" href="${editId ? `#/post/${editId}` : '#/'}">Отмена</a>
          </div>
        </div>
      </div>`;
  }

  /** Тулбар редактора: команды, размеры, шрифты, загрузка шрифтов и фото */
  function bindEditorToolbar(area, loadedFonts) {
    const $ = (id) => document.getElementById(id);

    $('peToolbar').addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault(); // не терять выделение
    });
    $('peToolbar').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null);
      else if (b.dataset.block) document.execCommand('formatBlock', false, b.dataset.block);
      else if (b.dataset.align) document.execCommand(b.dataset.align);
    });
    $('peFontSize').addEventListener('change', (e) => {
      if (e.target.value) document.execCommand('fontSize', false, e.target.value);
      e.target.value = '';
    });
    $('peFontFamily').addEventListener('change', (e) => {
      if (e.target.value) document.execCommand('fontName', false, e.target.value);
      e.target.value = '';
    });

    // загрузка пользовательского шрифта
    $('peFontUpload').addEventListener('click', () => $('peFontFile').click());
    $('peFontFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const fd = new FormData();
        fd.append('font', file);
        const r = await API.upload('/upload/font', fd);
        if (!loadedFonts.some((f) => f.url === r.url)) {
          loadedFonts.push({ name: r.name, url: r.url });
          injectFonts([r]);
          const sel = $('peFontFamily');
          const opt = document.createElement('option');
          opt.value = r.name;
          opt.textContent = '🎨 ' + r.name;
          sel.appendChild(opt);
        }
        $('peFontFamily').value = r.name;
        document.execCommand('fontName', false, r.name);
        toast(`Шрифт «${r.name}» загружен — можно применять к тексту`, 'ok');
      } catch (ex) { err(ex); }
    });

    // вставка изображения в текущую позицию курсора
    $('peImgBtn').addEventListener('click', () => $('peImgFile').click());
    $('peImgFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const url = await uploadImage(file);
        area.focus();
        document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="">`);
        toast('Фото вставлено', 'ok');
      } catch (ex) { err(ex); }
    });
  }

  /** Видимость, обложка, теги, сохранение */
  function bindEditorMeta(setCoverUrl) {
    const $ = (id) => document.getElementById(id);
    $('peCoverBtn').addEventListener('click', () => $('peCover').click());
    $('peCover').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const url = await uploadImage(file);
        const pv = $('peCoverPreview');
        pv.classList.remove('hidden');
        pv.innerHTML = `<img src="${esc(url)}" alt="">`;
        $('peCoverDel').classList.remove('hidden');
        pv.dataset.url = url;
        setCoverUrl(url);
        toast('Обложка готова', 'ok');
      } catch (ex) { err(ex); }
    });
    $('peCoverDel').addEventListener('click', () => {
      const pv = $('peCoverPreview');
      pv.classList.add('hidden');
      pv.innerHTML = '';
      delete pv.dataset.url;
      $('peCoverDel').classList.add('hidden');
      setCoverUrl(null);
    });
  }

  function bindEditorSubmit(editId, area, loadedFonts, getCoverUrl) {
    const $ = (id) => document.getElementById(id);
    $('peSubmit').addEventListener('click', async () => {
      const errBox = $('peError');
      errBox.textContent = '';
      const title = $('peTitle').value.trim();
      if (!title) { errBox.textContent = 'Название — единственное обязательное поле'; return; }

      // <font size="n"> → <span style="font-size:...">
      const tmp = document.createElement('div');
      tmp.innerHTML = area.innerHTML;
      tmp.querySelectorAll('font[size]').forEach((f) => {
        const s = document.createElement('span');
        s.style.fontSize = SIZE_MAP[f.getAttribute('size')] || '1em';
        s.innerHTML = f.innerHTML;
        f.replaceWith(s);
      });
      // шрифты: сохраняем только реально использованные
      const usedFonts = loadedFonts.filter((f) => tmp.innerHTML.includes(f.name));

      const pvUrl = getCoverUrl() || null;
      const body = {
        title,
        visibility: document.querySelector('input[name="peVis"]:checked').value,
        tags: $('peTags').value,
        content: { html: tmp.innerHTML, fonts: usedFonts },
        cover_image: pvUrl || '',
      };
      const btn = $('peSubmit');
      btn.disabled = true;
      try {
        const r = editId
          ? await API.patch(`/user-posts/${editId}`, body)
          : await API.post('/user-posts', body);
        toast(editId ? 'Пост обновлён!' : 'Пост опубликован!', 'ok');
        location.hash = `#/post/${r.post.id}`;
      } catch (ex) {
        errBox.textContent = ex.message;
        btn.disabled = false;
      }
    });
  }

  Pages.postEditor = async function (query = {}) {
    if (!App.user) return App.requireLogin();
    const app = document.getElementById('app');
    const editId = query.id ? +query.id : null;
    let coverUrl = null;
    const loadedFonts = []; // [{name, url}]

    let init = { title: '', html: '', fonts: [], tags: [], visibility: 'public' };
    if (editId) {
      try {
        const d = await API.get(`/user-posts/${editId}`);
        if (!d.post.is_author && App.user.role !== 'admin') {
          app.innerHTML = emptyState('🚫', 'Нет прав', 'Редактировать можно только свои посты.');
          return;
        }
        init = {
          title: d.post.title,
          html: d.post.content?.html || '',
          fonts: d.post.content?.fonts || [],
          tags: d.post.tags || [],
          visibility: d.post.visibility,
        };
        coverUrl = d.post.cover_image;
        (d.post.content?.fonts || []).forEach((f) => loadedFonts.push(f));
      } catch (e) {
        app.innerHTML = emptyState('⚠️', e.message);
        return;
      }
    }
    injectFonts(loadedFonts);
    renderEditorShell(app, init, editId, coverUrl, loadedFonts);

    const area = document.getElementById('peArea');
    area.innerHTML = init.html;
    bindEditorToolbar(area, loadedFonts);
    bindEditorMeta((v) => { coverUrl = v; });
    bindEditorSubmit(editId, area, loadedFonts, () => coverUrl);
  };

  /* ================= СТРАНИЦА ПОСТА ================= */
  Pages.post = async function (id) {
    const app = document.getElementById('app');
    let d;
    try {
      d = await API.get(`/user-posts/${id}`);
    } catch (e) {
      app.innerHTML = emptyState('🫥', e.message, 'Возможно, ссылка устарела или пост удалён.');
      return;
    }
    const p = d.post;
    const me = App.user;
    const own = !!p.is_author;
    const staff = me && ['moderator', 'admin'].includes(me.role);
    document.title = `${p.title} · M-o-chi.com`;
    injectFonts(p.content?.fonts);

    app.innerHTML = `
      <nav class="muted" style="margin-bottom:14px;font-size:.88rem">
        <a href="#/">Главная</a> / <a href="#/feed">Лента</a> / <a href="#/u/${esc(p.author_username)}">${esc(p.author_username)}</a>
      </nav>
      <article class="card pad-lg post-view">
        ${p.cover_image ? `<img class="post-cover" src="${esc(p.cover_image)}" alt="">` : ''}
        <div class="post-view-head">
          ${visibilityChip(p.visibility)}
          <span class="muted" style="font-size:.8rem">👁 ${fmtNum(p.views)} · ${timeAgo(p.created_at)}${p.updated_at && p.updated_at !== p.created_at ? ' · изменён' : ''}</span>
        </div>
        <h1 style="margin:10px 0 4px">${esc(p.title)}</h1>
        <div class="post-view-author">
          <a href="#/u/${esc(p.author_username)}">${avatar({ username: p.author_username, avatar_url: p.author_avatar }, 44)}</a>
          <div>
            <a class="uname" href="#/u/${esc(p.author_username)}">${esc(p.author_username)}</a> ${roleChip(p.author_role)}
            <div class="muted" style="font-size:.78rem">${fullDate(p.created_at)}</div>
          </div>
        </div>
        ${p.tags && p.tags.length ? `<div class="post-tags">${p.tags.map((t) => `<a class="tag-chip" href="#/search?q=%23${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
        <div class="post-content-html">${p.content?.html || '<p class="muted">Пост без содержимого.</p>'}</div>

        ${d.topic
          ? `<div class="post-topic-link"><a class="btn ghost" href="#/topic/${d.topic.id}">💬 ${esc(d.topic.title)}</a></div>`
          : (own ? `<div class="post-topic-link"><button class="btn primary" id="postMakeTopic" title="Тему может создать только автор поста">💬 Создать тему обсуждения</button></div>` : '')}

        <div class="post-view-actions">
          <button class="btn ghost sm" id="postCopyLink">🔗 Скопировать ссылку</button>
          ${own ? `<a class="btn ghost sm" href="#/post-editor?id=${p.id}">✏️ Редактировать</a>` : ''}
          ${own || staff ? `<button class="btn danger sm" id="postDelete">🗑 Удалить</button>` : ''}
        </div>
      </article>`;

    document.getElementById('postCopyLink').addEventListener('click', async () => {
      const url = fullPostUrl(p.id);
      try {
        await navigator.clipboard.writeText(url);
        toast('Ссылка скопирована 🔗', 'ok');
      } catch {
        openModal(`<h3>🔗 Ссылка на пост</h3><textarea class="input" rows="2">${esc(url)}</textarea>`);
      }
    });

    const mkT = document.getElementById('postMakeTopic');
    if (mkT) mkT.addEventListener('click', async () => {
      mkT.disabled = true;
      try {
        const r = await API.post(`/user-posts/${p.id}/topic`, {});
        toast('Тема создана!', 'ok');
        location.hash = `#/topic/${r.topic.id}`;
      } catch (e) { err(e); mkT.disabled = false; }
    });

    const del = document.getElementById('postDelete');
    if (del) del.addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить пост?', 'Пост будет удалён безвозвратно.'))) return;
      try {
        await API.del(`/user-posts/${p.id}`);
        toast('Пост удалён', 'ok');
        location.hash = `#/u/${esc(p.author_username)}`;
      } catch (e) { err(e); }
    });
  };
})();