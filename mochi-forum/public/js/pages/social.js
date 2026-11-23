/* Страницы: личный чат и админ-панель */
window.Pages = window.Pages || {};
(() => {
  const { esc, fmtNum, timeAgo, fullDate, avatar, roleChip, toast, err,
          openModal, confirmDialog, pager, bindPager, uploadImage, emptyState } = UI;

  // Форматирует дату в HH:MM
  const fmtTime = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  /* ================= ЧАТ ================= */
  Pages.chat = async function (convId, query = {}) {
    if (!App.user) return App.requireLogin();
    const app = document.getElementById('app');
    let activeConv = convId ? +convId : null;
    let isGroup = query.g === '1';       // активен приватный групповой чат
    let groupInfo = null;                 // данные группового чата (права/персоны)
    let groupTimer = null;
    let lastMsgId = 0;
    let pollTimer = null;
    let listTimer = null;

    async function loadList() {
      const d = await API.get('/chat/conversations');
      const box = document.getElementById('convList');
      if (!box) return;
      // Сортируем: активные чаты сверху, игнорированные снизу
      const sorted = [...(d.items || [])].sort((a, b) => {
        if (a.is_ignored === b.is_ignored) return 0;
        return a.is_ignored ? 1 : -1;
      });
      const groupsHtml = (d.groups || []).map((g) => `
        <div class="conv-item ${isGroup && g.id === activeConv ? 'active' : ''}" data-conv="g${g.id}">
          ${g.photo && /^\/uploads\//.test(g.photo)
            ? `<span class="group-ico"><img src="${esc(g.photo)}" alt=""></span>`
            : `<span class="group-ico">${esc(g.photo || '👥')}</span>`}
          <div style="min-width:0;flex:1">
            <div class="conv-name">👥 ${esc(g.name)}</div>
            <div class="conv-last">${g.last_sender_id === App.user.id ? 'Вы: ' : ''}${esc((g.last_content || '').slice(0, 40) || 'Нет сообщений')}</div>
          </div>
          ${+g.unread > 0 ? `<span class="unread-pill">${g.unread}</span>` : ''}
          <button class="conv-menu-btn" data-conv="g${g.id}" title="Меню">⋮</button>
        </div>`).join('');
      const dmsHtml = sorted.length ? sorted.map((c) => `
        <div class="conv-item ${!isGroup && c.id === activeConv ? 'active' : ''} ${c.is_ignored ? 'ignored' : ''}" data-conv="${c.id}">
          ${avatar({ username: c.other_username, avatar_url: c.other_avatar }, 42)}
          <div style="min-width:0;flex:1">
            <div class="conv-name">${c.is_ignored ? '🚫 ' : ''}${esc(c.other_username)}</div>
            <div class="conv-last">${c.last_sender_id === App.user.id ? 'Вы: ' : ''}${esc((c.last_content || '').slice(0, 40) || (c.last_image ? '📷 фото' : 'Нет сообщений'))}</div>
          </div>
          ${+c.unread > 0 ? `<span class="unread-pill">${c.unread}</span>` : ''}
          <button class="conv-menu-btn" data-conv="${c.id}" title="Меню">⋮</button>
        </div>`).join('')
        : emptyState('💬', 'Диалогов нет', 'Начните чат с профиля пользователя или создайте груповой.');

      box.innerHTML = (d.groups && d.groups.length
        ? `<div class="muted" style="font-size:.72rem;font-weight:700;padding:4px 8px">ГРУПОВЫЕ ЧАТЫ</div>${groupsHtml}
           <div class="muted" style="font-size:.72rem;font-weight:700;padding:4px 8px">ЛИЧНЫЕ</div>` : '')
        + dmsHtml;

      box.querySelectorAll('[data-conv]').forEach((el) => {
        const val = el.dataset.conv;
        el.addEventListener('click', (e) => {
          if (!e.target.closest('.conv-menu-btn')) {
            if (String(val).startsWith('g')) location.hash = `#/chat/${String(val).slice(1)}?g=1`;
            else location.hash = `#/chat/${val}`;
          }
        });
      });

      // Меню для каждого диалога
      box.querySelectorAll('.conv-menu-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = String(btn.dataset.conv);
          if (val.startsWith('g')) {
            showGroupMenu(+val.slice(1));
            return;
          }
          const convId = +val;
          // Ищем в текущих данных, а не в DOM
          const convData = d.items.find(c => c.id === convId);
          const isIgnored = convData ? convData.is_ignored : false;
          showConvMenu(convId, isIgnored);
        });
      });
    }

    /* Меню приватного группового чата */
    async function showGroupMenu(gid) {
      let canClear = false;
      try {
        const info = await API.get(`/gchats/${gid}`);
        canClear = info.me.perms.includes('pin') || info.me.is_owner;
      } catch { /* чат мог исчезнуть */ }
      const m = openModal(`
        <h3>👥 Действия с груповым чатом</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn ghost block" id="grpEditMenuBtn">✏️ Название и иконка</button>
          <button class="btn ghost block" id="grpClearBtn" ${canClear ? '' : 'disabled'} title="${canClear ? '' : 'Нужны права закрепления/очистки'}">🗑️ Удалить все сообщения</button>
          <button class="btn danger block" id="grpLeaveBtn">🚶 Покинуть чат</button>
        </div>`);
      const editBtn = m.el.querySelector('#grpEditMenuBtn');
      if (editBtn) editBtn.addEventListener('click', () => { m.close(); dmGroupEditModal(gid); });
      const clearBtn = m.el.querySelector('#grpClearBtn');
      if (canClear) clearBtn.addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить все сообщения?', 'Действие необратимо.'))) return;
        try { await API.del(`/gchats/${gid}/messages`); m.close(); if (isGroup && activeConv === gid) loadThread(true); toast('Сообщения удалены', 'ok'); }
        catch (e) { err(e); }
      });
      m.el.querySelector('#grpLeaveBtn').addEventListener('click', async () => {
        if (!(await confirmDialog('Покинуть чат?', 'Вернуться можно только по приглашению.'))) return;
        try { await API.post(`/gchats/${gid}/leave`, {}); m.close(); if (isGroup && activeConv === gid) location.hash = '#/chat'; else loadList(); }
        catch (e) { err(e); }
      });
    }

    /* Панель участников групового чата (в ЛС) */
    function renderDmMembers(info) {
      const canKick = info.me.is_owner || (info.me.perms || []).includes('kick');
      return `
        <aside class="members-col">
          <div class="members-col-head"><span>👥 Участники</span><span class="muted" style="font-weight:600">${info.members.length}</span></div>
          <div class="members-col-list">
            ${info.members.map((u) => `
              <div class="member-line" data-uid="${u.id}" data-uname="${esc(u.username)}">
                ${avatar(u, 30)}
                <a class="member-name" href="#/u/${esc(u.username)}" title="Открыть профиль на сайте">${esc(u.username)}</a>
                ${u.id === info.chat.owner_id ? '<span class="owner-chip" title="Владелец чата">👑</span>' : ''}
                ${canKick && u.id !== info.chat.owner_id
                  ? `<button class="member-kick" data-kick="${u.id}" title="Выгнать из чата">✕</button>`
                  : ''}
              </div>`).join('')}
          </div>
        </aside>`;
    }

    function bindDmMembers() {
      const canKick = groupInfo.me.is_owner || (groupInfo.me.perms || []).includes('kick');
      if (!canKick) return;
      document.querySelectorAll('.member-kick[data-kick]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault(); e.stopPropagation();
          const uid = +btn.dataset.kick;
          const row = btn.closest('.member-line');
          const uname = row?.dataset.uname || 'участника';
          if (!(await confirmDialog(`Выгнать ${uname} из чата?`, 'Он сможет вернуться только по приглашению.'))) return;
          try {
            await API.del(`/gchats/${activeConv}/members/${uid}`);
            toast(`${uname} выгнан(а) из чата`, 'ok');
            groupInfo = await API.get(`/gchats/${activeConv}`);
            const panel = document.querySelector('.members-col');
            if (panel) panel.outerHTML = renderDmMembers(groupInfo);
            bindDmMembers();
          } catch (x) { err(x); }
        });
      });
    }

    /* Редактирование групового чата: название + логотип */
    async function dmGroupEditModal(gid) {
      gid = gid || activeConv;
      let info;
      try { info = await API.get(`/gchats/${gid}`); }
      catch (x) { return err(x); }
      const canEdit = info.me.is_owner || (info.chat.private_open && info.me.is_member);
      if (!canEdit) { toast('Недостаточно прав для изменения чата', 'error'); return; }
      let newPhoto = null;
      const m = openModal(`
        <h3>✏️ Настройки групового чата</h3>
        <div class="form-group">
          <label>Название</label>
          <input class="input" id="geName" maxlength="80" value="${esc(info.chat.name)}">
        </div>
        <div class="form-group">
          <label>Логотип</label>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input class="input" id="geIcon" maxlength="8" placeholder="👥" style="max-width:90px" value="${esc(info.chat.photo && !/^\/uploads\//.test(info.chat.photo) ? info.chat.photo : '')}">
            <input type="file" id="gePhoto" accept="image/*" class="hidden">
            <button class="btn ghost sm" id="gePhotoBtn">📷 Загрузить фото</button>
            ${info.chat.photo && /^\/uploads\//.test(info.chat.photo) ? '<button class="btn danger sm" id="gePhotoRemove">🗑 Удалить</button>' : ''}
            <img id="gePhotoPrev" class="upload-preview ${info.chat.photo && /^\/uploads\//.test(info.chat.photo) ? '' : 'hidden'}" ${info.chat.photo && /^\/uploads\//.test(info.chat.photo) ? `src="${esc(info.chat.photo)}"` : ''} alt="">
          </div>
        </div>
        <div class="form-error" id="geError"></div>
        <div class="modal-actions">
          <button class="btn ghost" data-close>Отмена</button>
          <button class="btn primary" id="geGo">Сохранить</button>
        </div>`);
      m.el.querySelector('#gePhotoBtn').addEventListener('click', () => m.el.querySelector('#gePhoto').click());
      const geRemove = m.el.querySelector('#gePhotoRemove');
      if (geRemove) geRemove.addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить логотип чата?', 'Вместо него будет иконка 👥.'))) return;
        try {
          await API.patch(`/gchats/${gid}`, { photo: '' });
          m.el.querySelector('#gePhotoPrev').classList.add('hidden');
          geRemove.remove();
          toast('Логотип удалён', 'ok');
          if (isGroup && activeConv === gid) {
            groupInfo = await API.get(`/gchats/${gid}`);
            await render();
          }
        } catch (x) { err(x); }
      });
      m.el.querySelector('#gePhoto').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const prev = m.el.querySelector('#gePhotoPrev');
        prev.src = URL.createObjectURL(f);
        prev.classList.remove('hidden');
        try {
          newPhoto = await uploadImage(f);
          prev.src = newPhoto;
          toast('Логотип загружен', 'ok');
        }
        catch (x) { err(x); }
      });
      m.el.querySelector('#geGo').addEventListener('click', async () => {
        try {
          const body = { name: m.el.querySelector('#geName').value.trim() };
          if (newPhoto) body.photo = newPhoto;
          else {
            const icon = m.el.querySelector('#geIcon').value.trim();
            if (icon) body.photo = icon;
          }
          await API.patch(`/gchats/${gid}`, body);
          m.close();
          toast('Сохранено', 'ok');
          if (isGroup && activeConv === gid) {
            groupInfo = await API.get(`/gchats/${gid}`);
            await render();
          } else {
            loadList();
          }
        } catch (x) { m.el.querySelector('#geError').textContent = x.message; }
      });
    }

    function showConvMenu(convId, isIgnored) {
      const m = openModal(`
        <h3>Действия с чатом</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn ghost block" id="ignoreBtn">${isIgnored ? '❌ Убрать игнор' : '🚫 Игнорировать'}</button>
          <button class="btn ghost block" id="archiveBtn">📦 Закрыть чат</button>
          <button class="btn danger block" id="clearBtn">🗑️ Удалить сообщения</button>
        </div>`);

      m.el.querySelector('#ignoreBtn').addEventListener('click', async () => {
        try {
          await API.patch(`/chat/conversations/${convId}/ignore`, { ignored: !isIgnored });
          m.close();
          await loadList();
          toast(isIgnored ? 'Игнор убран' : 'Чат игнорируется', 'ok');
        } catch (e) { err(e); }
      });

      m.el.querySelector('#archiveBtn').addEventListener('click', async () => {
        try {
          await API.patch(`/chat/conversations/${convId}/archive`, { archived: true });
          m.close();
          await loadList();
          if (activeConv === convId) {
            activeConv = null;
            render();
          }
          toast('Чат закрыт', 'ok');
        } catch (e) { err(e); }
      });

      m.el.querySelector('#clearBtn').addEventListener('click', async () => {
        if (!(await confirmDialog('Удалить все сообщения?', 'Действие необратимо.'))) return;
        try {
          await API.del(`/chat/conversations/${convId}/clear`);
          m.close();
          await loadThread(true);
          toast('Сообщения удалены', 'ok');
        } catch (e) { err(e); }
      });
    }

    function msgHtml(m) {
      const mine = m.sender_id === App.user.id;
      const avatarHtml = avatar({ username: m.sender_username, avatar_url: m.sender_avatar }, 30);
      return `
        <div class="msg ${mine ? 'mine' : ''}" data-msg-id="${m.id}">
          ${!mine ? avatarHtml : ''}
          <div class="msg-wrap">
            <div class="msg-bubble" data-bubble="${m.id}">${m.content ? UI.renderMd(m.content) : ''}${m.image_url ? `<img src="${esc(m.image_url)}" alt="" loading="lazy">` : ''}</div>
            <div class="msg-footer">
              ${mine ? `<div class="msg-actions">
                <button class="msg-action-btn" data-edit="${m.id}" title="Редактировать">✏️</button>
                <button class="msg-action-btn" data-delete="${m.id}" title="Удалить">🗑️</button>
              </div>` : ''}
              <time>${fmtTime(m.created_at)}</time>
            </div>
          </div>
          ${mine ? avatarHtml : ''}
        </div>`;
    }

    /* Групповое сообщение (персоны, упоминания, ответы) */
    function gMsgHtml(m) {
      if (m.kind === 'system') {
        let html = esc(m.content);
        if (m.sender_id && m.sender_username && m.content && m.content.includes(m.sender_username)) {
          const link = `<a class="sys-user" href="#/u/${esc(m.sender_username)}" title="Открыть профиль">${esc(m.sender_username)}</a>`;
          html = html.split(esc(m.sender_username)).join(link);
        }
        return `<div class="msg-system" style="text-align:center;color:var(--muted);font-size:.8rem;font-style:italic">${html}</div>`;
      }
      const mine = m.mine;
      const isPersona = !!m.persona;
      const name = isPersona ? m.persona.name : (m.sender_username || 'Гость');
      const avaUrl = isPersona ? m.persona.avatar_url : m.sender_avatar;
      const avatarHtml = avaUrl && /^\/uploads\//.test(avaUrl)
        ? `<span class="avatar" style="width:30px;height:30px"><img src="${esc(avaUrl)}" alt=""></span>`
        : avatar(name, 30);
      const nameHtml = isPersona
        ? `<span class="persona-link" data-persona="${m.persona.id}" title="Информация о персоне"><i class="persona-badge">П</i> <b>${esc(name)}</b></span>`
        : `<a href="#/u/${esc(m.sender_username || '')}" style="color:inherit"><b>${esc(name)}</b></a>`;
      const highlight = (m.mentioned_ids || []).includes(App.user.id);
      const replyHtml = m.reply_preview
        ? `<div class="reply-quote" data-goto="${m.reply_preview.id}">↩ ${esc(m.reply_preview.username || '')}: ${esc(m.reply_preview.first_line)}</div>` : '';
      const content = m.hidden
        ? '<i class="muted">Сообщение скрыто</i>'
        : UI.renderMd(m.content || '').replace(/@([A-Za-z0-9_а-яёА-ЯЁ.-]{2,32})/g, '<span style="color:var(--accent);font-weight:700">@$1</span>');
      return `
        <div class="msg ${mine ? 'mine' : ''} ${highlight ? 'highlight-mention' : ''}" data-msg-id="${m.id}" data-sender="${m.sender_id || ''}" data-sender-name="${esc(m.sender_username || '')}">
          ${!mine ? avatarHtml : ''}
          <div class="msg-wrap">
            <div class="msg-username">${nameHtml}</div>
            <div class="msg-bubble">${replyHtml}${content}${m.image_url ? `<img src="${esc(m.image_url)}" alt="" style="border-radius:10px;margin-top:6px">` : ''}</div>
            <div class="msg-footer"><time>${fmtTime(m.created_at)}</time></div>
          </div>
          ${mine ? avatarHtml : ''}
        </div>`;
    }
