/* Mochi chats: лента (недавние/популярные/подписки), мои чатсы, уведомления, настройки, создание */
window.Pages = window.Pages || {};
(() => {
  const { esc, fmtNum, timeAgo, avatar, toast, err, openModal, confirmDialog, uploadImage, emptyState } = UI;

  const KIND_META = {
    public:  ['🌐', 'Публичный', 'Вступить может кто угодно'],
    request: ['📥', 'По заявке', 'Для вступления нужно одобрение'],
    private: ['🔒', 'Приватный', 'Только по приглашению'],
  };
  const kindChip = (kind) => {
    const m = KIND_META[kind] || KIND_META.public;
    return `<span class="kind-chip ${esc(kind)}" title="${esc(m[2])}">${m[0]} ${m[1]}</span>`;
  };
  Pages.kindChip = kindChip;

  /** Карточка чатса для ленты */
  function chatCardEl(c) {
    const photoStyle = c.photo && /^\/uploads\//.test(c.photo)
      ? `style="background-image:url('${esc(c.photo)}')"` : '';
    return `
      <a class="chat-card" href="#/chat/${c.id}">
        <div class="chat-card-photo" ${photoStyle}>${!photoStyle ? esc(c.photo || '🍡') : ''}</div>
        <div class="chat-card-body">
          <div class="chat-card-title"><h3>${esc(c.name)}</h3>${kindChip(c.kind)}</div>
          <div class="chat-card-excerpt">${esc(c.excerpt || 'Без описания')}</div>
          ${c.tags && c.tags.length ? `<div class="post-tags">${c.tags.map((t) => `<span class="tag-chip">#${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="chat-card-meta">
            <span>👥 ${fmtNum(c.member_count)}</span>
            <span>💬 ${fmtNum(c.messages_count)}</span>
            ${c.my_status === 'member' ? '<span style="color:var(--ok)">✓ вы участник</span>' : ''}
            ${c.my_status === 'pending' ? '<span style="color:var(--warn)">⏳ заявка</span>' : ''}
          </div>
          <div class="chat-card-meta">
            ${UI.avatar({ username: c.owner_username, avatar_url: c.owner_avatar }, 18)}
            <span>${esc(c.owner_username || '')}</span>
            <span>· ${timeAgo(c.created_at)}</span>
          </div>
        </div>
      </a>`;
  }
  Pages.chatCardEl = chatCardEl;

  /* ================= ЛЕНТА ЧАТСОВ ================= */
  Pages.chatsFeed = async function (_m, query = {}) {
    const app = document.getElementById('app');
    Chats.applyChatTheme(null);
    let tab = ['recent', 'popular', 'subs'].includes(query.tab) ? query.tab : 'recent';
    let q = query.q || '';
    let tag = query.tag || '';
    let page = 1;
    let totalPages = 1;

    async function load() {
      const params = new URLSearchParams({ tab, page });
      if (q) params.set('q', q);
      if (tag) params.set('tag', tag);
      let d;
      try {
        d = await API.get(`/gchats?${params}`);
      } catch (e) {
        app.innerHTML = emptyState(e.status === 403 ? '🔐' : '⚠️', e.message,
          e.status === 403 ? 'Лента подписок доступна после входа.' : '');
        return;
      }
      totalPages = d.totalPages || 1;
      const head = `
        <div class="section-head">
          <h2>🍡 Лента чатсов</h2>
          ${Chats.user ? `<a class="btn primary sm" href="#/create">＋ Создать чатс</a>` : ''}
        </div>
        <form id="chatsSearchForm" class="searchbar" style="max-width:100%;margin-bottom:12px" role="search">
          <input id="chatsSearchInput" type="search" placeholder="Поиск чатсов по названию, описанию или #тегу…" value="${esc(q || (tag ? '#' + tag : ''))}" maxlength="100">
          <button type="submit" class="btn ghost sm">🔍</button>
        </form>
        <div class="feed-tabs" style="display:flex;gap:6px;margin-bottom:14px">
          <button data-tab="recent" class="${tab === 'recent' ? 'active' : ''}">🆕 Недавние</button>
          <button data-tab="popular" class="${tab === 'popular' ? 'active' : ''}">🔥 Популярные</button>
          <button data-tab="subs" class="${tab === 'subs' ? 'active' : ''}">👥 Подписки</button>
        </div>`;

      const list = d.items.length
        ? `<div class="chats-grid">${d.items.map(chatCardEl).join('')}</div>`
        : emptyState('🫧', 'Чатсов пока нет', tab === 'subs' ? 'Подпишитесь на авторов на форуме — их чатсы появятся здесь.' : 'Создайте первый чатс!');
      const pagerHtml = totalPages > 1 ? `<div class="pager" id="chatsPager"></div>` : '';
      app.innerHTML = head + list + pagerHtml;

      if (totalPages > 1) {
        document.getElementById('chatsPager').innerHTML = UI.pager(d.page, totalPages);
        UI.bindPager(document.getElementById('chatsPager'), (p) => { page = p; load(); window.scrollTo({ top: 0 }); });
      }
      app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        tab = b.dataset.tab; page = 1; tag = ''; q = '';
        load();
      }));
      document.getElementById('chatsSearchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = document.getElementById('chatsSearchInput').value.trim();
        if (v.startsWith('#')) { tag = v.slice(1).trim(); q = ''; }
        else { q = v; tag = ''; }
        page = 1;
        load();
      });
    }
    await load();
  };
  /* ================= МОИ ЧАТСЫ ================= */
  Pages.chatsMine = async function () {
    const app = document.getElementById('app');
    Chats.applyChatTheme(null);
    if (!Chats.user) return Chats.requireLogin();

    const [mine, invites] = await Promise.all([
      API.get('/gchats/mine'),
      API.get('/gchats/invites'),
    ]);

    app.innerHTML = `
      <div class="section-head">
        <h2>💬 Мои чатсы</h2>
        <a class="btn primary sm" href="#/create">＋ Создать чатс</a>
      </div>
      ${invites.items.length ? `
        <div class="side-panel" style="margin-bottom:16px">
          <b>📨 Приглашения (${invites.items.length})</b>
          ${invites.items.map((i) => `
            <div class="notif-row" data-invite="${i.id}">
              <div style="flex:1">
                <b>${esc(i.chat_name)}</b> ${kindChip(i.kind)}
                <div class="muted" style="font-size:.8rem">от ${esc(i.inviter_username)} · ${timeAgo(i.created_at)}</div>
              </div>
              <button class="btn primary sm" data-inv="accept">Принять</button>
              <button class="btn ghost sm" data-inv="decline">Отклонить</button>
            </div>`).join('')}
        </div>` : ''}
      <div class="my-chats-list">
        ${mine.items.length ? mine.items.map((c) => `
          <div class="conv-item" data-chat="${c.id}">
            ${c.photo && /^\/uploads\//.test(c.photo)
              ? `<span class="avatar" style="width:44px;height:44px"><img src="${esc(c.photo)}" alt=""></span>`
              : `<span class="avatar" style="width:44px;height:44px;font-size:20px">${esc(c.photo || '🍡')}</span>`}
            <div style="min-width:0;flex:1">
              <div class="conv-name">${esc(c.name)} ${kindChip(c.kind)}</div>
              <div class="conv-last">${esc((c.last_content || 'Нет сообщений').slice(0, 60))}</div>
            </div>
            ${+c.unread > 0 ? `<span class="unread-pill">${c.unread}</span>` : ''}
          </div>`).join('')
        : emptyState('🍡', 'Вы пока не в одном чатсе', 'Загляните в ленту и присоединяйтесь!')}
      </div>`;

    app.querySelectorAll('[data-chat]').forEach((el) => {
      el.addEventListener('click', () => { location.hash = `#/chat/${el.dataset.chat}`; });
    });
    app.querySelectorAll('[data-invite]').forEach((row) => {
      const invId = row.dataset.invite;
      row.querySelectorAll('[data-inv]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await API.post(`/gchats/invites/${invId}`, { action: btn.dataset.inv });
            toast(btn.dataset.inv === 'accept' ? 'Приглашение принято!' : 'Приглашение отклонено', 'ok');
            Pages.chatsMine();
          } catch (e) { err(e); }
        });
      });
    });
  };
  /* ================= СОЗДАНИЕ ЧАТСА ================= */
  Pages.chatsCreate = async function () {
    const app = document.getElementById('app');
    Chats.applyChatTheme(null);
    if (!Chats.user) return Chats.requireLogin();

    app.innerHTML = `
      <div class="section-head"><h2>✨ Новый чатс</h2></div>
      <div class="card pad-lg" style="max-width:640px">
        <div class="form-group">
          <label>Тип чатса *</label>
          <div class="feed-tabs" style="display:flex;gap:6px">
            <button type="button" data-kind="public" class="active">🌐 Публичный</button>
            <button type="button" data-kind="request">📥 По заявке</button>
            <button type="button" data-kind="private">🔒 Приватный</button>
          </div>
          <p class="muted" id="kindHint" style="font-size:.82rem;margin:6px 0 0">Вступить может кто угодно</p>
        </div>
        <div class="form-group">
          <label>Название *</label>
          <input class="input" id="gcName" maxlength="80" placeholder="Например: Знакомства ирл">
        </div>
        <div class="form-group">
          <label>Фото / иконка</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="input" id="gcIcon" maxlength="8" placeholder="🍡 или ссылка" style="max-width:180px">
            <input type="file" id="gcPhoto" accept="image/*" class="hidden">
            <button class="btn ghost sm" id="gcPhotoBtn">📷 Загрузить фото</button>
            <img id="gcPhotoPrev" class="upload-preview hidden" alt="">
          </div>
        </div>
        <div class="form-group">
          <label>Теги (через запятую)</label>
          <input class="input" id="gcTags" placeholder="аниме, игры, музыка">
        </div>
        <div id="privateExtras" class="hidden">
          <div class="form-group">
            <label>Пригласить участника (никнейм, необязательно)</label>
            <input class="input" id="gcInitial" placeholder="sakura">
          </div>
          <div class="form-group">
            <label><input type="checkbox" id="gcOpen" checked> Все участники могут менять название и иконку</label>
          </div>
        </div>
        <div class="form-error" id="gcError"></div>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn primary" id="gcGo">Создать чатс</button>
          <a class="btn ghost" href="#/">Отмена</a>
        </div>
      </div>`;

    let kind = 'public';
    let photoUrl = null;
    const hints = {
      public: 'Вступить может кто угодно',
      request: 'Для вступления подаётся заявка — владелец её одобряет',
      private: 'Только по приглашению; отображается в личных сообщениях',
    };
    app.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
      kind = b.dataset.kind;
      app.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('active', x === b));
      document.getElementById('kindHint').textContent = hints[kind];
      document.getElementById('privateExtras').classList.toggle('hidden', kind !== 'private');
    }));
    document.getElementById('gcPhotoBtn').addEventListener('click', () => document.getElementById('gcPhoto').click());
    document.getElementById('gcPhoto').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const prev = document.getElementById('gcPhotoPrev');
      prev.src = URL.createObjectURL(f);
      prev.classList.remove('hidden');
      try {
        photoUrl = await uploadImage(f);
        prev.src = photoUrl;
        toast('Фото загружено', 'ok');
      } catch (ex) { err(ex); }
    });

    document.getElementById('gcGo').addEventListener('click', async () => {
      const body = {
        kind,
        name: document.getElementById('gcName').value.trim(),
        photo: photoUrl || document.getElementById('gcIcon').value.trim(),
        tags: document.getElementById('gcTags').value,
      };
      if (kind === 'private') {
        body.initial_member = document.getElementById('gcInitial').value.trim();
        body.private_open = document.getElementById('gcOpen').checked;
      }
      try {
        const r = await API.post('/gchats', body);
        toast('Чатс создан! 🎉', 'ok');
        location.hash = `#/chat/${r.chat.id}`;
      } catch (e) {
        document.getElementById('gcError').textContent = e.message;
      }
    });
  };
  /* ================= УВЕДОМЛЕНИЯ ЧАТСОВ ================= */
  const NOTIF_TEXT = {
    chat_request:        (n) => `хочет вступить в «${n.payload?.chat_name || 'чатс'}»`,
    chat_approved:       (n) => `одобрил(а) вашу заявку в «${n.payload?.chat_name || 'чатс'}» 🎉`,
    chat_declined:       (n) => `отклонил(а) вашу заявку в «${n.payload?.chat_name || 'чатс'}»`,
    chat_invite:         (n) => `приглашает вас в «${n.payload?.chat_name || 'чатс'}»`,
    chat_invite_accepted:(n) => `принял(а) приглашение в «${n.payload?.chat_name || 'чатс'}»`,
    chat_invite_declined:(n) => `отклонил(а) приглашение в «${n.payload?.chat_name || 'чатс'}»`,
    chat_kicked:         (n) => `выгнал(а) вас из «${n.payload?.chat_name || 'чатса'}» 😢`,
    chat_banned:         (n) => `забанил(а) вас в «${n.payload?.chat_name || 'чатсе'}»`,
    chat_requests_blocked: (n) => `запретил(а) вам отправлять заявки в «${n.payload?.chat_name || 'чатс'}»`,
    chat_added:          (n) => `добавил(а) вас в «${n.payload?.chat_name || 'чатс'}»`,
    persona_request:     (n) => `просит одобрить персону «${n.payload?.persona_name || ''}» в «${n.payload?.chat_name || 'чатсе'}»`,
    persona_approved:    (n) => `одобрил(а) вашу персону «${n.payload?.persona_name || ''}» ✨`,
    persona_declined:    (n) => `отклонил(а) вашу персону «${n.payload?.persona_name || ''}»`,
    mention:             (n) => `упомянул(а) вас в «${n.payload?.chat_name || 'чатсе'}»${n.payload?.count > 1 ? ` (×${n.payload.count})` : ''}`,
  };
  Pages.NOTIF_TEXT = NOTIF_TEXT;

  Pages.chatsNotifications = async function () {
    const app = document.getElementById('app');
    Chats.applyChatTheme(null);
    if (!Chats.user) return Chats.requireLogin();

    const d = await API.get('/notifications?types=' + Object.keys(NOTIF_TEXT).join(','));
    app.innerHTML = `
      <div class="section-head">
        <h2>🔔 Уведомления чатсов</h2>
        ${d.items.length ? '<button class="btn ghost sm" id="readAllBtn">✓ Прочитать всё</button>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${d.items.length ? d.items.map((n) => {
          const txt = (NOTIF_TEXT[n.type] || (() => 'событие в чатсе'))(n);
          const link = n.entity_type === 'gchat' && n.entity_id ? `#/chat/${n.entity_id}` : '#/';
          return `
            <div class="notif-row ${n.read ? '' : 'unread'}">
              <a href="/#/u/${esc(n.actor_username || '')}">${avatar({ username: n.actor_username, avatar_url: n.actor_avatar }, 38)}</a>
              <div style="flex:1;min-width:0">
                <div><a href="/#/u/${esc(n.actor_username || '')}"><b>${esc(n.actor_username || 'Кто-то')}</b></a> ${esc(txt)}</div>
                ${n.payload?.preview ? `<div class="muted" style="font-size:.82rem">«${esc(n.payload.preview)}»</div>` : ''}
                <div class="muted" style="font-size:.75rem">${timeAgo(n.created_at)} · <a href="${link}">открыть чатс</a></div>
              </div>
            </div>`;
        }).join('')
        : emptyState('🔕', 'Тишина', 'Уведомлений о заявках, приглашениях и упоминаниях пока нет.')}
      </div>`;

    const ra = document.getElementById('readAllBtn');
    if (ra) ra.addEventListener('click', async () => {
      await API.post('/notifications/read', {});
      Pages.chatsNotifications();
      Chats.pollBadge();
    });
  };
})();





