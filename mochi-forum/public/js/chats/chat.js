/* Mochi chats: страница чатса — описание, вступление, сообщения, персоны, участники, админка */
window.Pages = window.Pages || {};
(() => {
  const { esc, fmtNum, timeAgo, fullDate, avatar, toast, err, openModal, confirmDialog, uploadImage, emptyState } = UI;

  const fmtTime = (s) => new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  /* Разнообразие индикатора печати */
  const TYPING_ONE = [
    '{u} набирает сообщение…',
    '{u} думает что сказать…',
    '{u} ищет нужную клавишу…',
    '{u} печатает…',
    '{u} подбирает слова…',
    '{u} строчит…',
  ];
  const TYPING_MANY = [
    'Несколько людей печатает…',
    'Целая куча людей печатает…',
    'Моти перегружен людьми…',
    'Все сразу что-то печатают…',
    'Чат горит!',
  ];
  function typingText(list) {
    if (!list.length) return '';
    if (list.length > 3) {
      return TYPING_MANY[Math.floor(Math.random() * TYPING_MANY.length)];
    }
    const tpl = TYPING_ONE[Math.floor(Math.random() * TYPING_ONE.length)];
    return tpl.replace('{u}', list[0].username);
  }

  /** Контекстное меню (правая кнопка мыши) */
  function ctxMenu(x, y, items) {
    document.querySelectorAll('.ctx-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = items.map(([label, cls]) => `<button class="${cls || ''}">${label}</button>`).join('');
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
    menu.querySelectorAll('button').forEach((b, i) => {
      b.addEventListener('click', () => { menu.remove(); items[i][2](); });
    });
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }
  Pages.ctxMenu = ctxMenu;
  /* ================= UI-ПРЕДПОЧТЕНИЯ ЧАТСА (рейка) ================= */
  let curUiPref = { desc: true, members: true };
  function loadChatUiPref(id) {
    try {
      return { desc: true, members: true, ...JSON.parse(localStorage.getItem(`mochi_chatui_${id}`) || '{}') };
    } catch { return { desc: true, members: true }; }
  }
  function saveChatUiPref(id, pref) {
    try { localStorage.setItem(`mochi_chatui_${id}`, JSON.stringify(pref)); } catch { /* ignore */ }
  }
  function applyChatUiState(pref) {
    const shell = document.querySelector('.gchat-shell');
    const cols = document.querySelector('.gchat-columns');
    if (!shell || !cols) return;
    shell.classList.toggle('hide-desc', !pref.desc);
    shell.classList.toggle('hide-members', !pref.members);
    cols.classList.toggle('has-side', cols.dataset.hasSide === '1' && pref.members);
    const panel = document.getElementById('membersPanel');
    if (panel) panel.style.display = pref.members ? '' : 'none';
    const rd = document.getElementById('railDesc');
    const rm = document.getElementById('railMembers');
    if (rd) rd.classList.toggle('active', pref.desc);
    if (rm) rm.classList.toggle('active', pref.members);
  }

  /* ================= СТРАНИЦА ЧАТСА ================= */
  Pages.chatsChat = async function (id) {
    const app = document.getElementById('app');
    let data;
    try {
      data = await API.get(`/gchats/${id}`);
    } catch (e) {
      app.innerHTML = emptyState('🚫', e.message, 'Возможно, это приватный чатс или вы забанены.');
      return;
    }
    const { chat, me, members, roles, subchats } = data;
    curMe = me;
    Chats.applyChatTheme(chat.theme);
    document.title = `${chat.name} · Mochi chats`;

    /* --- фоны шапки и описания (раздельные) --- */
    function bgStyleFor(bg) {
      if (!bg) return 'background:#f4f6fc;';
      if (bg.type === 'gradient') return `background:linear-gradient(135deg, ${bg.color}, ${bg.color2});`;
      if (bg.type === 'image' && bg.url) return `background-image:url('${esc(bg.url)}');background-size:cover;background-position:center;`;
      return `background:${bg.color || '#f4f6fc'};`;
    }
    const headBg = bgStyleFor(chat.head_bg || chat.desc_bg);
    const descBgStyle = bgStyleFor(chat.desc_bg);
    (chat.description?.fonts || []).forEach((f) => Chats.injectFont(f));

    const kindLabel = chat.kind === 'public' ? '🌐 Публичный'
      : chat.kind === 'request' ? '📥 По заявке' : '🔒 Приватный';
    const photoHtml = chat.photo && /^\/uploads\//.test(chat.photo)
      ? `<div class="gchat-hero-photo"><img src="${esc(chat.photo)}" alt=""></div>`
      : `<div class="gchat-hero-photo">${esc(chat.photo || '🍡')}</div>`;

    let joinArea = '';
    if (data.my_ban && data.my_ban.kind === 'ban') {
      joinArea = `<span class="chip" style="color:var(--danger)">⛔ Вы забанены${data.my_ban.until ? ` до ${fullDate(data.my_ban.until)}` : ' навсегда'}${data.my_ban.reason ? ` — «${esc(data.my_ban.reason)}»` : ''}</span>`;
    } else if (me.is_member) {
      joinArea = `<span class="chip" style="color:var(--ok)">✓ Вы участник${me.is_owner ? ' — ведущий' : ''}</span>`;
    } else if (data.my_join_request && data.my_join_request.status === 'pending') {
      joinArea = `<span class="chip" style="color:var(--warn)">⏳ Заявка на рассмотрении</span>`;
    } else if (chat.kind === 'request' && data.my_join_request && data.my_join_request.cooldown_until) {
      joinArea = `<span class="chip" style="color:var(--warn)">Заявку можно отправить после ${fullDate(data.my_join_request.cooldown_until)}</span>`;
    } else {
      joinArea = chat.kind === 'public'
        ? `<button class="btn primary" id="joinBtn">🚪 Вступить</button>`
        : chat.kind === 'request'
          ? `<button class="btn primary" id="joinBtn">📥 Подать заявку</button>`
          : `<span class="chip">🔒 Вступление только по приглашению</span>`;
    }

    const topicLink = chat.topic_id
      ? `<a class="btn ghost sm" href="/#/topic/${chat.topic_id}">💬 «Чатс: ${esc(chat.name)}» на форуме</a>` : '';
    const uiPref = curUiPref = loadChatUiPref(id);

    app.innerHTML = `
      <div class="gchat-shell ${uiPref.desc ? '' : 'hide-desc'} ${me.is_member && !uiPref.members ? 'hide-members' : ''}">
        <div class="gchat-hero">
          <div class="gchat-hero-head" style="${headBg}">
            ${photoHtml}
            <div class="gchat-hero-titles" style="flex:1;min-width:0">
              <h1>${esc(chat.name)}</h1>
              <div class="muted" style="font-size:.85rem;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                <span>${kindLabel}</span>
                <span>👥 ${fmtNum(chat.member_count)}</span>
                <span>💬 ${fmtNum(chat.messages_count)}</span>
                ${chat.owner_username ? `<a href="/#/u/${esc(chat.owner_username)}" style="color:inherit">🍰 ${esc(chat.owner_username)} — ведущий</a>` : ''}
              </div>
              <div class="gchat-hero-actions">
                ${joinArea}
                ${me.is_member && !me.is_owner ? '<button class="btn ghost sm" id="leaveBtn">🚶 Выйти из чатса</button>' : ''}
                ${(me.is_member && (chat.kind === 'private' || me.perms.includes('invite') || me.is_owner)) ? '<button class="btn ghost sm" id="inviteBtn">📨 Пригласить</button>' : ''}
                ${(me.is_owner || me.perms.includes('manage')) ? '<button class="btn ghost sm" id="adminBtn">🛠 Панель управления</button>' : ''}
                ${topicLink}
              </div>
            </div>
          </div>
          <div class="gchat-desc" style="${descBgStyle}">
            <div class="post-content-html">${chat.description?.html || '<p class="muted">Описание пока пустое.</p>'}</div>
            ${chat.tags && chat.tags.length ? `<div class="gchat-tags">${chat.tags.map((t) => `<span class="tag-chip">#${esc(t)}</span>`).join('')}</div>` : ''}
          </div>
        </div>

        ${data.can_view_messages ? `
        <div class="gchat-columns ${me.is_member && uiPref.members ? 'has-side' : ''}" data-has-side="${me.is_member ? '1' : '0'}">
          <div class="gchat-col-main">
            ${chat.announcement ? `<div class="pinned-bar announce-bar" id="announceBar">📢 <b>Сообщение для участников:</b> ${esc(chat.announcement)}</div>` : ''}
            <div class="thread-topline">
              <div class="subchat-tabs" id="subchatTabs" style="${me.is_member && subchats.length ? '' : 'display:none'}">
                <button class="btn ghost sm active" data-sub="0">🍙 Основной</button>
                ${subchats.map((s) => `<button class="btn ghost sm" data-sub="${s.id}">${esc(s.icon || '💬')} ${esc(s.name)}</button>`).join('')}
              </div>
              <div style="display:flex;gap:8px">
                <button class="icon-btn pinned-open-btn" id="searchOpenBtn" title="Поиск по сообщениям">🔍</button>
                <button class="icon-btn pinned-open-btn" id="pinnedOpenBtn" title="Закреплённые сообщения">📌</button>
              </div>
            </div>
            <div class="gchat-thread-box">
              <div class="gchat-messages" id="msgBox"><div class="spinner"></div></div>
              ${me.is_member ? `
              <div class="typing-line" id="typingLine"></div>
              <div class="chat-input-bar" id="composer">
                <input type="file" id="chatFile" accept="image/*" class="hidden">
                <button class="icon-btn" id="chatImgBtn" title="Отправить фото">🖼</button>
                <button class="icon-btn hide-sm" id="mdToggle" title="Режим форматирования (Enter — новая строка)">✍</button>
                ${chat.personas_enabled ? `<button class="icon-btn" id="personaBtn" title="От чьего лица писать" style="font-size:.75rem">🪪</button>` : ''}
                <textarea id="chatText" rows="1" placeholder="${chat.personas_only ? 'Пишите только от лица персон' : 'Сообщение… (Enter — отправить)'}"></textarea>
                <button class="icon-btn" id="chatSend" title="Отправить" style="background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none">➤</button>
              </div>
              ${UI.mdToolbar()}` : `<div class="chat-input-bar" style="justify-content:center"><span class="muted">👀 Вступите в чатс, чтобы писать сообщения</span></div>`}
            </div>
            <div class="chat-rail">
              <button id="railDesc" class="${uiPref.desc ? 'active' : ''}" title="Показать/скрыть описание">Описание</button>
              ${me.is_member ? `<button id="railMembers" class="${uiPref.members ? 'active' : ''}" title="Показать/скрыть участников">Участники</button>` : ''}
            </div>
          </div>
          ${me.is_member ? renderMembersPanel(chat, me, members, roles, uiPref.members) : ''}
        </div>` : `
        <div class="side-panel">${emptyState('🔒', 'Сообщения скрыты', 'Эта настройка открывает сообщения только участникам. Описание доступно всем.')}</div>`}
      </div>`;

    bindStatic(chat, data, id);
    if (me.is_member) {
      await initMessages(chat, id, subchats);
      await initComposer(chat, id);
      bindMembersPanel(chat, id);
    } else if (data.can_view_messages) {
      await initMessages(chat, id, subchats);
    }
  };
  /* ================= КНОПКИ СТРАНИЦЫ ================= */
  function bindStatic(chat, data, id) {
    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) joinBtn.addEventListener('click', async () => {
      joinBtn.disabled = true;
      try {
        const r = await API.post(`/gchats/${id}/join`, {});
        if (r.joined) { toast('Добро пожаловать в чатс! 🎉', 'ok'); Pages.chatsChat(id); }
        else toast('Заявка отправлена — ждём одобрения', 'ok');
      } catch (e) { err(e); joinBtn.disabled = false; }
    });

    const leaveBtn = document.getElementById('leaveBtn');
    if (leaveBtn) leaveBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('Выйти из чатса?', 'Вы сможете вернуться (или подать заявку заново).'))) return;
      try {
        await API.post(`/gchats/${id}/leave`, {});
        toast('Вы покинули чатс');
        Pages.chatsChat(id);
      } catch (e) { err(e); }
    });

    const inviteBtn = document.getElementById('inviteBtn');
    if (inviteBtn) inviteBtn.addEventListener('click', () => {
      const m = openModal(`
        <h3>📨 Пригласить по никнейму</h3>
        <div class="form-group">
          <label>Никнейм</label>
          <input class="input" id="invName" maxlength="32" placeholder="sakura">
        </div>
        <div class="form-error" id="invError"></div>
        <div class="modal-actions">
          <button class="btn ghost" data-close>Отмена</button>
          <button class="btn primary" id="invGo">Пригласить</button>
        </div>`);
      m.el.querySelector('#invGo').addEventListener('click', async () => {
        try {
          await API.post(`/gchats/${id}/invite`, { username: m.el.querySelector('#invName').value.trim() });
          m.close(); toast('Приглашение отправлено 📨', 'ok');
        } catch (e) { m.el.querySelector('#invError').textContent = e.message; }
      });
    });

    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn) adminBtn.addEventListener('click', () => openAdminPanel(chat, id));

    // рейка: скрытие описания и участников
    const railDesc = document.getElementById('railDesc');
    if (railDesc) railDesc.addEventListener('click', () => {
      curUiPref.desc = !curUiPref.desc;
      saveChatUiPref(id, curUiPref);
      applyChatUiState(curUiPref);
    });
    const railMembers = document.getElementById('railMembers');
    if (railMembers) railMembers.addEventListener('click', () => {
      curUiPref.members = !curUiPref.members;
      saveChatUiPref(id, curUiPref);
      applyChatUiState(curUiPref);
    });
    const pinnedOpen = document.getElementById('pinnedOpenBtn');
    if (pinnedOpen) pinnedOpen.addEventListener('click', () => pinnedModal());
    const searchOpen = document.getElementById('searchOpenBtn');
    if (searchOpen) searchOpen.addEventListener('click', () => searchModal());
  }
  /* ================= СООБЩЕНИЯ ================= */
  const msgState = { lastId: 0, subchat: 0, chat: null, id: null, timer: null, personas: [], myPersona: null, replyTo: null, items: [], canPin: false, canModerate: false };
  let curMe = null;

  function linkifyContent(text) {
    return UI.renderMd(text);
  }

  function msgHtml(m) {
    const meId = Chats.user?.id;
    if (m.kind === 'system') {
      let html = esc(m.content);
      if (m.sender_id && m.sender_username && m.content && m.content.includes(m.sender_username)) {
        const link = `<a class="sys-user" href="/#/u/${esc(m.sender_username)}" title="Открыть профиль">${esc(m.sender_username)}</a>`;
        html = html.split(esc(m.sender_username)).join(link);
      }
      return `<div class="msg-system">${html}</div>`;
    }
    if (m.hidden) {
      return `<div class="msg" data-msg-id="${m.id}">
        <span class="avatar" style="width:30px;height:30px">?</span>
        <div class="msg-wrap"><div class="msg-bubble msg-hidden">Сообщение скрыто</div></div>
      </div>`;
    }
    const mine = m.mine;
    const isPersona = !!m.persona;
    const displayName = isPersona ? m.persona.name : (m.sender_username || 'Гость');
    const avaUrl = isPersona ? m.persona.avatar_url : m.sender_avatar;
    const avatarInner = avaUrl && /^\/uploads\//.test(avaUrl)
      ? `<span class="avatar" style="width:30px;height:30px"><img src="${esc(avaUrl)}" alt=""></span>`
      : avatar(displayName, 30);
    // аватарка-ссылка на профиль (только для реальных пользователей, не персон)
    const avatarHtml = (!isPersona && m.sender_username)
      ? `<a href="/#/u/${esc(m.sender_username)}" title="Открыть профиль" style="flex-shrink:0;text-decoration:none">${avatarInner}</a>`
      : avatarInner;

    const nameHtml = isPersona
      ? `<span class="persona-link" data-persona="${m.persona.id}" title="Информация о персоне"><i class="persona-badge">П</i> <b>${esc(displayName)}</b></span>`
      : `<a href="/#/u/${esc(m.sender_username || '')}" style="color:inherit">${esc(displayName)}</a>`;

    const mentionMe = (m.mentioned_ids || []).includes(meId);
    const replyEl = m.reply_preview ? document.querySelector(`[data-msg-id="${m.reply_preview.id}"]`) : null;
    const replyToMine = !!(m.reply_preview && replyEl && replyEl.classList.contains('mine'));
    const highlight = mentionMe || replyToMine;

    const replyHtml = m.reply_preview
      ? `<div class="reply-quote" data-goto="${m.reply_preview.id}" title="Перейти к сообщению">↩ ${esc(m.reply_preview.username || '')}: ${esc(m.reply_preview.first_line)}</div>`
      : '';
    const bubbleContent = `${replyHtml}${m.content ? linkifyContent(m.content) : ''}${m.image_url ? `<img src="${esc(m.image_url)}" alt="" loading="lazy" style="border-radius:10px;margin-top:6px">` : ''}`;
    const edited = m.updated_at && m.updated_at !== m.created_at ? '<span title="изменено">✏️</span>' : '';

    return `<div class="msg ${mine ? 'mine' : ''} ${highlight ? 'highlight-mention' : ''}" data-msg-id="${m.id}" data-sender="${m.sender_id || ''}" data-sender-name="${esc(m.sender_username || '')}">${!mine ? avatarHtml : ''}<div class="msg-wrap"><div class="msg-username">${nameHtml}</div><div class="msg-bubble">${bubbleContent}</div><div class="msg-footer"><time>${fmtTime(m.created_at)}</time>${edited}</div></div>${mine ? avatarHtml : ''}</div>`;
  }
  function bindMsgHandlers(box) {
    box.querySelectorAll('[data-goto]').forEach((el) => {
      el.addEventListener('click', () => {
        const target = box.querySelector(`[data-msg-id="${el.dataset.goto}"]`);
        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.animate([{ opacity: .3 }, { opacity: 1 }], 600); }
      });
    });

    // клик по имени персоны → модалка с информацией
    box.querySelectorAll('.persona-link[data-persona]').forEach((el) => {
      el.addEventListener('click', () => personaInfoModal(msgState.id, +el.dataset.persona));
    });

    // спойлеры ||текст||
    UI.bindSpoilers(box);

    box.querySelectorAll('.msg[data-msg-id]').forEach((el) => {
      const mid = +el.dataset.msgId;
      const senderId = +el.dataset.sender;
      const senderName = el.dataset.senderName;
      const m = (msgState.items || []).find((x) => x.id === mid);
      if (!m || m.kind === 'system') return;
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items = [['↩ Ответить', '', () => setReply(m)]];
        if (senderId && senderId !== Chats.user?.id) {
          items.push(['🚫 Игнорировать пользователя', 'danger', async () => {
            try {
              await API.post('/gchats/ignore', { user_id: senderId, ignored: true });
              toast(`${senderName} скрыт — новые сообщения от него будут спрятаны`, 'ok');
              await loadInitial();
            } catch (ex) { err(ex); }
          }]);
        }
        if (m.mine) items.push(['🗑 Удалить сообщение', 'danger', () => deleteMsg(mid)]);
        else if (msgState.canModerate) items.push(['🗑 Удалить (модерация)', 'danger', () => deleteMsg(mid)]);
        if (msgState.canPin) items.push(['📌 Закрепить', '', () => pinMsg(mid, true)]);
        ctxMenu(e.clientX, e.clientY, items);
      });
    });
  }

  function setReply(m) {
    msgState.replyTo = m;
    const el = document.getElementById('replyBar');
    if (el) {
      el.classList.remove('hidden');
      el.innerHTML = `↩ Ответ ${esc(m.persona ? m.persona.name : (m.sender_username || ''))}: ${esc(String(m.content || '').split('\n')[0].slice(0, 60))}
        <button id="replyCancel" class="btn ghost sm" style="margin-left:8px">✕</button>`;
      document.getElementById('replyCancel').addEventListener('click', () => { msgState.replyTo = null; el.classList.add('hidden'); });
      document.getElementById('chatText')?.focus();
    }
  }

  async function deleteMsg(mid) {
    if (!(await confirmDialog('Удалить сообщение?', 'Действие необратимо.'))) return;
    try {
      await API.del(`/gchats/${msgState.id}/messages/${mid}`);
      document.querySelector(`[data-msg-id="${mid}"]`)?.remove();
    } catch (e) { err(e); }
  }

  async function pinMsg(mid, pinned) {
    try {
      await API.post(`/gchats/${msgState.id}/messages/${mid}/pin`, { pinned });
      toast(pinned ? 'Сообщение закреплено 📌' : 'Сообщение откреплено', 'ok');
      loadPinned();
    } catch (e) { err(e); }
  }

  /* Модалка закреплённых сообщений: отдельный «чат» с поиском */
  async function pinnedModal() {
    const canPin = msgState.canPin;
    const m = openModal(`
      <h3>📌 Закреплённые сообщения</h3>
      <input class="input" id="pinSearch" placeholder="Поиск: @автор или ключевое слово…" style="margin-bottom:10px" maxlength="60">
      <div id="pinList" style="max-height:56vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px">
        <div class="spinner"></div>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-close>Закрыть</button></div>`);
    m.el.querySelector('.modal').classList.add('modal-admin');

    const load = async () => {
      const q = m.el.querySelector('#pinSearch').value.trim();
      const list = m.el.querySelector('#pinList');
      list.innerHTML = '<div class="spinner"></div>';
      let d;
      try {
        d = await API.get(`/gchats/${msgState.id}/pinned${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      } catch (e) { list.innerHTML = emptyState('⚠️', e.message); return; }
      if (!d.items.length) {
        list.innerHTML = emptyState('📌', q ? 'Ничего не найдено' : 'Закреплённых сообщений пока нет',
          q ? 'Попробуйте другой запрос.' : 'ПКМ по сообщению → «Закрепить».');
        return;
      }
      list.innerHTML = d.items.map((p) => {
        const author = p.persona_name
          ? `<span class="persona-link"><i class="persona-badge">П</i> <b>${esc(p.persona_name)}</b></span>${p.sender_username ? ` <span class="muted" style="font-size:.72rem">(${esc(p.sender_username)})</span>` : ''}`
          : `<a href="/#/u/${esc(p.sender_username || '')}"><b>${esc(p.sender_username || 'Гость')}</b></a>`;
        const ava = p.persona_avatar && /^\/uploads\//.test(p.persona_avatar)
          ? `<span class="avatar" style="width:30px;height:30px"><img src="${esc(p.persona_avatar)}" alt=""></span>`
          : (p.sender_avatar && /^\/uploads\//.test(p.sender_avatar)
            ? `<span class="avatar" style="width:30px;height:30px"><img src="${esc(p.sender_avatar)}" alt=""></span>`
            : avatar(p.persona_name || p.sender_username || '?', 30));
        return `
          <div class="msg">
            ${ava}
            <div class="msg-wrap">
              <div class="msg-username">${author}</div>
              <div class="msg-bubble">${UI.renderMd(p.content || '')}${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="border-radius:10px;margin-top:6px;max-height:220px">` : ''}</div>
              <div class="msg-footer">
                <time>${timeAgo(p.created_at)}</time>
                <span>· закреплено ${timeAgo(p.pinned_at)}</span>
                ${canPin ? `<button class="btn ghost sm" data-unpin="${p.message_id}" style="margin-left:auto">✕ Открепить</button>` : ''}
              </div>
            </div>
          </div>`;
      }).join('');
      UI.bindSpoilers(list);
      list.querySelectorAll('[data-unpin]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await API.post(`/gchats/${msgState.id}/messages/${b.dataset.unpin}/pin`, { pinned: false });
          toast('Сообщение откреплено', 'ok');
          load();
        } catch (e) { err(e); }
      }));
    };

    let searchT = null;
    m.el.querySelector('#pinSearch').addEventListener('input', () => {
      clearTimeout(searchT);
      searchT = setTimeout(load, 300);
    });
    load();
  }

  /* Подсветка найденных ключевых слов (после экранирования) */
  function highlightMatches(text, q) {
    const safe = esc(text || '');
    if (!q) return safe;
    const safeQ = esc(q);
    let out = '';
    let i = 0;
    const lower = safe.toLowerCase();
    const needle = safeQ.toLowerCase();
    while (true) {
      const idx = lower.indexOf(needle, i);
      if (idx < 0) { out += safe.slice(i); break; }
      out += safe.slice(i, idx) + `<span class="search-hl">${safe.slice(idx, idx + needle.length)}</span>`;
      i = idx + needle.length;
    }
    return out;
  }

  /* Модалка поиска по сообщениям: @автор или ключевые слова */
  async function searchModal() {
    const m = openModal(`
      <h3>🔍 Поиск по сообщениям</h3>
      <input class="input" id="msgSearch" placeholder="@автор или ключевое слово…" style="margin-bottom:10px" maxlength="60">
      <div id="searchList" style="max-height:56vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px">
        <div class="muted" style="text-align:center;padding:20px 0">Введите @никнейм для поиска по автору или слово — по тексту сообщений.</div>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-close>Закрыть</button></div>`);
    m.el.querySelector('.modal').classList.add('modal-admin');

    const load = async () => {
      const q = m.el.querySelector('#msgSearch').value.trim();
      const list = m.el.querySelector('#searchList');
      if (!q) {
        list.innerHTML = '<div class="muted" style="text-align:center;padding:20px 0">Введите @никнейм для поиска по автору или слово — по тексту сообщений.</div>';
        return;
      }
      list.innerHTML = '<div class="spinner"></div>';
      let d;
      try {
        d = await API.get(`/gchats/${msgState.id}/search?q=${encodeURIComponent(q)}`);
      } catch (e) { list.innerHTML = emptyState('⚠️', e.message); return; }
      if (!d.items.length) {
        list.innerHTML = emptyState('🔍', 'Ничего не найдено', 'Попробуйте другой запрос.');
        return;
      }
      const isAuthorSearch = q.startsWith('@');
      const plainQ = q.replace(/^@+/, '');
      list.innerHTML = d.items.map((p) => {
        const author = p.persona_name
          ? `<span class="persona-link"><i class="persona-badge">П</i> <b>${esc(p.persona_name)}</b></span>${p.sender_username ? ` <span class="muted" style="font-size:.72rem">(${esc(p.sender_username)})</span>` : ''}`
          : `<a href="/#/u/${esc(p.sender_username || '')}"><b>${esc(p.sender_username || 'Гость')}</b></a>`;
        const ava = p.persona_avatar && /^\/uploads\//.test(p.persona_avatar)
          ? `<span class="avatar" style="width:30px;height:30px"><img src="${esc(p.persona_avatar)}" alt=""></span>`
          : (p.sender_avatar && /^\/uploads\//.test(p.sender_avatar)
            ? `<span class="avatar" style="width:30px;height:30px"><img src="${esc(p.sender_avatar)}" alt=""></span>`
            : avatar(p.persona_name || p.sender_username || '?', 30));
        return `
          <div class="msg">
            ${ava}
            <div class="msg-wrap">
              <div class="msg-username">${author}</div>
              <div class="msg-bubble">${isAuthorSearch ? esc(p.content || '') : highlightMatches(p.content || '', plainQ)}${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="border-radius:10px;margin-top:6px;max-height:220px">` : ''}</div>
              <div class="msg-footer"><time>${timeAgo(p.created_at)}</time></div>
            </div>
          </div>`;
      }).join('');
    };

    let searchT = null;
    m.el.querySelector('#msgSearch').addEventListener('input', () => {
      clearTimeout(searchT);
      searchT = setTimeout(load, 300);
    });
    m.el.querySelector('#msgSearch').focus();
  }

  /* Модалка персоны: фото, имя, описание, автор (если публичная) */
  async function personaInfoModal(chatId, personaId) {
    let p = null;
    try {
      const d = await API.get(`/gchats/${chatId}/personas`);
      p = (d.items || []).find((x) => x.id === personaId);
    } catch (e) { return err(e); }
    if (!p) return toast('Персона не найдена', 'error');
    const ava = p.avatar_url && /^\/uploads\//.test(p.avatar_url)
      ? `<div class="persona-modal-ava"><img src="${esc(p.avatar_url)}" alt=""></div>`
      : `<div class="persona-modal-ava">${esc((p.name || '?').charAt(0).toUpperCase())}</div>`;
    openModal(`
      <div class="persona-modal-head">
        ${ava}
        <div style="min-width:0">
          <div class="persona-modal-name"><i class="persona-badge">П</i> ${esc(p.name)}</div>
          <div class="persona-modal-meta">
            <span>${p.visibility === 'anonymous' ? '🕵️ Анонимная персона' : '👁️ Публичная персона'}</span>
            ${p.owner_username
              ? `<span>Автор: <a href="/#/u/${esc(p.owner_username)}">${esc(p.owner_username)}</a></span>`
              : (p.visibility === 'anonymous' ? '<span>Автор скрыт</span>' : '')}
          </div>
        </div>
      </div>
      <div class="persona-modal-bio">${p.bio ? esc(p.bio) : '<span class="muted">У персоны пока нет описания.</span>'}</div>
      <div class="modal-actions"><button class="btn ghost" data-close>Закрыть</button></div>`);
  }
  async function loadInitial() {
    const box = document.getElementById('msgBox');
    if (!box) return;
    try {
      const q = msgState.subchat ? `&subchat_id=${msgState.subchat}` : '';
      const d = await API.get(`/gchats/${msgState.id}/messages?limit=60${q}`);
      msgState.items = d.items;
      msgState.lastId = d.items.length ? d.items[d.items.length - 1].id : 0;
      box.innerHTML = d.items.length ? d.items.map(msgHtml).join('')
        : emptyState('🍡', 'Сообщений пока нет', 'Будьте первым — напишите что-нибудь!');
      bindMsgHandlers(box);
      box.scrollTop = box.scrollHeight;
    } catch (e) {
      box.innerHTML = emptyState('⚠️', e.message);
    }
  }

  async function initMessages(chat, id, subchats) {
    msgState.chat = chat;
    msgState.id = id;
    msgState.canPin = !!(curMe && curMe.perms.includes('pin'));
    msgState.canModerate = !!(curMe && curMe.perms.includes('moderate'));

    const tabs = document.getElementById('subchatTabs');
    if (tabs) tabs.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
      tabs.querySelectorAll('[data-sub]').forEach((x) => x.classList.toggle('active', x === b));
      msgState.subchat = +b.dataset.sub;
      loadInitial();
    }));

    if (chat.personas_enabled && Chats.user) {
      try {
        const d = await API.get(`/gchats/${id}/personas`);
        msgState.personas = (d.items || []).filter((p) => p.mine && p.status === 'approved');
      } catch { msgState.personas = []; }
    }

    await loadInitial();
    msgState.timer = setInterval(pollNew, 3000);

    // очистка таймера при уходе со страницы
    const observer = new MutationObserver(() => {
      if (!document.getElementById('msgBox')) {
        clearInterval(msgState.timer);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('app'), { childList: true });
  }

  async function pollNew() {
    if (!document.getElementById('msgBox')) return;
    try {
      const q = msgState.subchat ? `&subchat_id=${msgState.subchat}` : '';
      const d = await API.get(`/gchats/${msgState.id}/messages?after_id=${msgState.lastId}${q}`);
      if (d.items.length) {
        const box = document.getElementById('msgBox');
        box.querySelector('.empty-state')?.remove();
        msgState.items.push(...d.items);
        box.insertAdjacentHTML('beforeend', d.items.map(msgHtml).join(''));
        msgState.lastId = d.items[d.items.length - 1].id;
        bindMsgHandlers(box);
        box.scrollTop = box.scrollHeight;
      }
      const line = document.getElementById('typingLine');
      if (line) line.textContent = typingText(d.typing || []);
    } catch { /* тихо */ }
  }
  /* ================= КОМПОЗЕР ================= */
  async function initComposer(chat, id) {
    const sendBtn = document.getElementById('chatSend');
    const textEl = document.getElementById('chatText');
    const imgBtn = document.getElementById('chatImgBtn');
    const fileInput = document.getElementById('chatFile');
    if (!sendBtn) return;

    document.getElementById('composer').insertAdjacentHTML('beforebegin',
      '<div class="pinned-bar hidden" id="replyBar"></div>');

    const send = async () => {
      const text = textEl.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try {
        await API.post(`/gchats/${id}/messages`, {
          content: text,
          persona_id: msgState.myPersona ? msgState.myPersona.id : undefined,
          reply_to_id: msgState.replyTo ? msgState.replyTo.id : undefined,
          subchat_id: msgState.subchat || undefined,
        });
        textEl.value = '';
        msgState.replyTo = null;
        document.getElementById('replyBar')?.classList.add('hidden');
        await pollNew();
      } catch (e) { err(e); }
      sendBtn.disabled = false;
    };
    sendBtn.addEventListener('click', send);
    UI.bindMdToggle(document.getElementById('mdToggle'), document.getElementById('mdToolbar'), textEl);
    textEl.addEventListener('keydown', (e) => {
      const mdOn = document.getElementById('mdToolbar') && !document.getElementById('mdToolbar').hasAttribute('hidden');
      if (e.key === 'Enter' && !e.shiftKey && !mdOn) { e.preventDefault(); send(); }
    });

    let lastTyping = 0;
    textEl.addEventListener('input', () => {
      const now = Date.now();
      if (now - lastTyping > 2000) {
        lastTyping = now;
        API.post(`/gchats/${id}/typing`, { subchat_id: msgState.subchat }).catch(() => {});
      }
    });

    imgBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const url = await uploadImage(f);
        await API.post(`/gchats/${id}/messages`, { content: '📷', image_url: url, subchat_id: msgState.subchat || undefined });
        await pollNew();
      } catch (ex) { err(ex); }
    });

    const personaBtn = document.getElementById('personaBtn');
    if (personaBtn) personaBtn.addEventListener('click', () => personaPicker(chat, id));
  }
  async function personaPicker(chat, id) {
    let d;
    try { d = await API.get(`/gchats/${id}/personas`); } catch (e) { return err(e); }
    const mine = (d.items || []).filter((p) => p.mine);
    const m = openModal(`
      <h3>🪪 От чьего лица писать?</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn ghost block ${!msgState.myPersona ? 'primary' : ''}" data-pick="0">
          От себя (${esc(Chats.user.username)})
        </button>
        ${mine.filter((p) => p.status === 'approved').map((p) => `
          <button class="btn ghost block ${msgState.myPersona && msgState.myPersona.id === p.id ? 'primary' : ''}" data-pick="${p.id}">
            ${esc(p.name)} ${p.visibility === 'anonymous' ? '<span class="muted" style="font-size:.75rem">(аноним)</span>' : ''}
          </button>`).join('')}
        ${mine.filter((p) => p.status === 'pending').map((p) => `
          <div class="chip">⏳ «${esc(p.name)}» ожидает одобрения</div>`).join('')}
        ${mine.length < 5 ? `<button class="btn primary block" id="mkPersona">＋ Создать персону</button>` : '<div class="muted" style="font-size:.8rem">Достигнут лимит: 5 персон</div>'}
      </div>`);

    m.el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const pid = +b.dataset.pick;
      msgState.myPersona = pid ? mine.find((p) => p.id === pid) : null;
      m.close();
      toast(msgState.myPersona ? `Пишем от лица «${msgState.myPersona.name}»` : 'Пишем от себя', 'ok');
    }));

    const mk = m.el.querySelector('#mkPersona');
    if (mk) mk.addEventListener('click', () => { m.close(); createPersonaModal(chat, id); });
  }

  function createPersonaModal(chat, id) {
    let avaUrl = null;
    const m = openModal(`
      <h3>🪪 Новая персона</h3>
      <div class="form-group">
        <label>Имя *</label>
        <input class="input" id="psName" maxlength="48" placeholder="Например: Тень Моти">
      </div>
      <div class="form-group">
        <label>Фото (необязательно)</label>
        <div style="display:flex;gap:10px;align-items:center">
          <img id="psAvaPrev" class="upload-preview hidden" alt="">
          <div>
            <input type="file" id="psAva" accept="image/*" class="hidden">
            <button class="btn ghost sm" id="psAvaBtn">📷 Загрузить фото</button>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Описание (необязательно)</label>
        <textarea class="input" id="psBio" maxlength="500" style="min-height:70px"></textarea>
      </div>
      <div class="form-group">
        <label>Вид персоны</label>
        <select class="input" id="psVis">
          <option value="public">Публичная — при наведении виден настоящий ник</option>
          <option value="anonymous">Анонимная — автор скрыт</option>
        </select>
      </div>
      ${chat.personas_approval ? '<p class="muted" style="font-size:.8rem">Персона будет отправлена на одобрение ведущему.</p>' : ''}
      <div class="form-error" id="psError"></div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="psGo">Создать</button>
      </div>`);
    m.el.querySelector('#psAvaBtn').addEventListener('click', () => m.el.querySelector('#psAva').click());
    m.el.querySelector('#psAva').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const prev = m.el.querySelector('#psAvaPrev');
      prev.src = URL.createObjectURL(f);
      prev.classList.remove('hidden');
      try {
        avaUrl = await uploadImage(f);
        prev.src = avaUrl;
        toast('Фото загружено', 'ok');
      }
      catch (ex) { err(ex); }
    });
    m.el.querySelector('#psGo').addEventListener('click', async () => {
      try {
        const r = await API.post(`/gchats/${id}/personas`, {
          name: m.el.querySelector('#psName').value.trim(),
          bio: m.el.querySelector('#psBio').value.trim(),
          visibility: m.el.querySelector('#psVis').value,
          avatar_url: avaUrl,
        });
        m.close();
        toast(r.persona.status === 'pending' ? 'Персона отправлена на одобрение' : 'Персона создана!', 'ok');
        if (r.persona.status === 'approved') { msgState.myPersona = r.persona; }
      } catch (e) { m.el.querySelector('#psError').textContent = e.message; }
    });
  }
  /* ================= ПАНЕЛЬ УЧАСТНИКОВ ================= */
  function renderMembersPanel(chat, me, members, roles, visible = true) {
    const preview = members.slice(0, 5);
    return `
      <aside class="side-panel" id="membersPanel" style="${visible ? '' : 'display:none'}">
        <b>👥 Участники (${members.length})</b>
        <div class="my-chats-list">
          ${preview.map((u) => {
            const chip = u.id === chat.owner_id
              ? '<span class="owner-chip">ведущий</span>'
              : u.role === 'curator'
                ? '<span class="role-chip-custom" style="color:var(--warn)">куратор</span>'
                : u.role_id && u.role_name
                  ? `<span class="role-chip-custom" style="color:${esc(u.role_color || 'var(--accent)')}">${esc(u.role_name)}</span>`
                  : '';
            return `
              <div class="member-row" data-uid="${u.id}" data-uname="${esc(u.username)}">
                <a href="/#/u/${esc(u.username)}" title="Открыть профиль" style="text-decoration:none;flex-shrink:0">${avatar(u, 32)}</a>
                <div style="min-width:0;flex:1">
                  <div style="display:flex;align-items:center;gap:6px">
                    <a class="uname" href="/#/u/${esc(u.username)}" style="color:inherit">${esc(u.username)}</a>
                    ${chip}
                  </div>
                  ${u.muted_until && new Date(u.muted_until) > new Date() ? '<span class="muted" style="font-size:.72rem">🔇 заглушен</span>' : ''}
                </div>
                <span class="online-dot ${u.online ? 'on' : ''}" title="${u.online ? 'в сети' : 'не в сети'}"></span>
              </div>`;
          }).join('')}
        </div>
        ${members.length > 5 ? '<button class="btn ghost sm" id="membersAllBtn">👁 Просмотреть всех участников</button>' : ''}
        <button class="btn ghost sm" id="clearAllBtn" ${me.perms.includes('pin') ? '' : 'disabled'}>🧹 Очистить все сообщения</button>
      </aside>`;
  }

  /* Модалка «все участники»: сетка 5×5 (на телефоне 3 в ряд), пагинация */
  async function membersAllModal(chat, id) {
    let all = [];
    try { all = (await API.get(`/gchats/${id}/members`)).items; }
    catch (e) { return err(e); }
    const meId = Chats.user?.id;
    const canKick = !!(curMe && (curMe.is_owner || curMe.perms.includes('kick')));
    const PER_PAGE = window.innerWidth < 760 ? 24 : 25;
    let page = 1;
    let totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));

    const card = (u) => {
      const chip = u.id === chat.owner_id ? '<span class="owner-chip" title="Ведущий">👑</span>'
        : u.role === 'curator' ? '<span class="role-chip-custom" style="color:var(--warn)">куратор</span>'
        : '';
      const kick = canKick && u.id !== chat.owner_id && u.id !== meId
        ? `<button class="member-kick" data-kick="${u.id}" data-kname="${esc(u.username)}" title="Выгнать из чатса">✕</button>` : '';
      return `
        <div class="member-card" data-uid="${u.id}">
          <a href="/#/u/${esc(u.username)}" title="Открыть профиль" style="text-decoration:none">${avatar(u, 40)}</a>
          <span style="position:absolute;top:6px;right:6px">${chip}</span>
          ${kick}
          <a class="member-card-name" href="/#/u/${esc(u.username)}" title="Открыть профиль">${esc(u.username)}</a>
          <span class="online-dot ${u.online ? 'on' : ''}" title="${u.online ? 'в сети' : 'не в сети'}"></span>
        </div>`;
    };

    const m = openModal(`
      <h3>👥 Все участники «${esc(chat.name)}» (${all.length})</h3>
      <div class="members-grid" id="mGrid"></div>
      <div class="mem-pager" id="mPager"></div>
      <div class="modal-actions"><button class="btn ghost" data-close>Закрыть</button></div>`);
    m.el.querySelector('.modal').classList.add('modal-admin');

    function renderPage() {
      const start = (page - 1) * PER_PAGE;
      const slice = all.slice(start, start + PER_PAGE);
      m.el.querySelector('#mGrid').innerHTML = slice.map(card).join('');
      m.el.querySelector('#mPager').innerHTML = totalPages > 1 ? `
        <button id="mPrev" ${page <= 1 ? 'disabled' : ''}>←</button>
        <span>${page} / ${totalPages}</span>
        <button id="mNext" ${page >= totalPages ? 'disabled' : ''}>→</button>` : '';
      const prev = m.el.querySelector('#mPrev');
      const next = m.el.querySelector('#mNext');
      if (prev) prev.addEventListener('click', () => { page--; renderPage(); });
      if (next) next.addEventListener('click', () => { page++; renderPage(); });
      m.el.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const uid = +b.dataset.kick;
        const kname = b.dataset.kname;
        if (!(await confirmDialog(`Выгнать ${kname} из чатса?`, 'Он(а) сможет вернуться.'))) return;
        try {
          await API.del(`/gchats/${id}/members/${uid}`);
          toast('Участник выгнан', 'ok');
          all = (await API.get(`/gchats/${id}/members`)).items;
          totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
          if (page > totalPages) page = totalPages;
          renderPage();
        } catch (x) { err(x); }
      }));
    }
    renderPage();
  }

  function bindMembersPanel(chat, id) {
    const clearBtn = document.getElementById('clearAllBtn');
    if (clearBtn && !clearBtn.disabled) clearBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить ВСЕ сообщения из чатса?', 'Это действие необратимо.'))) return;
      try {
        await API.del(`/gchats/${id}/messages`);
        toast('История сообщений очищена', 'ok');
        loadInitial();
      } catch (e) { err(e); }
    });

    const membersAllBtn = document.getElementById('membersAllBtn');
    if (membersAllBtn) membersAllBtn.addEventListener('click', () => membersAllModal(chat, id));

    document.querySelectorAll('#membersPanel .member-row').forEach((row) => {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const uid = +row.dataset.uid;
        const uname = row.dataset.uname;
        const items = [['👤 Открыть профиль', '', () => { location.href = `/#/u/${uname}`; }]];
        if (uid !== Chats.user?.id) {
          items.push(['🚫 Игнорировать', '', async () => {
            await API.post('/gchats/ignore', { user_id: uid, ignored: true }).catch((x) => err(x));
            toast(`${uname} скрыт`, 'ok');
          }]);
        }
        if (curMe.perms.includes('kick') && uid !== chat.owner_id) {
          items.push(['🥾 Выгнать', 'danger', async () => {
            if (!(await confirmDialog(`Выгнать ${uname}?`, 'Он(а) сможет вернуться.'))) return;
            await API.del(`/gchats/${id}/members/${uid}`).catch((x) => err(x));
            toast('Участник выгнан', 'ok');
            Pages.chatsChat(id);
          }]);
        }
        if (curMe.perms.includes('mute') && uid !== chat.owner_id) {
          items.push(['🔇 Заглушить на 30 минут', '', async () => {
            await API.post(`/gchats/${id}/mute`, { user_id: uid, minutes: 30 }).catch((x) => err(x));
            toast(`${uname} заглушен на 30 минут`, 'ok');
            Pages.chatsChat(id);
          }]);
          items.push(['🔊 Снять мут', '', async () => {
            await API.post(`/gchats/${id}/unmute`, { user_id: uid }).catch((x) => err(x));
            toast('Мут снят', 'ok');
            Pages.chatsChat(id);
          }]);
        }
        if (curMe.perms.includes('ban') && uid !== chat.owner_id) {
          items.push(['⛔ Забанить…', 'danger', () => banModal(chat, id, uid, uname)]);
        }
        if (curMe.perms.includes('roles') && uid !== chat.owner_id) {
          items.push(['🎭 Сменить роль…', '', () => roleAssignModal(chat, id, uid, uname)]);
        }
        ctxMenu(e.clientX, e.clientY, items);
      });
    });
  }
  function banModal(chat, id, uid, uname) {
    const m = openModal(`
      <h3>⛔ Бан в чатсе: ${esc(uname)}</h3>
      <div class="form-group">
        <label>Что запрещаем</label>
        <select class="input" id="bnKind">
          <option value="ban">Зайти в чатс</option>
          <option value="requests_block">Отправлять заявки</option>
        </select>
      </div>
      <div class="form-group">
        <label>Срок</label>
        <select class="input" id="bnDays">
          <option value="">Навсегда</option>
          <option value="1">1 день</option>
          <option value="3">3 дня</option>
          <option value="7">7 дней</option>
          <option value="30">30 дней</option>
        </select>
      </div>
      <div class="form-group">
        <label>Причина</label>
        <input class="input" id="bnReason" maxlength="300">
      </div>
      <div class="form-error" id="bnError"></div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn danger" id="bnGo">Забанить</button>
      </div>`);
    m.el.querySelector('#bnGo').addEventListener('click', async () => {
      try {
        await API.post(`/gchats/${id}/ban`, {
          user_id: uid,
          kind: m.el.querySelector('#bnKind').value,
          days: m.el.querySelector('#bnDays').value || null,
          reason: m.el.querySelector('#bnReason').value.trim(),
        });
        m.close(); toast('Готово', 'ok'); Pages.chatsChat(id);
      } catch (e) { m.el.querySelector('#bnError').textContent = e.message; }
    });
  }

  async function roleAssignModal(chat, id, uid, uname) {
    let roles = [];
    try { roles = (await API.get(`/gchats/${id}/roles`)).items; } catch (e) { return err(e); }
    const m = openModal(`
      <h3>🎭 Роль для ${esc(uname)}</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn ghost block" data-r="member">Обычный участник</button>
        <button class="btn ghost block" data-r="curator">Куратор (мут + заявки + персоны)</button>
        ${roles.map((r) => `<button class="btn ghost block" data-rid="${r.id}">${esc(r.name)} (${r.permissions.join(', ') || 'без прав'})</button>`).join('')}
      </div>`);
    m.el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await API.post(`/gchats/${id}/members/${uid}/role`, { role: b.dataset.r });
        m.close(); toast('Роль обновлена', 'ok'); Pages.chatsChat(id);
      } catch (e) { err(e); }
    }));
    m.el.querySelectorAll('[data-rid]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await API.post(`/gchats/${id}/members/${uid}/role`, { role_id: +b.dataset.rid });
        m.close(); toast('Роль обновлена', 'ok'); Pages.chatsChat(id);
      } catch (e) { err(e); }
    }));
  }
  /* ================= ПАНЕЛЬ УПРАВЛЕНИЯ ЧАТСОМ ================= */
  function openAdminPanel(chat, id) {
    let tab = 'settings';
    const m = openModal(`
      <h3>🛠 Панель управления «${esc(chat.name)}»</h3>
      <div class="tabs" id="admTabs" style="margin:10px 0"></div>
      <div id="admBody" style="max-height:60vh;overflow-y:auto"></div>
      <div class="modal-actions" style="margin-top:10px">
        <button class="btn ghost" data-close>Закрыть</button>
        ${!chat.topic_id && chat.kind !== 'private' ? '<button class="btn ghost" id="mkTopic">💬 Создать тему «Чатс: …»</button>' : ''}
        <button class="btn danger" id="delChat">🗑 Удалить чатс</button>
      </div>`);
    m.el.querySelector('.modal').classList.add('modal-admin');

    m.el.querySelector('#delChat').addEventListener('click', async () => {
      if (!(await confirmDialog('Удалить чатс?', 'Все сообщения и участники будут удалены безвозвратно.'))) return;
      try { await API.del(`/gchats/${id}`); m.close(); toast('Чатс удалён'); location.hash = '#/'; }
      catch (e) { err(e); }
    });
    const mkTopic = m.el.querySelector('#mkTopic');
    if (mkTopic) mkTopic.addEventListener('click', async () => {
      try {
        await API.post(`/gchats/${id}/topic`, {});
        m.close(); toast('Тема создана на форуме!', 'ok'); Pages.chatsChat(id);
      } catch (e) { err(e); }
    });

    const TABS = [
      ['settings', '⚙ Настройки'],
      ['design', '🎨 Дизайн'],
      ['requests', '📥 Заявки'],
      ['roles', '🎭 Роли'],
      ['bans', '⛔ Баны'],
      ['personas', '🪪 Персоны'],
      ['subchats', '🍙 Подчатсы'],
    ];
    const tabReqs = { requests: 'requests', roles: 'roles', bans: 'ban', personas: 'personas', subchats: 'manage' };
    function renderTabs() {
      m.el.querySelector('#admTabs').innerHTML = TABS
        .filter(([t]) => !tabReqs[t] || curMe.perms.includes(tabReqs[t]) || curMe.is_owner)
        .map(([t, label]) => `<button data-t="${t}" class="${tab === t ? 'active' : ''}">${label}</button>`).join('');
      m.el.querySelectorAll('#admTabs [data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; renderTabs(); renderTab(); }));
    }

    async function renderTab() {
      const body = m.el.querySelector('#admBody');
      body.innerHTML = '<div class="spinner"></div>';

      if (tab === 'settings') {
        body.innerHTML = `
          <div class="form-group"><label>Название</label><input class="input" id="stName" maxlength="80" value="${esc(chat.name)}"></div>
          <div class="form-group"><label>Теги (через запятую)</label><input class="input" id="stTags" value="${esc((chat.tags || []).join(', '))}"></div>
          ${chat.kind !== 'private' ? `
          <div class="form-group"><label>Кто видит сообщения</label>
            <select class="input" id="stVis">
              <option value="members" ${chat.msg_visibility === 'members' ? 'selected' : ''}>Только участники</option>
              <option value="everyone" ${chat.msg_visibility === 'everyone' ? 'selected' : ''}>Все (вход по кнопке)</option>
            </select>
          </div>` : `
          <div class="form-group"><label><input type="checkbox" id="stOpen" ${chat.private_open ? 'checked' : ''}> Все участники могут менять название и иконку</label></div>`}
          <div class="form-group"><label>Персоны</label>
            <div style="display:flex;flex-direction:column;gap:6px">
              <label><input type="checkbox" id="stPEn" ${chat.personas_enabled ? 'checked' : ''}> Включить систему персон</label>
              <label><input type="checkbox" id="stPAp" ${chat.personas_approval ? 'checked' : ''}> Персоны по заявке (одобрение)</label>
              <label><input type="checkbox" id="stPOn" ${chat.personas_only ? 'checked' : ''}> Только для персон (нельзя писать от себя)</label>
            </div>
          </div>
          <div class="form-group">
            <label>Фото чатса</label>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <img id="stPhotoPrev" class="upload-preview ${chat.photo && /^\/uploads\//.test(chat.photo) ? '' : 'hidden'}" ${chat.photo && /^\/uploads\//.test(chat.photo) ? `src="${esc(chat.photo)}"` : ''} alt="">
              <div>
                <input type="file" id="stPhoto" accept="image/*" class="hidden">
                <button class="btn ghost sm" id="stPhotoBtn">📷 Загрузить новое фото</button>
                ${chat.photo && /^\/uploads\//.test(chat.photo) ? '<button class="btn danger sm" id="stPhotoRemove">🗑 Удалить фото</button>' : ''}
              </div>
            </div>
          </div>
          <button class="btn primary" id="stSave">Сохранить настройки</button>`;
        let newPhoto;
        body.querySelector('#stPhotoBtn').addEventListener('click', () => body.querySelector('#stPhoto').click());
        const stRemove = body.querySelector('#stPhotoRemove');
        if (stRemove) stRemove.addEventListener('click', async () => {
          if (!(await confirmDialog('Удалить фото чатса?', 'Вместо фото будет отображаться иконка.'))) return;
          try {
            await API.patch(`/gchats/${id}`, { photo: '' });
            body.querySelector('#stPhotoPrev').classList.add('hidden');
            stRemove.remove();
            toast('Фото чатса удалено', 'ok');
          } catch (x) { err(x); }
        });
        body.querySelector('#stPhoto').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const prev = body.querySelector('#stPhotoPrev');
          prev.src = URL.createObjectURL(f);
          prev.classList.remove('hidden');
          try {
            newPhoto = await uploadImage(f);
            prev.src = newPhoto;
            toast('Фото загружено', 'ok');
          } catch (x) { err(x); }
        });
        body.querySelector('#stSave').addEventListener('click', async () => {
          const b = { name: body.querySelector('#stName').value.trim(), tags: body.querySelector('#stTags').value };
          if (newPhoto) b.photo = newPhoto;
          if (chat.kind !== 'private') b.msg_visibility = body.querySelector('#stVis').value;
          else b.private_open = body.querySelector('#stOpen').checked;
          b.personas_enabled = body.querySelector('#stPEn').checked;
          b.personas_approval = body.querySelector('#stPAp').checked;
          b.personas_only = body.querySelector('#stPOn').checked;
          try { await API.patch(`/gchats/${id}`, b); toast('Настройки сохранены', 'ok'); m.close(); Pages.chatsChat(id); }
          catch (e) { err(e); }
        });
        return;
      }
      if (tab === 'design') {
        body.innerHTML = `
          <p class="muted" style="font-size:.82rem">Дизайн применяется ко всей странице чатса. Header и подвал Mochi chats остаются неизменными.</p>
          <div class="form-group">
            <label>Описание (шрифты, фото, размеры)</label>
            <div class="editor-toolbar">
              <button type="button" data-cmd="bold" title="Полужирный"><b>B</b></button>
              <button type="button" data-cmd="italic" title="Курсив"><i>I</i></button>
              <button type="button" data-cmd="underline" title="Подчёркнутый"><u>U</u></button>
              <button type="button" data-cmd="strikeThrough" title="Зачёркнутый"><s>S</s></button>
              <span class="tb-sep"></span>
              <select id="dsFont">
                <option value="">Шрифт</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Times New Roman', serif">Times New Roman</option>
                <option value="'Courier New', monospace">Courier New</option>
                <option value="Verdana, sans-serif">Verdana</option>
              </select>
              <select id="dsSize">
                <option value="">Размер</option>
                <option value="2">Мелкий</option>
                <option value="3">Обычный</option>
                <option value="5">Крупный</option>
                <option value="6">Огромный</option>
              </select>
              <input type="file" id="dsImg" accept="image/*" class="hidden">
              <button type="button" id="dsImgBtn" title="Вставить фото">🖼</button>
            </div>
            <div contenteditable="true" id="dsArea" class="input" style="min-height:120px;background:var(--card2)"></div>
          </div>
          <div class="form-group">
            <label>🏙 Фон шапки (аватар, название, кнопки)</label>
            <select class="input" id="dshBgType">
              <option value="color" ${(chat.head_bg || chat.desc_bg)?.type === 'color' ? 'selected' : ''}>Обычный цвет</option>
              <option value="gradient" ${(chat.head_bg || chat.desc_bg)?.type === 'gradient' ? 'selected' : ''}>Градиент</option>
              <option value="image" ${(chat.head_bg || chat.desc_bg)?.type === 'image' ? 'selected' : ''}>Картинка</option>
            </select>
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
              <input type="color" id="dshBg1" value="${esc((chat.head_bg || chat.desc_bg)?.color || '#f4f6fc')}" style="width:52px;height:32px;border:none;background:none">
              <input type="color" id="dshBg2" value="${esc((chat.head_bg || chat.desc_bg)?.color2 || '#dfe8ff')}" style="width:52px;height:32px;border:none;background:none">
              <input type="file" id="dshBgImg" accept="image/*" class="hidden">
              <button class="btn ghost sm" id="dshBgImgBtn">📷 Картинка</button>
              <button class="btn ghost sm" id="dshBgRemove" title="Убрать картинку">🗑 Убрать</button>
              <img id="dshBgPrev" class="upload-preview ${(chat.head_bg || chat.desc_bg)?.type === 'image' && (chat.head_bg || chat.desc_bg)?.url ? '' : 'hidden'}" ${(chat.head_bg || chat.desc_bg)?.type === 'image' && (chat.head_bg || chat.desc_bg)?.url ? `src="${esc((chat.head_bg || chat.desc_bg).url)}"` : ''} alt="">
            </div>
          </div>
          <div class="form-group">
            <label>📜 Фон описания и тегов</label>
            <select class="input" id="dsBgType">
              <option value="color" ${chat.desc_bg?.type === 'color' ? 'selected' : ''}>Обычный цвет</option>
              <option value="gradient" ${chat.desc_bg?.type === 'gradient' ? 'selected' : ''}>Градиент</option>
              <option value="image" ${chat.desc_bg?.type === 'image' ? 'selected' : ''}>Картинка</option>
            </select>
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
              <input type="color" id="dsBg1" value="${esc(chat.desc_bg?.color || '#f4f6fc')}" style="width:52px;height:32px;border:none;background:none">
              <input type="color" id="dsBg2" value="${esc(chat.desc_bg?.color2 || '#dfe8ff')}" style="width:52px;height:32px;border:none;background:none">
              <input type="file" id="dsBgImg" accept="image/*" class="hidden">
              <button class="btn ghost sm" id="dsBgImgBtn">📷 Картинка</button>
              <button class="btn ghost sm" id="dsBgRemove" title="Убрать картинку">🗑 Убрать</button>
              <img id="dsBgPrev" class="upload-preview ${chat.desc_bg?.type === 'image' && chat.desc_bg?.url ? '' : 'hidden'}" ${chat.desc_bg?.type === 'image' && chat.desc_bg?.url ? `src="${esc(chat.desc_bg.url)}"` : ''} alt="">
            </div>
          </div>
          <div class="form-group">
            <label>Тема страницы чатса</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select class="input" id="dsMode" style="max-width:130px">
                <option value="">Как у секции</option>
                <option value="light" ${chat.theme?.mode === 'light' ? 'selected' : ''}>Светлая</option>
                <option value="dark" ${chat.theme?.mode === 'dark' ? 'selected' : ''}>Тёмная</option>
              </select>
              <input type="color" id="dsAccent" value="${esc(chat.theme?.accent || '#3aa0ff')}" title="Акцент" style="width:52px;height:32px;border:none;background:none">
              <input type="color" id="dsAccent2" value="${esc(chat.theme?.accent2 || '#6c7cff')}" title="Второй акцент" style="width:52px;height:32px;border:none;background:none">
              <input type="color" id="dsPageBg" value="${esc(chat.theme?.pageBg || '#eef5fd')}" title="Фон страницы" style="width:52px;height:32px;border:none;background:none">
              <input type="file" id="dsBgWall" accept="image/*" class="hidden">
              <button class="btn ghost sm" id="dsBgWallBtn">🌆 Фон-обои страницы</button>
              <button class="btn ghost sm" id="dsWallRemove" title="Убрать обои">🗑 Убрать</button>
              <img id="dsWallPrev" class="upload-preview ${chat.theme?.bgImage ? '' : 'hidden'}" ${chat.theme?.bgImage ? `src="${esc(chat.theme.bgImage)}"` : ''} alt="">
            </div>
          </div>
          <div class="form-group">
            <label>📢 Сообщение для участников (отображается над чатом)</label>
            <textarea class="input" id="dsAnnounce" maxlength="500" style="min-height:60px" placeholder="Например: Правила чата — уважайте друг друга!">${esc(chat.announcement || '')}</textarea>
          </div>
          <button class="btn primary" id="dsSave">Сохранить дизайн</button>`;
        const area = body.querySelector('#dsArea');
        area.innerHTML = chat.description?.html || '';
        let bgImageUrl = chat.desc_bg?.url || null;
        let headBgUrl = (chat.head_bg || chat.desc_bg)?.url || null;
        let wallUrl = chat.theme?.bgImage || null;
        body.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('mousedown', (e) => {
          e.preventDefault(); document.execCommand(b.dataset.cmd);
        }));
        body.querySelector('#dsFont').addEventListener('change', (e) => { if (e.target.value) document.execCommand('fontName', false, e.target.value); });
        body.querySelector('#dsSize').addEventListener('change', (e) => { if (e.target.value) document.execCommand('fontSize', false, e.target.value); });
        body.querySelector('#dsImgBtn').addEventListener('click', () => body.querySelector('#dsImg').click());
        body.querySelector('#dsImg').addEventListener('change', async (e) => {
          try {
            const url = await uploadImage(e.target.files[0]);
            document.execCommand('insertImage', false, url);
          } catch (x) { err(x); }
        });
        // --- фон шапки ---
        body.querySelector('#dshBgImgBtn').addEventListener('click', () => body.querySelector('#dshBgImg').click());
        body.querySelector('#dshBgImg').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const prev = body.querySelector('#dshBgPrev');
          prev.src = URL.createObjectURL(f);
          prev.classList.remove('hidden');
          try {
            headBgUrl = await uploadImage(f);
            body.querySelector('#dshBgType').value = 'image';
            prev.src = headBgUrl;
            toast('Фон шапки загружен', 'ok');
          }
          catch (x) { err(x); }
        });
        body.querySelector('#dshBgRemove').addEventListener('click', () => {
          headBgUrl = null;
          const prev = body.querySelector('#dshBgPrev');
          prev.classList.add('hidden');
          prev.removeAttribute('src');
          body.querySelector('#dshBgType').value = 'color';
          toast('Картинка фона шапки убрана (не забудьте сохранить)', 'ok');
        });
        // --- фон описания ---
        body.querySelector('#dsBgImgBtn').addEventListener('click', () => body.querySelector('#dsBgImg').click());
        body.querySelector('#dsBgImg').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const prev = body.querySelector('#dsBgPrev');
          prev.src = URL.createObjectURL(f);
          prev.classList.remove('hidden');
          try {
            bgImageUrl = await uploadImage(f);
            body.querySelector('#dsBgType').value = 'image';
            prev.src = bgImageUrl;
            toast('Фон загружен', 'ok');
          }
          catch (x) { err(x); }
        });
        body.querySelector('#dsBgRemove').addEventListener('click', () => {
          bgImageUrl = null;
          const prev = body.querySelector('#dsBgPrev');
          prev.classList.add('hidden');
          prev.removeAttribute('src');
          body.querySelector('#dsBgType').value = 'color';
          toast('Картинка фона описания убрана (не забудьте сохранить)', 'ok');
        });
        // --- обои страницы ---
        body.querySelector('#dsBgWallBtn').addEventListener('click', () => body.querySelector('#dsBgWall').click());
        body.querySelector('#dsBgWall').addEventListener('change', async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          const prev = body.querySelector('#dsWallPrev');
          prev.src = URL.createObjectURL(f);
          prev.classList.remove('hidden');
          try {
            wallUrl = await uploadImage(f);
            prev.src = wallUrl;
            toast('Обои загружены', 'ok');
          }
          catch (x) { err(x); }
        });
        body.querySelector('#dsWallRemove').addEventListener('click', () => {
          wallUrl = null;
          const prev = body.querySelector('#dsWallPrev');
          prev.classList.add('hidden');
          prev.removeAttribute('src');
          toast('Обои убраны (не забудьте сохранить)', 'ok');
        });
        body.querySelector('#dsSave').addEventListener('click', async () => {
          try {
            const bgType = body.querySelector('#dsBgType').value;
            const headBgType = body.querySelector('#dshBgType').value;
            await API.patch(`/gchats/${id}`, {
              description: { html: area.innerHTML, fonts: [] },
              desc_bg: {
                type: bgType,
                color: body.querySelector('#dsBg1').value,
                color2: body.querySelector('#dsBg2').value,
                url: bgImageUrl,
              },
              head_bg: {
                type: headBgType,
                color: body.querySelector('#dshBg1').value,
                color2: body.querySelector('#dshBg2').value,
                url: headBgUrl,
              },
              theme: {
                mode: body.querySelector('#dsMode').value || undefined,
                accent: body.querySelector('#dsAccent').value,
                accent2: body.querySelector('#dsAccent2').value,
                pageBg: body.querySelector('#dsPageBg').value,
                bgImage: wallUrl,
              },
              announcement: body.querySelector('#dsAnnounce').value.trim(),
            });
            toast('Дизайн чатса обновлён 🎨', 'ok');
            m.close(); Pages.chatsChat(id);
          } catch (e) { err(e); }
        });
        return;
      }
      if (tab === 'requests') {
        const d = await API.get(`/gchats/${id}/requests`);
        body.innerHTML = d.items.length ? d.items.map((r) => `
          <div class="notif-row">
            ${avatar(r, 34)}
            <div style="flex:1"><b>${esc(r.username)}</b> <span class="muted" style="font-size:.75rem">${timeAgo(r.created_at)}</span></div>
            <button class="btn primary sm" data-approve="${r.id}">✓</button>
            <button class="btn danger sm" data-decline="${r.id}">✕</button>
          </div>`).join('')
          : emptyState('📭', 'Заявок нет');
        body.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => reviewRequest(id, b.dataset.approve, 'approve', renderTab)));
        body.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => reviewRequest(id, b.dataset.decline, 'decline', renderTab)));
        return;
      }

      if (tab === 'roles') {
        const d = await API.get(`/gchats/${id}/roles`);
        body.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${d.items.map((r) => `
              <div class="notif-row">
                <div style="flex:1">
                  <b style="color:${esc(r.color || 'inherit')}">${esc(r.name)}</b>
                  <div class="muted" style="font-size:.78rem">${r.permissions.map((p) => PERM_LABELS[p] || p).join(' · ') || 'нет прав'} · участников: ${r.members_count}</div>
                </div>
                <button class="btn ghost sm" data-edit="${r.id}">✏️</button>
                <button class="btn danger sm" data-del="${r.id}">🗑</button>
              </div>`).join('')}
            ${d.items.length < 5 ? '<button class="btn primary block" id="mkRole">＋ Создать роль</button>' : '<div class="muted">Достигнут лимит: 5 ролей</div>'}
          </div>`;
        body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await confirmDialog('Удалить роль?', 'Участники потеряют её права.'))) return;
          try { await API.del(`/gchats/${id}/roles/${b.dataset.del}`); renderTab(); } catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => roleModal(id, d.items.find((r) => r.id === +b.dataset.edit), renderTab)));
        const mk = body.querySelector('#mkRole');
        if (mk) mk.addEventListener('click', () => roleModal(id, null, renderTab));
        return;
      }

      if (tab === 'bans') {
        const d = await API.get(`/gchats/${id}/bans`);
        body.innerHTML = d.items.length ? d.items.map((b) => `
          <div class="notif-row">
            <div style="flex:1">
              <b>${esc(b.username)}</b> — ${b.kind === 'ban' ? 'бан входа' : 'запрет заявок'}
              <div class="muted" style="font-size:.75rem">${b.until ? `до ${fullDate(b.until)}` : 'навсегда'} · ${esc(b.reason || '')}</div>
            </div>
            <button class="btn ghost sm" data-unban="${b.user_id}">Разбанить</button>
          </div>`).join('')
          : emptyState('🕊', 'Банов нет');
        body.querySelectorAll('[data-unban]').forEach((b) => b.addEventListener('click', async () => {
          try { await API.post(`/gchats/${id}/unban`, { user_id: +b.dataset.unban }); renderTab(); } catch (e) { err(e); }
        }));
        return;
      }
      if (tab === 'personas') {
        const d = await API.get(`/gchats/${id}/personas`);
        const pending = (d.items || []).filter((p) => p.status === 'pending');
        const others = (d.items || []).filter((p) => p.status === 'approved' && !p.mine);
        body.innerHTML = `
          ${pending.length ? `<b>⏳ На одобрении</b>
            ${pending.map((p) => `
              <div class="notif-row">
                <div style="flex:1"><b>${esc(p.name)}</b> ${p.visibility === 'anonymous' ? '<span class="muted" style="font-size:.75rem">аноним</span>' : ''}${p.owner_username ? `<div class="muted" style="font-size:.75rem">автор: ${esc(p.owner_username)}</div>` : ''}</div>
                <button class="btn primary sm" data-pa="${p.id}">✓</button>
                <button class="btn danger sm" data-pd="${p.id}">✕</button>
              </div>`).join('')}` : ''}
          ${others.length ? `<b style="margin-top:8px;display:block">🪪 Персоны участников</b>
            ${others.map((p) => `
              <div class="notif-row">
                <div style="flex:1"><b>${esc(p.name)}</b>${p.owner_username ? `<div class="muted" style="font-size:.75rem">автор: ${esc(p.owner_username)}</div>` : '<div class="muted" style="font-size:.75rem">аноним</div>'}</div>
                <button class="btn danger sm" data-pdel="${p.id}">🗑</button>
              </div>`).join('')}` : ''}
          ${!pending.length && !others.length ? emptyState('🪪', 'Персон пока нет') : ''}`;
        body.querySelectorAll('[data-pa]').forEach((b) => b.addEventListener('click', async () => {
          try { await API.post(`/gchats/${id}/personas/${b.dataset.pa}/review`, { action: 'approve' }); renderTab(); } catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-pd]').forEach((b) => b.addEventListener('click', async () => {
          try { await API.post(`/gchats/${id}/personas/${b.dataset.pd}/review`, { action: 'decline' }); renderTab(); } catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-pdel]').forEach((b) => b.addEventListener('click', async () => {
          try { await API.del(`/gchats/${id}/personas/${b.dataset.pdel}`); renderTab(); } catch (e) { err(e); }
        }));
        return;
      }
      if (tab === 'subchats') {
        body.innerHTML = `
          <p class="muted" style="font-size:.82rem">Подчатсы — вложенные ветки внутри чатса (максимум 5). Только название и иконка.</p>
          <div class="form-group" style="display:flex;gap:8px">
            <input class="input" id="scIcon" maxlength="8" placeholder="💬" style="max-width:70px">
            <input class="input" id="scName" maxlength="80" placeholder="Название подчатса">
            <button class="btn primary sm" id="scGo">＋</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px" id="scList"></div>`;
        async function loadSubs() {
          const dd = await API.get(`/gchats/${id}`);
          body.querySelector('#scList').innerHTML = dd.subchats.map((s) => `
            <div class="notif-row">
              <span style="font-size:1.2rem">${esc(s.icon || '💬')}</span>
              <div style="flex:1"><b>${esc(s.name)}</b></div>
              <button class="btn danger sm" data-scdel="${s.id}">🗑</button>
            </div>`).join('') || '<div class="muted">Подчатсов пока нет</div>';
          body.querySelectorAll('[data-scdel]').forEach((b) => b.addEventListener('click', async () => {
            try { await API.del(`/gchats/${id}/subchats/${b.dataset.scdel}`); loadSubs(); } catch (e) { err(e); }
          }));
        }
        body.querySelector('#scGo').addEventListener('click', async () => {
          try {
            await API.post(`/gchats/${id}/subchats`, {
              name: body.querySelector('#scName').value.trim(),
              icon: body.querySelector('#scIcon').value.trim(),
            });
            body.querySelector('#scName').value = '';
            loadSubs();
          } catch (e) { err(e); }
        });
        loadSubs().catch((e) => err(e));
        return;
      }
    }

    renderTabs();
    renderTab().catch((e) => { m.el.querySelector('#admBody').innerHTML = emptyState('⚠️', e.message); });
  }
  const PERM_LABELS = {
    manage: 'настройки', roles: 'роли', kick: 'выгонять', ban: 'банить', mute: 'мут',
    requests: 'заявки', invite: 'приглашать', pin: 'закрепление', moderate: 'модерация', personas: 'персоны',
  };

  async function reviewRequest(id, reqId, action, done) {
    try {
      await API.post(`/gchats/${id}/requests/${reqId}`, { action });
      toast(action === 'approve' ? 'Заявка одобрена 🎉' : 'Заявка отклонена', 'ok');
      done && done();
    } catch (e) { err(e); }
  }

  function roleModal(id, role, done) {
    const PERMS_LIST = [
      ['manage', 'Настройки чатса'], ['roles', 'Управление ролями'], ['kick', 'Выгонять'],
      ['ban', 'Банить'], ['mute', 'Заглушать'], ['requests', 'Одобрять заявки'],
      ['invite', 'Приглашать'], ['pin', 'Закреплять и чистить'], ['moderate', 'Удалять чужие'], ['personas', 'Одобрять персон'],
    ];
    const m = openModal(`
      <h3>${role ? '✏️ Роль: ' + esc(role.name) : '🎭 Новая роль'}</h3>
      <div class="form-group"><label>Название</label><input class="input" id="rlName" maxlength="40" value="${esc(role?.name || '')}" placeholder="Например: Модератор"></div>
      <div class="form-group"><label>Цвет</label><input type="color" id="rlColor" value="${esc(role?.color || '#3aa0ff')}" style="width:60px;height:32px;border:none;background:none"></div>
      <div class="form-group">
        <label>Права</label>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${PERMS_LIST.map(([p, l]) => `<label><input type="checkbox" value="${p}" ${role?.permissions?.includes(p) ? 'checked' : ''}> ${l}</label>`).join('')}
        </div>
      </div>
      <div class="form-error" id="rlError"></div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="rlGo">${role ? 'Сохранить' : 'Создать'}</button>
      </div>`);
    m.el.querySelector('#rlGo').addEventListener('click', async () => {
      const perms = [...m.el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
      const body = {
        name: m.el.querySelector('#rlName').value.trim(),
        color: m.el.querySelector('#rlColor').value,
        permissions: perms,
      };
      try {
        if (role) await API.patch(`/gchats/${id}/roles/${role.id}`, body);
        else await API.post(`/gchats/${id}/roles`, body);
        m.close(); toast('Роль сохранена', 'ok'); done && done();
      } catch (e) { m.el.querySelector('#rlError').textContent = e.message; }
    });
  }
})();

