/*__SOC_APPEND__*/

    let groupMsgs = [];
    let groupReply = null;

    /* Модалка персоны (в груповом чате в ЛС) */
    async function dmPersonaInfoModal(gid, personaId) {
      let p = null;
      try {
        const d = await API.get(`/gchats/${gid}/personas`);
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
                ? `<span>Автор: <a href="#/u/${esc(p.owner_username)}">${esc(p.owner_username)}</a></span>`
                : (p.visibility === 'anonymous' ? '<span>Автор скрыт</span>' : '')}
            </div>
          </div>
        </div>
        <div class="persona-modal-bio">${p.bio ? esc(p.bio) : '<span class="muted">У персоны пока нет описания.</span>'}</div>
        <div class="modal-actions"><button class="btn ghost" data-close>Закрыть</button></div>`);
    }

    function bindGroupHandlers(box) {
      box.querySelectorAll('[data-goto]').forEach((el) => {
        el.addEventListener('click', () => {
          box.querySelector(`[data-msg-id="${el.dataset.goto}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      // клик по имени персоны → модалка с информацией
      box.querySelectorAll('.persona-link[data-persona]').forEach((el) => {
        el.addEventListener('click', () => dmPersonaInfoModal(activeConv, +el.dataset.persona));
      });
      box.querySelectorAll('.msg[data-msg-id]').forEach((el) => {
        const mid = +el.dataset.msgId;
        const m = (groupMsgs || []).find((x) => x.id === mid);
        if (!m || m.kind !== 'user') return;
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const perms = groupInfo?.me?.perms || [];
          const items = [];
          if (m.content || m.image_url) {
            items.push(['↩ Ответить', '', () => {
              groupReply = m;
              const bar = document.getElementById('replyBar');
              if (bar) {
                bar.classList.remove('hidden');
                bar.innerHTML = `↩ Ответ <b>${esc(m.persona ? m.persona.name : (m.sender_username || ''))}</b>: ${esc(String(m.content || '').split('\n')[0].slice(0, 50))} <button class="btn ghost sm" id="grpReplyCancel">✕</button>`;
                bar.querySelector('#grpReplyCancel').addEventListener('click', () => { groupReply = null; bar.classList.add('hidden'); });
              }
              document.getElementById('chatText')?.focus();
            }]);
          }
          if (+el.dataset.sender && +el.dataset.sender !== App.user.id) {
            items.push(['🚫 Игнорировать пользователя', 'danger', async () => {
              await API.post('/gchats/ignore', { user_id: +el.dataset.sender, ignored: true }).catch((x) => err(x));
              toast('Пользователь скрыт — сообщения от него будут скрыты', 'ok');
              loadThread(true);
            }]);
          }
          if (m.mine) {
            items.push(['🗑 Удалить', 'danger', async () => {
              if (!(await confirmDialog('Удалить сообщение?', 'Действие необратимо.'))) return;
              await API.del(`/gchats/${activeConv}/messages/${mid}`).catch((x) => err(x));
              el.remove();
            }]);
          } else if (perms.includes('moderate')) {
            items.push(['🗑 Удалить (модерация)', 'danger', async () => {
              await API.del(`/gchats/${activeConv}/messages/${mid}`).catch((x) => err(x));
              el.remove();
            }]);
          }
          if (perms.includes('pin')) {
            items.push(['📌 Закрепить', '', async () => {
              await API.post(`/gchats/${activeConv}/messages/${mid}/pin`, { pinned: true }).catch((x) => err(x));
              toast('Сообщение закреплено', 'ok');
            }]);
          }
          Pages.ctxMenu(e.clientX, e.clientY, items);
        });
      });
    }

    async function loadThread(initial = false) {
      if (!activeConv) return;
      const box = document.getElementById('msgBox');
      if (!box) return;
      try {
        if (isGroup) {
          const q = initial ? 'limit=60' : `after_id=${lastMsgId}`;
          const d = await API.get(`/gchats/${activeConv}/messages?${q}`);
          if (initial) {
            groupMsgs = d.items;
            box.innerHTML = d.items.map(gMsgHtml).join('') || emptyState('🍡', 'Начните беседу!', 'Отправьте первое сообщение.');
            lastMsgId = d.items.length ? d.items[d.items.length - 1].id : 0;
            scrollBottom();
          } else if (d.items.length) {
            box.querySelector('.empty-state')?.remove();
            groupMsgs.push(...d.items);
            box.insertAdjacentHTML('beforeend', d.items.map(gMsgHtml).join(''));
            lastMsgId = d.items[d.items.length - 1].id;
            scrollBottom();
          }
          if (d.items.length || initial) { bindGroupHandlers(box); UI.bindSpoilers(box); }
          const line = document.getElementById('typingLine');
          if (line) {
            const t = d.typing || [];
            line.textContent = t.length > 3
              ? ['Несколько людей печатает…', 'Целая куча людей печатает…', 'Моти перегружен людьми…'][Math.floor(Math.random() * 3)]
              : (t.length ? `${t[0].username} набирает сообщение…` : '');
          }
          return;
        }

        const q = initial ? '' : `?after_id=${lastMsgId}`;
        const d = await API.get(`/chat/conversations/${activeConv}/messages${q}`);

        if (initial) {
          box.innerHTML = d.items.map(msgHtml).join('') || emptyState('🍡', 'Начните беседу!', 'Отправьте первое сообщение или фото.');
          lastMsgId = d.items.length ? d.items[d.items.length - 1].id : 0;
          scrollBottom();
        } else if (d.items.length) {
          const hadEmpty = box.querySelector('.empty-state');
          if (hadEmpty) hadEmpty.remove();
          box.insertAdjacentHTML('beforeend', d.items.map(msgHtml).join(''));
          lastMsgId = d.items[d.items.length - 1].id;
          scrollBottom();
        }
        const line = document.getElementById('typingLine');
        if (line) {
          const t = d.typing || [];
          line.textContent = t.length ? `${t[0].username} набирает сообщение…` : '';
        }
        attachMsgHandlers();
        UI.bindSpoilers(box);
      } catch { /* диалог мог исчезнуть */ }
    }

    function attachMsgHandlers() {
      const box = document.getElementById('msgBox');
      if (!box) return;

      // Обработчики удаления
      box.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.onclick = async () => {
          const msgId = +btn.dataset.delete;
          if (!(await confirmDialog('Удалить сообщение?', 'Действие необратимо.'))) return;
          try {
            await API.del(`/chat/conversations/${activeConv}/messages/${msgId}`);
            const msg = document.querySelector(`[data-msg-id="${msgId}"]`);
            if (msg) msg.remove();
            toast('Сообщение удалено', 'ok');
          } catch (e) { err(e); }
        };
      });

      // Обработчики редактирования
      box.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.onclick = async () => {
          const msgId = +btn.dataset.edit;
          const msgEl = document.querySelector(`[data-msg-id="${msgId}"]`);
          if (!msgEl) return;
          const bubble = msgEl.querySelector('[data-bubble]');
          const oldText = bubble.textContent.trim();
          
          const m = openModal(`
            <h3>✏️ Редактировать сообщение</h3>
            <div class="form-group">
              <textarea class="input" id="editText" style="min-height:100px">${esc(oldText)}</textarea>
            </div>
            <div class="form-error" id="editError"></div>
            <div class="modal-actions">
              <button class="btn ghost" data-close>Отмена</button>
              <button class="btn primary" id="editGo">Сохранить</button>
            </div>`);
          
          m.el.querySelector('#editGo').addEventListener('click', async () => {
            const text = m.el.querySelector('#editText').value.trim();
            if (!text) {
              m.el.querySelector('#editError').textContent = 'Текст не может быть пустым';
              return;
            }
            try {
              await API.patch(`/chat/conversations/${activeConv}/messages/${msgId}`, { content: text });
              m.close();
              await loadThread(true);
              toast('Сообщение обновлено', 'ok');
            } catch (e) { m.el.querySelector('#editError').textContent = e.message; }
          });
        };
      });
    }

    function scrollBottom() {
      const box = document.getElementById('msgBox');
      if (box) box.scrollTop = box.scrollHeight;
    }

    async function render() {
      clearInterval(pollTimer); clearInterval(listTimer);
      let other = null;
      if (activeConv && !isGroup) {
        try {
          const list = await API.get('/chat/conversations');
          const c = list.items.find((x) => x.id === activeConv);
          if (c) other = c;
        } catch { /* ignore */ }
      }
      if (isGroup && activeConv) {
        try { groupInfo = await API.get(`/gchats/${activeConv}`); }
        catch { isGroup = false; activeConv = null; }
      }

      const canEditGroup = () => !!(groupInfo && groupInfo.me && (groupInfo.me.is_owner || (groupInfo.chat.private_open && groupInfo.me.is_member)));
      const gHead = isGroup && groupInfo ? `
        <div class="chat-thread-head" style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:10px">
            ${groupInfo.chat.photo && /^\/uploads\//.test(groupInfo.chat.photo)
              ? `<span class="group-ico" style="width:36px;height:36px"><img src="${esc(groupInfo.chat.photo)}" alt=""></span>`
              : `<span class="group-ico" style="width:36px;height:36px;font-size:1rem">${esc(groupInfo.chat.photo || '👥')}</span>`}
            <div>
              <b>${esc(groupInfo.chat.name)}</b>
              <div class="muted" style="font-size:.75rem">👥 ${groupInfo.chat.member_count} · груповой чат</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${canEditGroup() ? '<button class="icon-btn" id="grpEditBtn" title="Название и иконка">✏️</button>' : ''}
            <button class="icon-btn" id="grpMenuBtn" title="Меню чата">⋮</button>
          </div>
        </div>` : '';

      const otherOnline = other && other.other_last_seen && (Date.now() - new Date(other.other_last_seen).getTime() < 3 * 60 * 1000);
      const threadHead = isGroup
        ? gHead
        : (activeConv && other ? `
          <div class="chat-thread-head">
            <a href="#/u/${esc(other.other_username)}" style="display:flex;align-items:center;gap:10px;color:var(--text)">
              <span style="position:relative">
                ${avatar({ username: other.other_username, avatar_url: other.other_avatar }, 36)}
                <span class="online-dot ${otherOnline ? 'on' : ''}" style="position:absolute;right:-2px;bottom:-2px" title="${otherOnline ? 'в сети' : 'не в сети'}"></span>
              </span>
              <b>${esc(other.other_username)}</b>
            </a>
          </div>` : '');

      app.innerHTML = `
        <div class="section-head"><h2>✉️ Личные сообщения</h2>
          <button class="btn primary sm" id="newChatBtn">＋ Новый чат</button>
        </div>
        <div class="chat-layout ${isGroup ? 'with-members' : ''}">
          <aside class="chat-list">
            <div class="chat-list-head"><b>Диалоги</b></div>
            <div id="convList"></div>
          </aside>
          <section class="chat-thread">
            ${activeConv ? `
              ${threadHead}
              <div class="chat-messages" id="msgBox"></div>
              <div class="typing-line" id="typingLine"></div>
              <div class="pinned-bar hidden" id="replyBar"></div>
              <div class="chat-input-bar">
                <button class="icon-btn hide-sm" id="mdToggle" title="Режим форматирования (Enter — новая строка)">✍</button>
                <input type="file" id="chatFile" accept="image/*" class="hidden">
                <button class="icon-btn" id="chatImgBtn" title="Отправить фото">🖼</button>
                ${isGroup && groupInfo && groupInfo.chat.personas_enabled ? '<button class="icon-btn" id="grpPersonaBtn" title="От чьего лица писать" style="font-size:.75rem">🪪</button>' : ''}
                <textarea id="chatText" rows="1" placeholder="Сообщение… (Enter — отправить)"></textarea>
                <button class="icon-btn" id="chatSend" title="Отправить" style="background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none">➤</button>
              </div>
              <div class="md-toolbar-wrap">${UI.mdToolbar()}</div>`
            : `<div class="chat-empty">${emptyState('👈', 'Выберите диалог', 'Или начните новый чат по имени пользователя.')}</div>`}
          </section>
          ${isGroup && groupInfo ? renderDmMembers(groupInfo) : ''}
        </div>`;

      await loadList();
      if (activeConv) await loadThread(true);

      document.getElementById('newChatBtn').addEventListener('click', () => newChatModal());
      const grpMenu = document.getElementById('grpMenuBtn');
      if (grpMenu) grpMenu.addEventListener('click', () => showGroupMenu(activeConv));
      const grpEdit = document.getElementById('grpEditBtn');
      if (grpEdit) grpEdit.addEventListener('click', () => dmGroupEditModal(activeConv));
      if (isGroup && groupInfo) bindDmMembers();
      const grpPersona = document.getElementById('grpPersonaBtn');
      if (grpPersona) grpPersona.addEventListener('click', () => dmPersonaPicker());
      const imgBtn = document.getElementById('chatImgBtn');
      if (imgBtn) imgBtn.addEventListener('click', () => document.getElementById('chatFile').click());
      const fileInput = document.getElementById('chatFile');
      if (fileInput) fileInput.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const url = await uploadImage(f);
          if (isGroup) await API.post(`/gchats/${activeConv}/messages`, { content: '📷', image_url: url });
          else await API.post(`/chat/conversations/${activeConv}/messages`, { content: '', image_url: url });
          await loadThread(true);
          loadList();
        } catch (ex) { err(ex); }
      });
      const sendBtn = document.getElementById('chatSend');
      const textEl = document.getElementById('chatText');
      UI.bindMdToggle(document.getElementById('mdToggle'), document.getElementById('mdToolbar'), textEl);
      if (sendBtn) {
        let lastTyping = 0;
        textEl.addEventListener('input', () => {
          const now = Date.now();
          if (now - lastTyping > 2000) {
            lastTyping = now;
            if (isGroup) API.post(`/gchats/${activeConv}/typing`, {}).catch(() => {});
            else API.post(`/chat/conversations/${activeConv}/typing`, {}).catch(() => {});
          }
        });
        const send = async () => {
          const text = textEl.value.trim();
          if (!text) return;
          sendBtn.disabled = true;
          try {
            if (isGroup) {
              await API.post(`/gchats/${activeConv}/messages`, {
                content: text,
                persona_id: groupPersona ? groupPersona.id : undefined,
                reply_to_id: groupReply ? groupReply.id : undefined,
              });
              groupReply = null;
              document.getElementById('replyBar')?.classList.add('hidden');
              await loadThread(false);
              loadList();
            } else {
              await API.post(`/chat/conversations/${activeConv}/messages`, { content: text });
              textEl.value = '';
              await loadThread(true);
              loadList();
            }
            if (isGroup) textEl.value = '';
          } catch (e) { err(e); }
          sendBtn.disabled = false;
        };
        sendBtn.addEventListener('click', send);
        textEl.addEventListener('keydown', (e) => {
          const mdBar = document.getElementById('mdToolbar');
          const mdOn = mdBar && !mdBar.hasAttribute('hidden');
          if (e.key === 'Enter' && !e.shiftKey && !mdOn) { e.preventDefault(); send(); }
        });
      }

      // поллинг новых сообщений и списка
      pollTimer = setInterval(() => loadThread(false), 3000);
      listTimer = setInterval(loadList, 15000);
    }

    /* Выбор персоны в груповом чате (в ЛС) */
    let groupPersona = null;
    async function dmPersonaPicker() {
      let d;
      try { d = await API.get(`/gchats/${activeConv}/personas`); } catch (e) { return err(e); }
      const mine = (d.items || []).filter((p) => p.mine);
      const m = openModal(`
        <h3>🪪 От чьего лица писать?</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn ghost block ${!groupPersona ? 'primary' : ''}" data-pick="0">От себя (${esc(App.user.username)})</button>
          ${mine.filter((p) => p.status === 'approved').map((p) => `
            <button class="btn ghost block ${groupPersona && groupPersona.id === p.id ? 'primary' : ''}" data-pick="${p.id}">
              ${esc(p.name)} ${p.visibility === 'anonymous' ? '(аноним)' : ''}
            </button>`).join('')}
        </div>`);
      m.el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
        groupPersona = +b.dataset.pick ? mine.find((p) => p.id === +b.dataset.pick) : null;
        m.close();
        toast(groupPersona ? `Пишем от лица «${groupPersona.name}»` : 'Пишем от себя', 'ok');
      }));
    }

    function newChatModal() {
      let type = 'dm';
      const m = openModal(`
        <h3>✉️ Новый чат</h3>
        <div class="form-group">
          <label>Тип</label>
          <div style="display:flex;gap:6px">
            <button class="btn ghost sm active" data-ct="dm">👤 Личный</button>
            <button class="btn ghost sm" data-ct="group">👥 Груповой</button>
          </div>
        </div>
        <div class="form-group">
          <label id="ncLabel">Имя пользователя</label>
          <input class="input" id="ncName" placeholder="например, sakura" maxlength="32">
        </div>
        <div class="form-group hidden" id="ncGroupExtras">
          <label><input type="checkbox" id="ncOpen" checked> Все участники могут менять иконку и название</label>
        </div>
        <div class="form-error" id="ncError"></div>
        <div class="modal-actions">
          <button class="btn ghost" data-close>Отмена</button>
          <button class="btn primary" id="ncGo">Открыть</button>
        </div>`);
      m.el.querySelectorAll('[data-ct]').forEach((b) => b.addEventListener('click', () => {
        type = b.dataset.ct;
        m.el.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('active', x === b));
        m.el.querySelector('#ncLabel').textContent = type === 'group' ? 'Название групового чата' : 'Имя пользователя';
        m.el.querySelector('#ncName').placeholder = type === 'group' ? 'например, Моти-тусовка' : 'например, sakura';
        m.el.querySelector('#ncGroupExtras').classList.toggle('hidden', type !== 'group');
      }));
      const go = async () => {
        const name = m.el.querySelector('#ncName').value.trim();
        try {
          if (type === 'group') {
            const r = await API.post('/gchats', { kind: 'private', name, private_open: m.el.querySelector('#ncOpen').checked });
            m.close();
            location.hash = `#/chat/${r.chat.id}?g=1`;
          } else {
            const r = await API.post('/chat/conversations', { username: name });
            m.close();
            location.hash = `#/chat/${r.conversation.id}`;
          }
        } catch (e) { m.el.querySelector('#ncError').textContent = e.message; }
      };
      m.el.querySelector('#ncGo').addEventListener('click', go);
      m.el.querySelector('#ncName').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }

    await render();
    // очистка таймеров при уходе со страницы
    const observer = new MutationObserver(() => {
      if (!document.getElementById('convList')) {
        clearInterval(pollTimer); clearInterval(listTimer);
        observer.disconnect();
      }
    });
    observer.observe(app, { childList: true });
  };

  /* ================= АДМИН-ПАНЕЛЬ ================= */
  Pages.admin = async function () {
    if (!App.user) return App.requireLogin();
    if (!['admin'].includes(App.user.role)) {
      document.getElementById('app').innerHTML = emptyState('⛔', 'Доступ только для администраторов');
      return;
    }
    const app = document.getElementById('app');
    let tab = 'overview';
    let usersQ = '';
    let reportsStatus = '';

    async function render() {
      app.innerHTML = `
        <div class="section-head"><h2>🛠 Админ-панель</h2></div>
        <div class="tabs">
          <button data-tab="overview" class="${tab === 'overview' ? 'active' : ''}">Обзор</button>
          <button data-tab="users" class="${tab === 'users' ? 'active' : ''}">Пользователи</button>
          <button data-tab="reports" class="${tab === 'reports' ? 'active' : ''}">Жалобы</button>
          <button data-tab="categories" class="${tab === 'categories' ? 'active' : ''}">Категории</button>
          <button data-tab="bans" class="${tab === 'bans' ? 'active' : ''}">История банов</button>
        </div>
        <div id="adminBody"><div class="spinner"></div></div>`;
      app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
      await loadTab();
    }

    async function loadTab() {
      const body = document.getElementById('adminBody');

      /* ---- Обзор ---- */
      if (tab === 'overview') {
        const s = (await API.get('/admin/stats')).stats;
        body.innerHTML = `
          <div class="admin-grid">
            <div class="stat-tile"><b>${fmtNum(s.users_total)}</b><span>пользователей (+${s.users_today} за сутки)</span></div>
            <div class="stat-tile"><b>${fmtNum(s.topics_total)}</b><span>тем</span></div>
            <div class="stat-tile"><b>${fmtNum(s.posts_total)}</b><span>сообщений</span></div>
            <div class="stat-tile"><b>${fmtNum(s.messages_total)}</b><span>личных сообщений</span></div>
            <div class="stat-tile"><b style="color:${s.reports_open ? 'var(--warn)' : 'inherit'}">${fmtNum(s.reports_open)}</b><span>открытых жалоб</span></div>
            <div class="stat-tile"><b>${fmtNum(s.banned_now)}</b><span>в бане сейчас</span></div>
          </div>`;
        return;
      }

      /* ---- Пользователи ---- */
      if (tab === 'users') {
        const d = await API.get(`/admin/users?q=${encodeURIComponent(usersQ)}&limit=20`);
        body.innerHTML = `
          <form id="userSearchForm" style="display:flex;gap:10px;margin-bottom:14px">
            <input class="input" id="userSearch" placeholder="Поиск по имени или email…" value="${esc(usersQ)}">
            <button class="btn ghost">Найти</button>
          </form>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>ID</th><th>Пользователь</th><th>Email</th><th>Роль</th><th>Активность</th><th>Статус</th><th>Действия</th></tr></thead>
            <tbody>
              ${d.items.map((u) => `
                <tr>
                  <td>#${u.id}</td>
                  <td><a href="#/u/${esc(u.username)}" style="display:flex;gap:8px;align-items:center;color:var(--text)">
                    ${avatar(u, 28)}<b>${esc(u.username)}</b></a></td>
                  <td class="muted">${esc(u.email)}</td>
                  <td>
                    <select class="input" data-role="${u.id}" ${u.role === 'admin' && u.id === App.user.id ? 'disabled title="Это вы"' : ''}>
                      ${['user', 'moderator', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
                  </td>
                  <td class="muted">${u.topics_count} тем / ${u.posts_count} постов</td>
                  <td>${u.is_banned ? `<span class="chip" style="color:var(--danger)">⛔ бан${u.banned_until ? ` до ${new Date(u.banned_until).toLocaleDateString('ru-RU')}` : ' навсегда'}</span>` : '<span class="chip" style="color:var(--ok)">активен</span>'}</td>
                  <td style="white-space:nowrap">
                    ${u.is_banned
                      ? `<button class="btn ghost sm" data-unban="${u.id}">Разбанить</button>`
                      : u.role !== 'admin' ? `<button class="btn danger sm" data-ban="${u.id}">Бан</button>` : ''}
                    ${u.role !== 'admin' ? `<button class="btn danger sm" data-deluser="${u.id}" title="Удалить аккаунт">🗑</button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>
          ${d.totalPages > 1 ? pager(d.page ?? 1, d.totalPages) : ''}
        `;
        bindPager(body, () => {});
        document.getElementById('userSearchForm').addEventListener('submit', (e) => {
          e.preventDefault();
          usersQ = document.getElementById('userSearch').value.trim();
          loadTab();
        });
        body.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
          try {
            await API.patch(`/admin/users/${sel.dataset.role}`, { role: sel.value });
            toast('Роль обновлена', 'ok');
          } catch (e) { err(e); loadTab(); }
        }));
        body.querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', () => banModal(+b.dataset.ban)));
        body.querySelectorAll('[data-unban]').forEach((b) => b.addEventListener('click', async () => {
          try { await API.patch(`/admin/users/${b.dataset.unban}`, { action: 'unban' }); toast('Бан снят', 'ok'); loadTab(); }
          catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-deluser]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await confirmDialog('Удалить аккаунт?', 'Все темы, сообщения и файлы пользователя будут удалены. Действие необратимо.'))) return;
          try { await API.del(`/admin/users/${b.dataset.deluser}`); toast('Аккаунт удалён', 'ok'); loadTab(); }
          catch (e) { err(e); }
        }));
        return;
      }

      /* ---- Жалобы ---- */
      if (tab === 'reports') {
        const d = await API.get(`/reports?${reportsStatus ? `status=${reportsStatus}&` : ''}limit=20`);
        body.innerHTML = `
          <div class="sort-tabs" style="margin-bottom:16px;display:inline-flex">
            ${[['', 'Все'], ['open', 'Открытые'], ['resolved', 'Решённые'], ['dismissed', 'Отклонённые']]
              .map(([k, l]) => `<a href="javascript:void(0)" data-st="${k}" class="${reportsStatus === k ? 'active' : ''}">${l}</a>`).join('')}
          </div>
          <div id="reportsBox">
            ${d.items.length ? d.items.map((r) => `
              <div class="card report-card ${r.status}" style="margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                  <div>
                    <b>#${r.id}</b> · жалоба от <a href="#/u/${esc(r.reporter_username)}">${esc(r.reporter_username || '?')}</a>
                    на <span class="chip accent">${r.target_type} #${r.target_id}</span>
                    <p style="margin:8px 0 4px">${esc(r.reason)}</p>
                    <span class="muted" style="font-size:.8rem">${timeAgo(r.created_at)}
                      ${r.status !== 'open' ? `· обработал(а): ${esc(r.resolved_by_username || '?')} (${r.status})` : ''}</span>
                  </div>
                  ${r.status === 'open' ? `
                  <div style="display:flex;gap:8px;flex-shrink:0">
                    <button class="btn ghost sm" data-view="${r.target_type}:${r.target_id}">👁 Объект</button>
                    <button class="btn primary sm" data-resolve="${r.id}">Принять меры</button>
                    <button class="btn ghost sm" data-dismiss="${r.id}">Отклонить</button>
                  </div>` : ''}
                </div>
              </div>`).join('') : emptyState('✅', 'Жалоб нет', 'Всё спокойно.')}
          </div>`;
        body.querySelectorAll('[data-st]').forEach((a) => a.addEventListener('click', () => { reportsStatus = a.dataset.st; loadTab(); }));
        body.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
          const [type, id] = b.dataset.view.split(':');
          try {
            const t = (await API.get(`/reports/target?type=${type}&id=${id}`)).target;
            openModal(`
              <h3>👁 Объект жалобы: ${esc(type)} #${t.id}</h3>
              ${t.author_username ? `<p class="muted">Автор: <b>${esc(t.author_username)}</b></p>` : ''}
              ${t.title ? `<p><b>${esc(t.title)}</b></p>` : ''}
              ${t.content ? `<div class="post-quote" style="max-height:200px;overflow:auto">${esc(t.content)}</div>` : ''}
              ${t.image_url ? `<img src="${esc(t.image_url)}" style="border-radius:10px;max-height:220px">` : ''}
              ${t.bio !== undefined ? `<p>${esc(t.bio || 'Без описания')}</p>` : ''}
              ${type === 'post' && t.topic_id ? `<a class="btn ghost sm" href="#/topic/${t.topic_id}">Открыть тему →</a>` : ''}
            `);
          } catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await API.patch(`/reports/${b.dataset.resolve}`, { status: 'resolved' });
            toast('Жалоба закрыта с мерами', 'ok'); loadTab();
          } catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', async () => {
          try {
            await API.patch(`/reports/${b.dataset.dismiss}`, { status: 'dismissed' });
            toast('Жалоба отклонена', 'ok'); loadTab();
          } catch (e) { err(e); }
        }));
        return;
      }

      /* ---- Категории ---- */
      if (tab === 'categories') {
        const cats = (await API.get('/categories')).items;
        body.innerHTML = `
          <form class="card" id="catForm" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;align-items:flex-end">
            <div style="flex:2;min-width:160px"><label>Название</label><input class="input" id="catName" maxlength="100"></div>
            <div style="flex:3;min-width:200px"><label>Описание</label><input class="input" id="catDesc" maxlength="500"></div>
            <div style="width:80px"><label>Иконка</label><input class="input" id="catIcon" value="🍡" maxlength="4"></div>
            <div style="width:90px"><label>Цвет</label><input type="color" class="input" id="catColor" value="#7c5cff" style="height:42px;padding:4px"></div>
            <button class="btn primary" type="submit">＋ Добавить</button>
          </form>
          <div class="table-wrap"><table class="table" style="min-width:640px">
            <thead><tr><th></th><th>Название</th><th>Slug</th><th>Тем</th><th>Позиция</th><th></th></tr></thead>
            <tbody>
              ${cats.map((c) => `
                <tr>
                  <td style="font-size:1.3rem">${esc(c.icon)}</td>
                  <td><b>${esc(c.name)}</b><div class="muted" style="font-size:.78rem">${esc(c.description)}</div></td>
                  <td class="muted">${esc(c.slug)}</td>
                  <td>${c.topic_count}</td>
                  <td><input class="input" style="width:70px;padding:6px" type="number" min="0" max="999" value="${c.position}" data-pos="${c.id}"></td>
                  <td style="white-space:nowrap">
                    <button class="btn ghost sm" data-editcat="${c.id}">✏️</button>
                    <button class="btn danger sm" data-delcat="${c.id}">🗑</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>`;
        document.getElementById('catForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await API.post('/categories', {
              name: document.getElementById('catName').value.trim(),
              description: document.getElementById('catDesc').value.trim(),
              icon: document.getElementById('catIcon').value.trim() || '🍡',
              color: document.getElementById('catColor').value,
            });
            toast('Категория создана', 'ok'); loadTab();
          } catch (ex) { err(ex); }
        });
        body.querySelectorAll('[data-pos]').forEach((inp) => inp.addEventListener('change', async () => {
          try { await API.patch(`/categories/${inp.dataset.pos}`, { position: +inp.value }); toast('Порядок обновлён', 'ok'); }
          catch (e) { err(e); }
        }));
        body.querySelectorAll('[data-editcat]').forEach((b) => b.addEventListener('click', () => {
          const c = cats.find((x) => x.id === +b.dataset.editcat);
          const m = openModal(`
            <h3>✏️ Категория</h3>
            <div class="form-group"><label>Название</label><input class="input" id="ecName" value="${esc(c.name)}"></div>
            <div class="form-group"><label>Описание</label><input class="input" id="ecDesc" value="${esc(c.description)}"></div>
            <div class="form-group"><label>Иконка</label><input class="input" id="ecIcon" value="${esc(c.icon)}" maxlength="4"></div>
            <div class="modal-actions">
              <button class="btn ghost" data-close>Отмена</button>
              <button class="btn primary" id="ecSave">Сохранить</button>
            </div>`);
          m.el.querySelector('#ecSave').addEventListener('click', async () => {
            try {
              await API.patch(`/categories/${c.id}`, {
                name: m.el.querySelector('#ecName').value.trim(),
                description: m.el.querySelector('#ecDesc').value.trim(),
                icon: m.el.querySelector('#ecIcon').value.trim(),
              });
              m.close(); toast('Сохранено', 'ok'); loadTab();
            } catch (e) { err(e); }
          });
        }));
        body.querySelectorAll('[data-delcat]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await confirmDialog('Удалить категорию?', 'Все темы внутри будут удалены безвозвратно!'))) return;
          try { await API.del(`/categories/${b.dataset.delcat}`); toast('Категория удалена', 'ok'); loadTab(); }
          catch (e) { err(e); }
        }));
        return;
      }

      /* ---- История банов ---- */
      if (tab === 'bans') {
        const d = await API.get('/admin/bans?limit=50');
        body.innerHTML = d.items.length ? `
          <div class="table-wrap"><table class="table" style="min-width:640px">
            <thead><tr><th>Кого</th><th>Причина</th><th>До</th><th>Модератор</th><th>Когда</th><th>Статус</th></tr></thead>
            <tbody>
              ${d.items.map((b) => `
                <tr>
                  <td><b>${esc(b.user_username || `#${b.user_id}`)}</b></td>
                  <td>${esc(b.reason)}</td>
                  <td>${b.until ? fullDate(b.until) : '<span style="color:var(--danger)">навсегда</span>'}</td>
                  <td>${esc(b.moderator_username || '—')}</td>
                  <td class="muted">${timeAgo(b.created_at)}</td>
                  <td>${b.active ? '<span class="chip" style="color:var(--warn)">активен</span>' : '<span class="chip" style="color:var(--ok)">снят</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>` : emptyState('🕊', 'Банов ещё не было');
      }
    }

    function banModal(userId) {
      const m = openModal(`
        <h3>⛔ Забанить пользователя #${userId}</h3>
        <div class="form-group">
          <label>Срок</label>
          <select class="input" id="bnDays">
            <option value="">Навсегда</option>
            <option value="1">1 день</option>
            <option value="3">3 дня</option>
            <option value="7">7 дней</option>
            <option value="30">30 дней</option>
            <option value="90">90 дней</option>
          </select>
        </div>
        <div class="form-group">
          <label>Причина</label>
          <textarea class="input" id="bnReason" maxlength="300" placeholder="Будет показана пользователю"></textarea>
        </div>
        <div class="form-error" id="bnError"></div>
        <div class="modal-actions">
          <button class="btn ghost" data-close>Отмена</button>
          <button class="btn danger" id="bnGo">Забанить</button>
        </div>`);
      m.el.querySelector('#bnGo').addEventListener('click', async () => {
        try {
          await API.patch(`/admin/users/${userId}`, {
            action: 'ban',
            days: m.el.querySelector('#bnDays').value || null,
            reason: m.el.querySelector('#bnReason').value.trim(),
          });
          m.close(); toast('Пользователь забанен', 'ok'); loadTab();
        } catch (e) { m.el.querySelector('#bnError').textContent = e.message; }
      });
    }

    await render();
  };
})();