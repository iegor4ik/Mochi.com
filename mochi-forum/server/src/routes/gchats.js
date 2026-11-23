/**
 * Групповые чаты (чатсы) M-o-chi.com.
 * Виды: public (вступает кто угодно), request (по заявке), private (по приглашению).
 * Персоны, роли, подчатсы, заявки, баны, упоминания, ответы, онлайн.
 */
const express = require('express');
const { query, withTransaction } = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const {
  asyncH, notFound, forbidden, bad, paginate, pages, notify,
} = require('../utils/helpers');
const {
  PERMS, hasPerm, memberPerms, joinPhrase, leavePhrase, PIN_PHRASES,
  sanitizeDescription, sanitizeDescBg, sanitizeChatTheme, sanitizeIcon,
  setTyping, getTyping, extractMentions,
} = require('../utils/gchat-utils');
const { releaseUpload, extractUploadUrls } = require('../utils/uploads');

const router = express.Router();

const CHAT_KINDS = ['public', 'request', 'private'];

/* ================= Хелперы ================= */

/** Загрузить чат */
async function loadChat(id) {
  const { rows } = await query('SELECT * FROM gchats WHERE id=$1', [id]);
  if (!rows[0]) throw notFound('Чатс не найден');
  return rows[0];
}

/** Участие пользователя в чате (с правами роли) */
async function loadMember(chatId, userId) {
  if (!userId) return null;
  const { rows } = await query(
    `SELECT m.*, r.permissions, r.name AS role_name, r.color AS role_color
     FROM gchat_members m
     LEFT JOIN gchat_roles r ON r.id = m.role_id
     WHERE m.chat_id=$1 AND m.user_id=$2`,
    [chatId, userId]
  );
  return rows[0] || null;
}

/** Активный бан пользователя в чате */
async function activeBan(chatId, userId) {
  const { rows } = await query(
    `SELECT * FROM gchat_bans
     WHERE chat_id=$1 AND user_id=$2 AND active=true
       AND (until IS NULL OR until > now()) LIMIT 1`,
    [chatId, userId]
  );
  return rows[0] || null;
}

/** Мутит ли участника */
function isMuted(member) {
  return !!(member && member.muted_until && new Date(member.muted_until) > new Date());
}

/** Добавить участника (+системное сообщение о входе, sender_id = кто вошёл) */
async function addMember(client, chat, userId, systemUsername) {
  await client.query(
    `INSERT INTO gchat_members (chat_id, user_id, last_read_at) VALUES ($1,$2,now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET last_read_at=now()`,
    [chat.id, userId]
  );
  await client.query('UPDATE gchats SET member_count=member_count+1 WHERE id=$1', [chat.id]);
  await client.query(
    `INSERT INTO gchat_messages (chat_id, kind, content, sender_id) VALUES ($1,'system',$2,$3)`,
    [chat.id, joinPhrase(systemUsername), userId]
  );
  await client.query('UPDATE gchats SET last_message_at=now() WHERE id=$1', [chat.id]);
}

/** Удалить участника (+системное сообщение, sender_id = кто ушёл) */
async function removeMember(client, chat, userId, username, withPhrase = true) {
  const del = await client.query(
    'DELETE FROM gchat_members WHERE chat_id=$1 AND user_id=$2', [chat.id, userId]
  );
  if (del.rowCount > 0) {
    await client.query('UPDATE gchats SET member_count = GREATEST(member_count-1, 0) WHERE id=$1', [chat.id]);
    if (withPhrase) {
      await client.query(
        `INSERT INTO gchat_messages (chat_id, kind, content, sender_id) VALUES ($1,'system',$2,$3)`,
        [chat.id, leavePhrase(username), userId]
      );
      await client.query('UPDATE gchats SET last_message_at=now() WHERE id=$1', [chat.id]);
    }
  }
}

/** Данные об участии текущего пользователя */
function myMembership(chat, member, user) {
  if (!user) return { is_member: false, is_owner: false, perms: [] };
  return {
    is_member: !!member,
    is_owner: chat.owner_id === user.id,
    role: member ? member.role : null,
    role_id: member ? member.role_id : null,
    role_name: member ? member.role_name || (member.role === 'curator' ? 'Куратор' : null) : null,
    role_color: member ? member.role_color : null,
    muted_until: member ? member.muted_until : null,
    is_muted: isMuted(member),
    perms: memberPerms(chat, member, user),
  };
}

/** Базовая JSON-карточка чата для списков */
function chatCard(c, extra = {}) {
  return {
    id: c.id, kind: c.kind, name: c.name, photo: c.photo,
    member_count: c.member_count, messages_count: c.messages_count,
    tags: c.tags, last_message_at: c.last_message_at, created_at: c.created_at,
    owner_id: c.owner_id, owner_username: c.owner_username,
    owner_avatar: c.owner_avatar, topic_id: c.topic_id,
    excerpt: c.description
      ? String(c.description.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
      : '',
    ...extra,
  };
}
/* ================= ЛЕНТА ================= */

/**
 * GET /api/gchats?tab=recent|popular|subs&q=&tag=&page=&limit=
 * Лента чатсов: недавние / популярные / подписки. Приватные в ленте не участвуют.
 */
router.get('/', optionalAuth, asyncH(async (req, res) => {
  const tab = ['recent', 'popular', 'subs'].includes(req.query.tab) ? req.query.tab : 'recent';
  const { page, limit, offset } = paginate(req.query, 12, 40);
  const q = String(req.query.q || '').trim();
  const tag = String(req.query.tag || '').trim().replace(/^#/, '').toLowerCase();

  const conds = [`c.kind <> 'private'`];
  const params = [];
  if (tag) { params.push(tag); conds.push(`c.tags @> ARRAY[$${params.length}::text]`); }
  if (q) {
    params.push(`%${q}%`);
    conds.push(`(c.name ILIKE $${params.length} OR c.description->>'html' ILIKE $${params.length})`);
  }
  if (tab === 'subs') {
    if (!req.user) throw forbidden('Войдите, чтобы видеть ленту подписок', { unauthorized: true });
    params.push(req.user.id);
    conds.push(`c.owner_id IN (SELECT following_id FROM follows WHERE follower_id=$${params.length})`);
  }
  const where = conds.join(' AND ');
  const order = tab === 'popular' ? 'c.member_count DESC, c.last_message_at DESC NULLS LAST' : 'c.created_at DESC';

  const total = (await query(`SELECT COUNT(*)::int AS n FROM gchats c WHERE ${where}`, params)).rows[0].n;
  const { rows } = await query(
    `SELECT c.*, ou.username AS owner_username, ou.avatar_url AS owner_avatar
     FROM gchats c JOIN users ou ON ou.id=c.owner_id
     WHERE ${where}
     ORDER BY ${order}
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const mine = {};
  if (req.user && rows.length) {
    const ids = rows.map((r) => r.id);
    const { rows: mem } = await query(
      `SELECT chat_id FROM gchat_members WHERE user_id=$1 AND chat_id = ANY($2::int[])`,
      [req.user.id, ids]
    );
    mem.forEach((m) => { mine[m.chat_id] = 'member'; });
    const { rows: pend } = await query(
      `SELECT chat_id FROM gchat_join_requests WHERE user_id=$1 AND status='pending' AND chat_id = ANY($2::int[])`,
      [req.user.id, ids]
    );
    pend.forEach((p) => { if (!(p.chat_id in mine)) mine[p.chat_id] = 'pending'; });
  }

  res.json({
    tab, page, totalPages: pages(total, limit), total,
    items: rows.map((c) => chatCard(c, { my_status: mine[c.id] || null })),
  });
}));

/** GET /api/gchats/mine — чаты, в которых я состою (приватные живут в ЛС основного сайта) */
router.get('/mine', requireAuth, asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.kind, c.name, c.photo, c.member_count, c.last_message_at, c.private_open,
            (SELECT content FROM gchat_messages gm WHERE gm.chat_id=c.id ORDER BY gm.created_at DESC LIMIT 1) AS last_content,
            (SELECT COUNT(*)::int FROM gchat_messages gm
              WHERE gm.chat_id=c.id AND gm.created_at > m.last_read_at
                AND (gm.sender_id IS NULL OR gm.sender_id <> $1) AND gm.kind='user') AS unread
     FROM gchats c JOIN gchat_members m ON m.chat_id=c.id AND m.user_id=$1
     WHERE c.kind <> 'private'
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows });
}));

/** Нормализация тегов (макс. 10 по 32 символа) */
function sanitizeTagsArr(tags) {
  if (!Array.isArray(tags)) {
    if (typeof tags === 'string') tags = tags.split(/[,\s]+/);
    else return [];
  }
  const out = [];
  const seen = new Set();
  for (let t of tags) {
    if (typeof t !== 'string') continue;
    t = t.trim().replace(/^#+/, '').toLowerCase().replace(/[^\wа-яё-]/gi, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t.slice(0, 32));
    if (out.length >= 10) break;
  }
  return out;
}
/* ================= СОЗДАНИЕ ================= */

/** POST /api/gchats — создать чатс */
router.post('/', requireAuth, asyncH(async (req, res) => {
  const kind = v.oneOf(req.body.kind, CHAT_KINDS, { label: 'Тип чата', optional: true, def: 'public' });
  const name = v.str(req.body.name, { label: 'Название', min: 2, max: 80 });
  const description = sanitizeDescription(req.body.description);
  const descBg = sanitizeDescBg(req.body.desc_bg);
  const theme = sanitizeChatTheme(req.body.theme);
  const msgVisibility = v.oneOf(req.body.msg_visibility, ['members', 'everyone'], { label: 'Видимость сообщений', optional: true, def: 'members' });
  const tags = (req.body.tags !== undefined) ? sanitizeTagsArr(req.body.tags) : [];

  let initial = null;
  if (req.body.initial_member) {
    const u = String(req.body.initial_member).trim();
    if (u) {
      const { rows } = await query('SELECT id, username FROM users WHERE lower(username)=lower($1)', [u]);
      if (!rows[0]) throw bad('Пользователь для приглашения не найден');
      if (rows[0].id === req.user.id) throw bad('Нельзя пригласить самого себя');
      initial = rows[0];
    }
  }

  const { rows } = await query(
    `INSERT INTO gchats (kind, name, photo, description, desc_bg, theme, msg_visibility,
                         owner_id, personas_enabled, personas_approval, personas_only, private_open, tags)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [kind, name, sanitizeIcon(req.body.photo), JSON.stringify(description), JSON.stringify(descBg),
     JSON.stringify(theme), msgVisibility, req.user.id,
     v.bool(req.body.personas_enabled, false), v.bool(req.body.personas_approval, false),
     v.bool(req.body.personas_only, false), v.bool(req.body.private_open, false), tags]
  );
  const chat = rows[0];
  await query(
    `INSERT INTO gchat_members (chat_id, user_id, role, last_read_at) VALUES ($1,$2,'member',now())`,
    [chat.id, req.user.id]
  );
  await query('UPDATE gchats SET member_count=1 WHERE id=$1', [chat.id]);

  if (initial && kind === 'private') {
    await query(`INSERT INTO gchat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [chat.id, initial.id]);
    await query('UPDATE gchats SET member_count=2 WHERE id=$1', [chat.id]);
    await notify(query, {
      userId: initial.id, type: 'chat_added', actorId: req.user.id,
      entityType: 'gchat', entityId: chat.id,
      payload: { chat_name: chat.name },
    });
  } else if (initial) {
    const inv = await query(
      `INSERT INTO gchat_invites (chat_id, inviter_id, invitee_id) VALUES ($1,$2,$3) RETURNING *`,
      [chat.id, req.user.id, initial.id]
    );
    await notify(query, {
      userId: initial.id, type: 'chat_invite', actorId: req.user.id,
      entityType: 'gchat', entityId: chat.id,
      payload: { invite_id: inv.rows[0].id, chat_name: chat.name },
    });
  }

  res.status(201).json({ chat: { ...chat, owner_username: req.user.username, owner_avatar: req.user.avatar_url } });
}));
/* ================= СТРАНИЦА ЧАТСА ================= */

/** SQL «в сети ли» */
function SELECT_ONLINE_SQL() {
  return `(u.last_seen_at IS NOT NULL AND u.last_seen_at > now() - interval '3 minutes')`;
}

/**
 * GET /api/gchats/:id — страница чатса.
 * Описание видно всем; сообщения — по настройке msg_visibility.
 * Приватный чат для неучастника — 404.
 */
router.get('/:id', optionalAuth, asyncH(async (req, res, next) => {
  // нечисловой «id» (например /invites) — пропускаем к следующим маршрутам
  if (!/^\d+$/.test(req.params.id)) return next();
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user?.id);

  if (chat.kind === 'private' && !member && (!req.user || !['moderator', 'admin'].includes(req.user.role))) {
    throw notFound('Чатс не найден');
  }

  const canModerateSite = req.user && ['moderator', 'admin'].includes(req.user.role);
  const canViewMessages = !!member || chat.msg_visibility === 'everyone' || canModerateSite;

  const { rows: members } = await query(
    `SELECT u.id, u.username, u.avatar_url, u.role AS site_role, m.role, m.role_id,
            r.name AS role_name, r.color AS role_color,
            ${SELECT_ONLINE_SQL()} AS online, m.muted_until, m.joined_at
     FROM gchat_members m JOIN users u ON u.id=m.user_id
     LEFT JOIN gchat_roles r ON r.id=m.role_id
     WHERE m.chat_id=$1
     ORDER BY (u.id=$2) DESC, (m.role='curator') DESC, (m.role_id IS NOT NULL) DESC, m.joined_at ASC
     LIMIT 50`,
    [id, chat.owner_id]
  );

  const roles = (await query('SELECT id, name, color, permissions FROM gchat_roles WHERE chat_id=$1 ORDER BY id', [id])).rows;
  const subchats = (await query('SELECT id, name, icon, position FROM gchat_subchats WHERE chat_id=$1 ORDER BY position, id', [id])).rows;
  const pinned = (await query(
    `SELECT gp.message_id AS id FROM gchat_pins gp
     JOIN gchat_messages m ON m.id=gp.message_id AND m.deleted=false
     WHERE gp.chat_id=$1 AND gp.pinned=true ORDER BY gp.created_at DESC LIMIT 1`, [id]
  )).rows[0] || null;

  let myRequest = null;
  if (req.user && !member) {
    myRequest = (await query(
      `SELECT id, status, created_at FROM gchat_join_requests
       WHERE chat_id=$1 AND user_id=$2 AND status='pending' ORDER BY id DESC LIMIT 1`,
      [id, req.user.id]
    )).rows[0] || null;
    if (!myRequest) {
      const last = (await query(
        `SELECT created_at FROM gchat_join_requests WHERE chat_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1`,
        [id, req.user.id]
      )).rows[0] || null;
      if (last && Date.now() - new Date(last.created_at).getTime() < 24 * 3600 * 1000) {
        myRequest = { cooldown_until: new Date(new Date(last.created_at).getTime() + 24 * 3600 * 1000).toISOString() };
      }
    }
  }

  const ban = req.user ? await activeBan(id, req.user.id) : null;

  res.json({
    chat: {
      id: chat.id, kind: chat.kind, name: chat.name, photo: chat.photo,
      description: chat.description, desc_bg: chat.desc_bg, theme: chat.theme,
      msg_visibility: chat.msg_visibility, tags: chat.tags,
      personas_enabled: chat.personas_enabled, personas_approval: chat.personas_approval,
      personas_only: chat.personas_only, private_open: chat.private_open,
      announcement: chat.announcement || '',
      head_bg: chat.head_bg || null,
      owner_id: chat.owner_id,
      owner_username: members.find((m) => m.id === chat.owner_id)?.username || null,
      member_count: chat.member_count, messages_count: chat.messages_count,
      topic_id: chat.topic_id, created_at: chat.created_at,
      last_message_at: chat.last_message_at,
    },
    me: myMembership(chat, member, req.user),
    can_view_messages: canViewMessages,
    members, roles, subchats,
    pinned_message_id: pinned ? pinned.id : null,
    my_join_request: myRequest,
    my_ban: ban ? { kind: ban.kind, until: ban.until, reason: ban.reason } : null,
  });
}));
/** PATCH /api/gchats/:id — настройки чатса (право manage; приватный с private_open — все участники) */
router.patch('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  const canManage = hasPerm(chat, member, req.user, 'manage');
  const openEdit = chat.kind === 'private' && chat.private_open && !!member;

  if (!canManage && !openEdit) throw forbidden('Недостаточно прав для настройки чатса');

  const updates = {};
  if (req.body.name !== undefined) {
    updates.name = v.str(req.body.name, { label: 'Название', min: 2, max: 80 });
  }
  if (req.body.photo !== undefined) updates.photo = sanitizeIcon(req.body.photo);
  if (canManage) {
    if (req.body.description !== undefined) updates.description = JSON.stringify(sanitizeDescription(req.body.description));
    if (req.body.desc_bg !== undefined) updates.desc_bg = JSON.stringify(sanitizeDescBg(req.body.desc_bg));
    if (req.body.theme !== undefined) updates.theme = JSON.stringify(sanitizeChatTheme(req.body.theme));
    if (req.body.msg_visibility !== undefined) {
      updates.msg_visibility = v.oneOf(req.body.msg_visibility, ['members', 'everyone'], { label: 'Видимость сообщений' });
    }
    if (req.body.personas_enabled !== undefined) updates.personas_enabled = v.bool(req.body.personas_enabled);
    if (req.body.personas_approval !== undefined) updates.personas_approval = v.bool(req.body.personas_approval);
    if (req.body.personas_only !== undefined) updates.personas_only = v.bool(req.body.personas_only);
    if (req.body.private_open !== undefined && chat.kind === 'private') updates.private_open = v.bool(req.body.private_open);
    if (req.body.tags !== undefined) updates.tags = sanitizeTagsArr(req.body.tags);
    if (req.body.announcement !== undefined) {
      updates.announcement = v.str(req.body.announcement, { label: 'Сообщение для участников', max: 500, optional: true, def: '' });
    }
    if (req.body.head_bg !== undefined) {
      updates.head_bg = JSON.stringify(sanitizeDescBg(req.body.head_bg));
    }
  }
  if (!Object.keys(updates).length) throw bad('Нет полей для обновления');

  const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const params = [...Object.values(updates), id];
  const { rows } = await query(
    `UPDATE gchats SET ${sets}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params
  );
  // очистка заменённых изображений (фото, фоны, обои, картинки из описания)
  try {
    const collect = (c) => new Set([
      ...extractUploadUrls(c.photo),
      ...extractUploadUrls(c.description && c.description.html),
      c.desc_bg && c.desc_bg.url,
      c.head_bg && c.head_bg.url,
      c.theme && c.theme.bgImage,
      ...((c.theme && c.theme.fonts) || []).map((f) => f.url),
    ].filter(Boolean));
    const oldUrls = collect(chat);
    const newUrls = collect(rows[0]);
    for (const u of oldUrls) if (!newUrls.has(u)) await releaseUpload(u);
  } catch (e) { console.error('[gchats] release:', e.message); }
  res.json({ chat: rows[0] });
}));

/** DELETE /api/gchats/:id — удалить чатс (владелец или админ сайта) */
router.delete('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const isStaff = ['moderator', 'admin'].includes(req.user.role);
  if (chat.owner_id !== req.user.id && !isStaff) throw forbidden('Удалить чатс может только владелец');
  await query('DELETE FROM gchats WHERE id=$1', [id]);
  // освобождаем все изображения чатса
  try {
    const urls = new Set([
      ...extractUploadUrls(chat.photo),
      ...extractUploadUrls(chat.description && chat.description.html),
      chat.desc_bg && chat.desc_bg.url,
      chat.head_bg && chat.head_bg.url,
      chat.theme && chat.theme.bgImage,
      ...((chat.theme && chat.theme.fonts) || []).map((f) => f.url),
    ].filter(Boolean));
    for (const u of urls) await releaseUpload(u);
  } catch (e) { console.error('[gchats] delete release:', e.message); }
  res.json({ ok: true });
}));

/** POST /api/gchats/:id/topic — тема обсуждения «Чатс: <название>» на основном форуме */
router.post('/:id/topic', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'manage')) throw forbidden('Тему может создать владелец чатса');
  if (chat.topic_id) throw bad('Тема для этого чатса уже создана');
  if (chat.kind === 'private') throw bad('Для приватных чатов тема не создаётся');

  const cat = await query('SELECT id FROM categories ORDER BY (slug=\'general\') DESC, position ASC, id ASC LIMIT 1');
  if (!cat.rows[0]) throw bad('Нет категорий для создания темы');

  const { slugify } = require('../utils/helpers');
  const title = `Чатс: ${chat.name}`.slice(0, 200);
  const content = `Обсуждение чатса «${chat.name}».\n\nОткрыть чатс: #/chat/${chat.id}`;
  let slug = slugify(`chats-${chat.name}`);
  const dup = await query('SELECT id FROM topics WHERE slug=$1', [slug]);
  if (dup.rows.length) slug = `${slug}-${Date.now().toString(36)}`;

  const t = await query(
    `INSERT INTO topics (category_id, author_id, title, slug, content, post_count)
     VALUES ($1,$2,$3,$4,$5,1) RETURNING *`,
    [cat.rows[0].id, req.user.id, title, slug, content]
  );
  await query('UPDATE gchats SET topic_id=$1, updated_at=now() WHERE id=$2', [t.rows[0].id, id]);
  res.status(201).json({ topic: t.rows[0] });
}));
/* ================= ВСТУПЛЕНИЕ / ЗАЯВКИ ================= */

/** POST /api/gchats/:id/join — вступить (public) или подать заявку (request) */
router.post('/:id/join', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);

  if (member) throw bad('Вы уже состоите в этом чатсе');
  if (chat.kind === 'private') throw forbidden('Этот чатс только по приглашению');

  const ban = await activeBan(id, req.user.id);
  if (ban && ban.kind === 'ban') {
    throw forbidden(ban.until
      ? `Вы забанены в этом чатсе до ${new Date(ban.until).toLocaleString('ru-RU')}`
      : 'Вы забанены в этом чатсе навсегда');
  }

  if (chat.kind === 'public') {
    await withTransaction(async (client) => {
      await addMember(client, chat, req.user.id, req.user.username);
    });
    return res.json({ joined: true });
  }

  // kind === 'request'
  if (ban && ban.kind === 'requests_block') throw forbidden('Владелец запретил вам отправлять заявки в этот чатс');

  const { rows: last } = await query(
    `SELECT created_at FROM gchat_join_requests WHERE chat_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1`,
    [id, req.user.id]
  );
  if (last[0] && Date.now() - new Date(last[0].created_at).getTime() < 24 * 3600 * 1000) {
    throw bad('Заявку можно отправлять раз в сутки');
  }
  const { rows: pend } = await query(
    `SELECT id FROM gchat_join_requests WHERE chat_id=$1 AND user_id=$2 AND status='pending'`,
    [id, req.user.id]
  );
  if (pend[0]) throw bad('Ваша заявка уже на рассмотрении');

  const reqRow = await query(
    `INSERT INTO gchat_join_requests (chat_id, user_id) VALUES ($1,$2) RETURNING *`, [id, req.user.id]
  );

  // уведомляем тех, у кого есть право requests
  const { rows: reviewers } = await query(
    `SELECT u.id, u.username, u.role AS site_role, m.role, m.role_id, r.permissions
     FROM gchat_members m JOIN users u ON u.id=m.user_id
     LEFT JOIN gchat_roles r ON r.id=m.role_id
     WHERE m.chat_id=$1`, [id]
  );
  for (const rv of reviewers) {
    if (hasPerm(chat, rv, rv, 'requests')) {
      await notify(query, {
        userId: rv.id, type: 'chat_request', actorId: req.user.id,
        entityType: 'gchat', entityId: id,
        payload: { chat_name: chat.name, request_id: reqRow.rows[0].id },
      });
    }
  }
  res.status(201).json({ requested: true, request: reqRow.rows[0] });
}));

/** POST /api/gchats/:id/leave — покинуть чатс */
router.post('/:id/leave', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  if (chat.owner_id === req.user.id) throw bad('Владелец не может покинуть чатс (можно удалить его)');
  await withTransaction(async (client) => {
    await removeMember(client, chat, req.user.id, req.user.username);
  });
  res.json({ ok: true });
}));

/** GET /api/gchats/:id/requests — список заявок (право requests) */
router.get('/:id/requests', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'requests')) throw forbidden('Недостаточно прав');
  const { rows } = await query(
    `SELECT q.id, q.created_at, u.id AS user_id, u.username, u.avatar_url
     FROM gchat_join_requests q JOIN users u ON u.id=q.user_id
     WHERE q.chat_id=$1 AND q.status='pending' ORDER BY q.created_at ASC`,
    [id]
  );
  res.json({ items: rows });
}));
/** POST /api/gchats/:id/requests/:reqId — одобрить/отклонить заявку */
router.post('/:id/requests/:reqId', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const reqId = parseInt(req.params.reqId, 10);
  const chat = await loadChat(id);
  const reviewer = await loadMember(id, req.user.id);
  if (!hasPerm(chat, reviewer, req.user, 'requests')) throw forbidden('Недостаточно прав');

  const action = v.oneOf(req.body.action, ['approve', 'decline'], { label: 'Действие' });
  const { rows } = await query(
    `SELECT q.*, u.username FROM gchat_join_requests q JOIN users u ON u.id=q.user_id
     WHERE q.id=$1 AND q.chat_id=$2`, [reqId, id]
  );
  const jr = rows[0];
  if (!jr) throw notFound('Заявка не найдена');
  if (jr.status !== 'pending') throw bad('Заявка уже обработана');

  await query(
    `UPDATE gchat_join_requests SET status=$1, processed_by=$2, processed_at=now() WHERE id=$3`,
    [action === 'approve' ? 'approved' : 'declined', req.user.id, reqId]
  );
  await query(
    `UPDATE notifications SET read=true
     WHERE type='chat_request' AND entity_id=$1 AND payload->>'request_id'=$2`,
    [id, String(reqId)]
  );

  if (action === 'approve') {
    const m = await loadMember(id, jr.user_id);
    if (!m) {
      await withTransaction(async (client) => {
        await addMember(client, chat, jr.user_id, jr.username);
      });
    }
  }
  await notify(query, {
    userId: jr.user_id, type: action === 'approve' ? 'chat_approved' : 'chat_declined',
    actorId: req.user.id, entityType: 'gchat', entityId: id,
    payload: { chat_name: chat.name },
  });
  res.json({ ok: true });
}));

/** POST /api/gchats/:id/invite — пригласить по никнейму */
router.post('/:id/invite', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'invite') && !(chat.kind === 'private' && member)) {
    throw forbidden('Недостаточно прав для приглашения');
  }
  const username = v.str(req.body.username, { label: 'Никнейм', min: 2, max: 32 });
  const { rows } = await query('SELECT id, username FROM users WHERE lower(username)=lower($1)', [username]);
  const invitee = rows[0];
  if (!invitee) throw notFound('Пользователь не найден');
  if (invitee.id === req.user.id) throw bad('Нельзя пригласить самого себя');

  if (await loadMember(id, invitee.id)) throw bad('Пользователь уже участник чатса');
  const ban = await activeBan(id, invitee.id);
  if (ban && ban.kind === 'ban') throw bad('Пользователь забанен в этом чатсе');

  const dup = await query(
    `SELECT id FROM gchat_invites WHERE chat_id=$1 AND invitee_id=$2 AND status='pending'`, [id, invitee.id]
  );
  if (dup.rows[0]) throw bad('Приглашение уже отправлено');

  const inv = await query(
    `INSERT INTO gchat_invites (chat_id, inviter_id, invitee_id) VALUES ($1,$2,$3) RETURNING *`,
    [id, req.user.id, invitee.id]
  );
  await notify(query, {
    userId: invitee.id, type: 'chat_invite', actorId: req.user.id,
    entityType: 'gchat', entityId: id,
    payload: { invite_id: inv.rows[0].id, chat_name: chat.name },
  });
  res.status(201).json({ invited: true });
}));

/** GET /api/gchats/invites — мои приглашения */
router.get('/invites', requireAuth, asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.created_at, c.id AS chat_id, c.name AS chat_name, c.photo AS chat_photo, c.kind,
            ou.username AS inviter_username
     FROM gchat_invites i
     JOIN gchats c ON c.id=i.chat_id
     JOIN users ou ON ou.id=i.inviter_id
     WHERE i.invitee_id=$1 AND i.status='pending' ORDER BY i.created_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows });
}));

/** POST /api/gchats/invites/:id — принять/отклонить приглашение */
router.post('/invites/:id', requireAuth, asyncH(async (req, res) => {
  const invId = parseInt(req.params.id, 10);
  const action = v.oneOf(req.body.action, ['accept', 'decline'], { label: 'Действие' });
  const { rows } = await query(
    `SELECT i.*, c.name AS chat_name, c.kind FROM gchat_invites i JOIN gchats c ON c.id=i.chat_id
     WHERE i.id=$1 AND i.invitee_id=$2`, [invId, req.user.id]
  );
  const inv = rows[0];
  if (!inv) throw notFound('Приглашение не найдено');
  if (inv.status !== 'pending') throw bad('Приглашение уже обработано');

  await query(`UPDATE gchat_invites SET status=$1 WHERE id=$2`, [action === 'accept' ? 'accepted' : 'declined', invId]);
  if (action === 'accept') {
    const chat = await loadChat(inv.chat_id);
    const m = await loadMember(chat.id, req.user.id);
    if (!m) {
      await withTransaction(async (client) => {
        await addMember(client, chat, req.user.id, req.user.username);
      });
    }
  }
  await notify(query, {
    userId: inv.inviter_id, type: action === 'accept' ? 'chat_invite_accepted' : 'chat_invite_declined',
    actorId: req.user.id, entityType: 'gchat', entityId: inv.chat_id,
    payload: { chat_name: inv.chat_name },
  });
  res.json({ ok: true, joined: action === 'accept' });
}));
/* ================= УЧАСТНИКИ / БАНЫ / МУТ ================= */

/** GET /api/gchats/:id/members — участники с онлайн-статусом */
router.get('/:id/members', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (chat.kind === 'private' && !member && !['moderator', 'admin'].includes(req.user.role)) {
    throw notFound('Чатс не найден');
  }
  const { rows } = await query(
    `SELECT u.id, u.username, u.avatar_url, u.role AS site_role, m.role, m.role_id,
            r.name AS role_name, r.color AS role_color,
            ${SELECT_ONLINE_SQL()} AS online, m.muted_until, m.joined_at
     FROM gchat_members m JOIN users u ON u.id=m.user_id
     LEFT JOIN gchat_roles r ON r.id=m.role_id
     WHERE m.chat_id=$1
     ORDER BY (u.id=$2) DESC, (m.role='curator') DESC, (m.role_id IS NOT NULL) DESC, m.joined_at ASC
     LIMIT 200`,
    [id, chat.owner_id]
  );
  res.json({ items: rows });
}));

/** DELETE /api/gchats/:id/members/:userId — выгнать участника */
router.delete('/:id/members/:userId', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const uid = parseInt(req.params.userId, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'kick')) throw forbidden('Недостаточно прав');
  if (uid === chat.owner_id) throw bad('Нельзя выгнать владельца');
  const victim = await loadMember(id, uid);
  if (!victim) throw notFound('Участник не найден');
  const { rows: vu } = await query('SELECT username FROM users WHERE id=$1', [uid]);
  await withTransaction(async (client) => {
    await removeMember(client, chat, uid, vu[0].username, false);
  });
  await notify(query, {
    userId: uid, type: 'chat_kicked', actorId: req.user.id,
    entityType: 'gchat', entityId: id, payload: { chat_name: chat.name },
  });
  res.json({ ok: true });
}));

/** POST /api/gchats/:id/members/:userId/role — назначить роль/куратора/участника */
router.post('/:id/members/:userId/role', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const uid = parseInt(req.params.userId, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'roles')) throw forbidden('Недостаточно прав');
  if (uid === chat.owner_id) throw bad('Владелец уже главный');
  const target = await loadMember(id, uid);
  if (!target) throw notFound('Участник не найден');

  const newRole = v.oneOf(req.body.role, ['member', 'curator'], { label: 'Роль', optional: true });
  const roleId = req.body.role_id !== undefined && req.body.role_id !== null
    ? v.int(req.body.role_id, { label: 'ID роли', min: 1 }) : null;

  if (roleId !== null) {
    const { rows } = await query('SELECT id FROM gchat_roles WHERE id=$1 AND chat_id=$2', [roleId, id]);
    if (!rows[0]) throw notFound('Роль не найдена в этом чатсе');
    await query('UPDATE gchat_members SET role=\'member\', role_id=$1 WHERE chat_id=$2 AND user_id=$3', [roleId, id, uid]);
  } else {
    await query('UPDATE gchat_members SET role=$1, role_id=NULL WHERE chat_id=$2 AND user_id=$3', [newRole, id, uid]);
  }
  res.json({ ok: true });
}));
/** POST /api/gchats/:id/ban — забанить (или запретить заявки) */
router.post('/:id/ban', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'ban')) throw forbidden('Недостаточно прав');
  const uid = v.int(req.body.user_id, { label: 'Пользователь', min: 1 });
  if (uid === chat.owner_id) throw bad('Нельзя забанить владельца');
  const kind = v.oneOf(req.body.kind, ['ban', 'requests_block'], { label: 'Тип', optional: true, def: 'ban' });
  const days = req.body.days ? v.int(req.body.days, { label: 'Дни', min: 1, max: 3650 }) : null;
  const reason = v.str(req.body.reason, { label: 'Причина', max: 300, optional: true, def: '' });

  const { rows: tu } = await query('SELECT username FROM users WHERE id=$1', [uid]);
  if (!tu[0]) throw notFound('Пользователь не найден');
  const target = await loadMember(id, uid);

  if (kind === 'ban' && target) {
    await withTransaction(async (client) => {
      await removeMember(client, chat, uid, tu[0].username, false);
    });
  }
  const until = days ? new Date(Date.now() + days * 86400000) : null;
  await query(
    `INSERT INTO gchat_bans (chat_id, user_id, kind, until, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, uid, kind, until, reason, req.user.id]
  );
  await notify(query, {
    userId: uid, type: kind === 'ban' ? 'chat_banned' : 'chat_requests_blocked',
    actorId: req.user.id, entityType: 'gchat', entityId: id,
    payload: { chat_name: chat.name, reason, until: until ? until.toISOString() : null },
  });
  res.json({ ok: true });
}));

/** POST /api/gchats/:id/unban — разбанить / разрешить заявки */
router.post('/:id/unban', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'ban')) throw forbidden('Недостаточно прав');
  const uid = v.int(req.body.user_id, { label: 'Пользователь', min: 1 });
  await query(`UPDATE gchat_bans SET active=false WHERE chat_id=$1 AND user_id=$2 AND active=true`, [id, uid]);
  res.json({ ok: true });
}));

/** GET /api/gchats/:id/bans — список банов */
router.get('/:id/bans', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'ban')) throw forbidden('Недостаточно прав');
  const { rows } = await query(
    `SELECT b.*, u.username, mb.username AS banned_by_username
     FROM gchat_bans b
     JOIN users u ON u.id=b.user_id
     LEFT JOIN users mb ON mb.id=b.created_by
     WHERE b.chat_id=$1 AND b.active=true ORDER BY b.created_at DESC`,
    [id]
  );
  res.json({ items: rows });
}));

/** POST /api/gchats/:id/mute — заглушить участника */
router.post('/:id/mute', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'mute')) throw forbidden('Недостаточно прав');
  const uid = v.int(req.body.user_id, { label: 'Пользователь', min: 1 });
  if (uid === chat.owner_id) throw bad('Нельзя заглушить владельца');
  const minutes = v.int(req.body.minutes, { label: 'Минуты', min: 1, max: 43200 });
  const target = await loadMember(id, uid);
  if (!target) throw notFound('Участник не найден');
  await query(
    `UPDATE gchat_members SET muted_until=now() + ($1 || ' minutes')::interval WHERE chat_id=$2 AND user_id=$3`,
    [String(minutes), id, uid]
  );
  res.json({ ok: true, muted_until: new Date(Date.now() + minutes * 60000).toISOString() });
}));

/** POST /api/gchats/:id/unmute — снять мут */
router.post('/:id/unmute', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'mute')) throw forbidden('Недостаточно прав');
  const uid = v.int(req.body.user_id, { label: 'Пользователь', min: 1 });
  await query(`UPDATE gchat_members SET muted_until=NULL WHERE chat_id=$1 AND user_id=$2`, [id, uid]);
  res.json({ ok: true });
}));
/* ================= РОЛИ ================= */

/** GET /api/gchats/:id/roles */
router.get('/:id/roles', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!member && !['moderator', 'admin'].includes(req.user.role)) throw forbidden('Только для участников');
  const { rows } = await query(
    `SELECT r.id, r.name, r.color, r.permissions,
            (SELECT COUNT(*)::int FROM gchat_members m WHERE m.role_id=r.id) AS members_count
     FROM gchat_roles r WHERE r.chat_id=$1 ORDER BY r.id`,
    [id]
  );
  res.json({ items: rows, perms_available: PERMS });
}));

/** POST /api/gchats/:id/roles — создать роль (макс. 5) */
router.post('/:id/roles', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'roles')) throw forbidden('Недостаточно прав');
  const { rows: cnt } = await query('SELECT COUNT(*)::int AS n FROM gchat_roles WHERE chat_id=$1', [id]);
  if (cnt[0].n >= 5) throw bad('Максимум 5 кастомных ролей на чатс');
  const name = v.str(req.body.name, { label: 'Название роли', min: 1, max: 40 });
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions.filter((p) => PERMS.includes(p)) : [];
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : null;
  const { rows } = await query(
    'INSERT INTO gchat_roles (chat_id, name, color, permissions) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, name, color, perms]
  );
  res.status(201).json({ role: rows[0] });
}));

/** PATCH /api/gchats/:id/roles/:roleId — изменить роль */
router.patch('/:id/roles/:roleId', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'roles')) throw forbidden('Недостаточно прав');
  const rid = parseInt(req.params.roleId, 10);
  const { rows: cur } = await query('SELECT * FROM gchat_roles WHERE id=$1 AND chat_id=$2', [rid, id]);
  if (!cur[0]) throw notFound('Роль не найдена');
  const updates = {};
  if (req.body.name !== undefined) updates.name = v.str(req.body.name, { label: 'Название роли', min: 1, max: 40 });
  if (req.body.color !== undefined) updates.color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : null;
  if (req.body.permissions !== undefined) {
    updates.permissions = Array.isArray(req.body.permissions) ? req.body.permissions.filter((p) => PERMS.includes(p)) : [];
  }
  if (!Object.keys(updates).length) throw bad('Нет полей для обновления');
  const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const { rows } = await query(
    `UPDATE gchat_roles SET ${sets} WHERE id=$${Object.keys(updates).length + 1} RETURNING *`,
    [...Object.values(updates), rid]
  );
  res.json({ role: rows[0] });
}));

/** DELETE /api/gchats/:id/roles/:roleId — удалить роль */
router.delete('/:id/roles/:roleId', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'roles')) throw forbidden('Недостаточно прав');
  const rid = parseInt(req.params.roleId, 10);
  await query('UPDATE gchat_members SET role_id=NULL WHERE role_id=$1', [rid]);
  await query('DELETE FROM gchat_roles WHERE id=$1 AND chat_id=$2', [rid, id]);
  res.json({ ok: true });
}));
/* ================= СООБЩЕНИЯ ================= */

/** Разрешить просмотр сообщений? */
async function assertCanRead(chat, member, user) {
  if (member) return;
  const isStaff = user && ['moderator', 'admin'].includes(user.role);
  if (chat.msg_visibility === 'everyone' || isStaff) return;
  throw forbidden('Сообщения чатса доступны только участникам');
}

/** GET /api/gchats/:id/messages?after_id=&subchat_id=&limit= */
router.get('/:id/messages', optionalAuth, asyncH(async (req, res) => {
  if (!req.user) throw forbidden('Войдите, чтобы смотреть чатс', { unauthorized: true });
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  await assertCanRead(chat, member, req.user);

  const subchatId = req.query.subchat_id ? parseInt(req.query.subchat_id, 10) : null;
  const afterId = req.query.after_id ? parseInt(req.query.after_id, 10) : null;
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 60));

  const conds = ['m.chat_id=$1', 'm.deleted=false'];
  const params = [id];
  if (subchatId) { params.push(subchatId); conds.push(`m.subchat_id=$${params.length}`); }
  else conds.push('m.subchat_id IS NULL');
  if (afterId) { params.push(afterId); conds.push(`m.id > $${params.length}`); }
  const where = conds.join(' AND ');

  const { rows } = await query(
    `SELECT m.id, m.chat_id, m.subchat_id, m.kind, m.content, m.image_url, m.reply_to_id,
            m.mentioned_ids, m.created_at, m.updated_at,
            m.sender_id, su.username AS sender_username, su.avatar_url AS sender_avatar,
            su.role AS sender_site_role,
            p.id AS persona_id, p.name AS persona_name, p.avatar_url AS persona_avatar,
            p.visibility AS persona_visibility, p.owner_id AS persona_owner_id,
            pu.username AS persona_owner_username, pu.avatar_url AS persona_owner_avatar,
            r.id AS reply_id, r.content AS reply_content, r.kind AS reply_kind,
            ru.username AS reply_username
     FROM gchat_messages m
     LEFT JOIN users su ON su.id=m.sender_id
     LEFT JOIN gchat_personas p ON p.id=m.persona_id
     LEFT JOIN users pu ON pu.id=p.owner_id
     LEFT JOIN gchat_messages r ON r.id=m.reply_to_id
     LEFT JOIN users ru ON ru.id=r.sender_id
     WHERE ${where}
     ORDER BY m.id DESC LIMIT ${limit}`,
    params
  );
  rows.reverse();

  // скрытие сообщений игнорируемых пользователей
  const { rows: ign } = await query('SELECT ignored_id FROM gchat_ignores WHERE user_id=$1', [req.user.id]);
  const ignored = new Set(ign.map((i) => i.ignored_id));

  const canSeeAuthors = member
    ? hasPerm(chat, member, req.user, 'personas') || hasPerm(chat, member, req.user, 'ban')
    : ['moderator', 'admin'].includes(req.user.role);

  const items = rows.map((m) => {
    const hidden = m.sender_id && ignored.has(m.sender_id) && m.kind === 'user';
    return {
      id: m.id, chat_id: m.chat_id, subchat_id: m.subchat_id, kind: m.kind,
      content: hidden ? null : m.content,
      image_url: hidden ? null : m.image_url,
      hidden,
      mentioned_ids: m.mentioned_ids,
      reply_to_id: m.reply_to_id,
      reply_preview: m.reply_to_id ? {
        id: m.reply_id,
        first_line: String(m.reply_content || '').split('\n')[0].slice(0, 120),
        username: m.reply_username, kind: m.reply_kind,
      } : null,
      created_at: m.created_at, updated_at: m.updated_at,
      sender_id: m.sender_id,
      sender_username: m.sender_username,
      sender_avatar: m.sender_avatar,
      sender_site_role: m.sender_site_role,
      persona: m.persona_id ? {
        id: m.persona_id, name: m.persona_name, avatar_url: m.persona_avatar,
        visibility: m.persona_visibility,
        owner_id: (m.persona_visibility === 'public' || canSeeAuthors || m.persona_owner_id === req.user.id)
          ? m.persona_owner_id : null,
        owner_username: (m.persona_visibility === 'public' || canSeeAuthors || m.persona_owner_id === req.user.id)
          ? m.persona_owner_username : null,
      } : null,
      mine: m.sender_id === req.user.id,
    };
  });

  const typing = getTyping(id, subchatId, req.user.id);

  if (member) {
    await query('UPDATE gchat_members SET last_read_at=now() WHERE chat_id=$1 AND user_id=$2', [id, req.user.id]);
  }

  res.json({ items, typing });
}));
/** POST /api/gchats/:id/messages — отправить сообщение */
router.post('/:id/messages', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!member) throw forbidden('Только участники могут писать в чатс');
  if (member.muted_until && new Date(member.muted_until) > new Date()) {
    throw forbidden(`Вы заглушены до ${new Date(member.muted_until).toLocaleString('ru-RU')}`);
  }

  const content = v.str(req.body.content, { label: 'Сообщение', min: 1, max: 4000 });
  let imageUrl = null;
  if (req.body.image_url) {
    const { sanitizeImageUrl } = require('../utils/post-utils');
    imageUrl = sanitizeImageUrl(req.body.image_url);
    if (!imageUrl) throw bad('Некорректная ссылка на изображение');
  }

  // подчатс
  let subchatId = null;
  if (req.body.subchat_id) {
    subchatId = v.int(req.body.subchat_id, { label: 'Подчатс', min: 1 });
    const { rows: sc } = await query('SELECT id FROM gchat_subchats WHERE id=$1 AND chat_id=$2', [subchatId, id]);
    if (!sc[0]) throw notFound('Подчатс не найден');
  }

  // персона
  let personaId = null;
  if (req.body.persona_id) {
    personaId = v.int(req.body.persona_id, { label: 'Персона', min: 1 });
    const { rows: prs } = await query(
      `SELECT * FROM gchat_personas WHERE id=$1 AND chat_id=$2 AND owner_id=$3`,
      [personaId, id, req.user.id]
    );
    if (!prs[0]) throw forbidden('Это не ваша персона или она не существует');
    if (prs[0].status !== 'approved') throw bad('Персона ещё не одобрена');
  }
  if (chat.personas_only && !personaId) {
    throw bad('В этом чатсе можно писать только от лица персон');
  }

  // ответ
  let replyToId = null;
  if (req.body.reply_to_id) {
    replyToId = v.int(req.body.reply_to_id, { label: 'Ответ на', min: 1 });
    const { rows: rr } = await query('SELECT id FROM gchat_messages WHERE id=$1 AND chat_id=$2', [replyToId, id]);
    if (!rr[0]) throw notFound('Сообщение для ответа не найдено');
  }

  // упоминания
  const mentionNames = extractMentions(content);
  let mentionedIds = [];
  if (mentionNames.length) {
    const { rows: mu } = await query(
      `SELECT id, username FROM users WHERE lower(username) = ANY($1::text[])`,
      [mentionNames]
    );
    mentionedIds = mu.filter((u) => u.id !== req.user.id).map((u) => u.id);
  }

  const { rows } = await query(
    `INSERT INTO gchat_messages (chat_id, sender_id, persona_id, subchat_id, content, image_url, reply_to_id, mentioned_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, req.user.id, personaId, subchatId, content, imageUrl, replyToId, mentionedIds]
  );
  const msg = rows[0];
  await query('UPDATE gchats SET last_message_at=now(), messages_count=messages_count+1 WHERE id=$1', [id]);
  await query('UPDATE gchat_members SET last_read_at=now() WHERE chat_id=$1 AND user_id=$2', [id, req.user.id]);

  // уведомления об упоминаниях (агрегируем непрочитанные от одного автора)
  if (mentionedIds.length) {
    for (const uid of mentionedIds) {
      const { rows: exist } = await query(
        `SELECT id, payload FROM notifications
         WHERE user_id=$1 AND type='mention' AND entity_type='gchat' AND entity_id=$2 AND read=false AND actor_id=$3
         LIMIT 1`,
        [uid, id, req.user.id]
      );
      if (exist[0]) {
        const cnt = ((exist[0].payload || {}).count || 1) + 1;
        await query(`UPDATE notifications SET payload=JSONB_SET(payload, '{count}', $1::jsonb) WHERE id=$2`,
          [JSON.stringify(cnt), exist[0].id]);
      } else {
        await notify(query, {
          userId: uid, type: 'mention', actorId: req.user.id,
          entityType: 'gchat', entityId: id,
          payload: { chat_name: chat.name, count: 1, preview: String(content).slice(0, 80) },
        });
      }
    }
  }

  res.status(201).json({ message: msg });
}));

/** POST /api/gchats/:id/typing — «я печатаю» */
router.post('/:id/typing', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!member) throw forbidden('Только участники');
  const subchatId = req.body.subchat_id ? parseInt(req.body.subchat_id, 10) : 0;
  setTyping(id, subchatId, req.user.id, req.user.username);
  res.json({ ok: true });
}));
/** PATCH /api/gchats/:id/messages/:mid — редактировать своё сообщение */
router.patch('/:id/messages/:mid', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const mid = parseInt(req.params.mid, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!member) throw forbidden('Только участники');
  const { rows } = await query('SELECT * FROM gchat_messages WHERE id=$1 AND chat_id=$2', [mid, id]);
  const msg = rows[0];
  if (!msg || msg.kind !== 'user') throw notFound('Сообщение не найдено');
  if (msg.sender_id !== req.user.id) throw forbidden('Можно редактировать только свои сообщения');

  const content = v.str(req.body.content, { label: 'Сообщение', min: 1, max: 4000 });
  const { rows: upd } = await query(
    'UPDATE gchat_messages SET content=$1, updated_at=now() WHERE id=$2 RETURNING *', [content, mid]
  );
  res.json({ message: upd[0] });
}));

/** DELETE /api/gchats/:id/messages/:mid — удалить сообщение (своё или с правом moderate) */
router.delete('/:id/messages/:mid', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const mid = parseInt(req.params.mid, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!member) throw forbidden('Только участники');
  const { rows } = await query('SELECT * FROM gchat_messages WHERE id=$1 AND chat_id=$2', [mid, id]);
  const msg = rows[0];
  if (!msg) throw notFound('Сообщение не найдено');
  if (msg.sender_id !== req.user.id && !hasPerm(chat, member, req.user, 'moderate')) {
    throw forbidden('Недостаточно прав для удаления чужих сообщений');
  }
  await query('UPDATE gchat_messages SET deleted=true, updated_at=now() WHERE id=$1', [mid]);
  // фото из удалённого сообщения больше не нужно
  if (msg.image_url) await releaseUpload(msg.image_url);
  res.json({ ok: true });
}));

/** POST /api/gchats/:id/messages/:mid/pin — закрепить/открепить (право pin) */
router.post('/:id/messages/:mid/pin', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const mid = parseInt(req.params.mid, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'pin')) throw forbidden('Недостаточно прав');
  const { rows: cur } = await query(
    `SELECT id, pinned FROM gchat_pins WHERE chat_id=$1 AND message_id=$2`, [id, mid]
  );
  const { rows: msg } = await query('SELECT id, content FROM gchat_messages WHERE id=$1 AND chat_id=$2 AND deleted=false', [mid, id]);
  if (!msg[0]) throw notFound('Сообщение не найдено');
  const isPinned = req.body.pinned !== undefined ? v.bool(req.body.pinned, true) : !(cur[0] && cur[0].pinned);

  await query(
    `INSERT INTO gchat_pins (chat_id, message_id, pinned) VALUES ($1,$2,$3)
     ON CONFLICT (chat_id, message_id) DO UPDATE SET pinned=$3, created_at=now()`,
    [id, mid, isPinned]
  );
  await query(
    `INSERT INTO gchat_messages (chat_id, kind, content) VALUES ($1,'system',$2)`,
    [id, (isPinned ? PIN_PHRASES.pinned : PIN_PHRASES.unpinned).replace('{u}', req.user.username)]
  );
  await query('UPDATE gchats SET last_message_at=now() WHERE id=$1', [id]);
  res.json({ ok: true, pinned: isPinned });
}));

/** GET /api/gchats/:id/pinned?q= — все закреплённые; поиск по @автору или ключевым словам */
router.get('/:id/pinned', optionalAuth, asyncH(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user?.id);
  const isStaff = req.user && ['moderator', 'admin'].includes(req.user.role);
  if (!member && chat.msg_visibility !== 'everyone' && !isStaff) {
    return res.json({ items: [] });
  }
  const q = String(req.query.q || '').trim().replace(/^@/, '');
  const conds = ['gp.chat_id=$1', 'gp.pinned=true', 'm.deleted=false'];
  const params = [id];
  if (q) {
    params.push(`%${q}%`);
    conds.push(`(u.username ILIKE $${params.length} OR m.content ILIKE $${params.length} OR p.name ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `SELECT gp.message_id, gp.created_at AS pinned_at, m.content, m.image_url, m.created_at,
            u.username AS sender_username, u.avatar_url AS sender_avatar,
            p.name AS persona_name, p.avatar_url AS persona_avatar
     FROM gchat_pins gp
     JOIN gchat_messages m ON m.id=gp.message_id
     LEFT JOIN users u ON u.id=m.sender_id
     LEFT JOIN gchat_personas p ON p.id=m.persona_id
     WHERE ${conds.join(' AND ')}
     ORDER BY gp.created_at DESC
     LIMIT 300`,
    params
  );
  res.json({ items: rows });
}));

/** DELETE /api/gchats/:id/messages — очистить все сообщения (право pin) */
router.delete('/:id/messages', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'pin')) throw forbidden('Недостаточно прав');
  // собираем фото до удаления — освободим файлы
  const { rows: imgs } = await query('SELECT image_url FROM gchat_messages WHERE chat_id=$1 AND image_url IS NOT NULL', [id]);
  await query('DELETE FROM gchat_messages WHERE chat_id=$1', [id]);
  await query('DELETE FROM gchat_pins WHERE chat_id=$1', [id]);
  for (const r of imgs) await releaseUpload(r.image_url);
  await query(
    `INSERT INTO gchat_messages (chat_id, kind, content) VALUES ($1,'system',$2)`,
    [id, PIN_PHRASES.cleared.replace('{u}', req.user.username)]
  );
  await query('UPDATE gchats SET messages_count=0, last_message_at=now() WHERE id=$1', [id]);
  res.json({ ok: true });
}));
/* ================= ПЕРСОНЫ ================= */

/** GET /api/gchats/:id/personas — мои + одобренные (с автором по видимости) */
router.get('/:id/personas', optionalAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user?.id);
  if (chat.kind === 'private' && !member) throw notFound('Чатс не найден');
  if (!chat.personas_enabled) return res.json({ items: [], enabled: false });

  const canSeeAuthors = member
    ? hasPerm(chat, member, req.user, 'personas') || hasPerm(chat, member, req.user, 'ban')
    : req.user && ['moderator', 'admin'].includes(req.user.role);

  const { rows } = await query(
    `SELECT p.*, u.username AS owner_username, u.avatar_url AS owner_avatar
     FROM gchat_personas p JOIN users u ON u.id=p.owner_id
     WHERE p.chat_id=$1 AND (p.status='approved' OR p.owner_id=$2 OR $3)
     ORDER BY p.created_at ASC`,
    [id, req.user ? req.user.id : 0, !!canSeeAuthors]
  );
  const canSee = (p) => p.visibility === 'public' || canSeeAuthors || (req.user && p.owner_id === req.user.id);
  const items = rows.map((p) => ({
    id: p.id, name: p.name, avatar_url: p.avatar_url, bio: p.bio,
    visibility: p.visibility, status: p.status, owner_id: p.owner_id,
    mine: !!(req.user && p.owner_id === req.user.id),
    owner_username: canSee(p) ? p.owner_username : null,
    owner_avatar: canSee(p) ? p.owner_avatar : null,
  }));
  res.json({ items, enabled: true, require_approval: chat.personas_approval });
}));

/** POST /api/gchats/:id/personas — создать персону (макс. 5 на пользователя) */
router.post('/:id/personas', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!member) throw forbidden('Только участники могут создавать персон');
  if (!chat.personas_enabled) throw bad('В этом чатсе персоны отключены');

  const { rows: cnt } = await query(
    'SELECT COUNT(*)::int AS n FROM gchat_personas WHERE chat_id=$1 AND owner_id=$2', [id, req.user.id]
  );
  if (cnt[0].n >= 5) throw bad('Максимум 5 персон на пользователя в чатсе');

  const name = v.str(req.body.name, { label: 'Имя персоны', min: 1, max: 48 });
  const bio = v.str(req.body.bio, { label: 'Описание', max: 500, optional: true, def: '' });
  const visibility = v.oneOf(req.body.visibility, ['public', 'anonymous'], { label: 'Вид персоны', optional: true, def: 'public' });
  const { sanitizeImageUrl } = require('../utils/post-utils');
  const avatarUrl = req.body.avatar_url ? sanitizeImageUrl(req.body.avatar_url) : null;

  const status = (chat.personas_approval && !hasPerm(chat, member, req.user, 'personas')
    && chat.owner_id !== req.user.id) ? 'pending' : 'approved';
  const { rows } = await query(
    `INSERT INTO gchat_personas (chat_id, owner_id, name, avatar_url, bio, visibility, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, req.user.id, name, avatarUrl, bio, visibility, status]
  );

  if (status === 'pending') {
    const { rows: reviewers } = await query(
      `SELECT u.id, u.role AS site_role, m.role, m.role_id, r.permissions
       FROM gchat_members m JOIN users u ON u.id=m.user_id
       LEFT JOIN gchat_roles r ON r.id=m.role_id
       WHERE m.chat_id=$1`, [id]
    );
    for (const rv of reviewers) {
      if (hasPerm(chat, rv, rv, 'personas')) {
        await notify(query, {
          userId: rv.id, type: 'persona_request', actorId: req.user.id,
          entityType: 'gchat', entityId: id,
          payload: { chat_name: chat.name, persona_id: rows[0].id, persona_name: name },
        });
      }
    }
  }
  res.status(201).json({ persona: rows[0] });
}));
/** POST /api/gchats/:id/personas/:pid/review — одобрить/отклонить персону */
router.post('/:id/personas/:pid/review', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pid = parseInt(req.params.pid, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'personas')) throw forbidden('Недостаточно прав');
  const action = v.oneOf(req.body.action, ['approve', 'decline'], { label: 'Действие' });
  const { rows } = await query(
    `UPDATE gchat_personas SET status=$1 WHERE id=$2 AND chat_id=$3 RETURNING *`,
    [action === 'approve' ? 'approved' : 'declined', pid, id]
  );
  const p = rows[0];
  if (!p) throw notFound('Персона не найдена');
  await query(
    `UPDATE notifications SET read=true WHERE type='persona_request' AND entity_id=$1 AND payload->>'persona_id'=$2`,
    [id, String(pid)]
  );
  await notify(query, {
    userId: p.owner_id, type: action === 'approve' ? 'persona_approved' : 'persona_declined',
    actorId: req.user.id, entityType: 'gchat', entityId: id,
    payload: { chat_name: chat.name, persona_name: p.name },
  });
  res.json({ ok: true });
}));

/** PATCH /api/gchats/:id/personas/:pid — редактировать свою персону */
router.patch('/:id/personas/:pid', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pid = parseInt(req.params.pid, 10);
  const { rows: cur } = await query('SELECT * FROM gchat_personas WHERE id=$1 AND chat_id=$2', [pid, id]);
  const p = cur[0];
  if (!p) throw notFound('Персона не найдена');
  if (p.owner_id !== req.user.id) throw forbidden('Это не ваша персона');
  const updates = {};
  if (req.body.name !== undefined) updates.name = v.str(req.body.name, { label: 'Имя персоны', min: 1, max: 48 });
  if (req.body.bio !== undefined) updates.bio = v.str(req.body.bio, { label: 'Описание', max: 500, optional: true, def: '' });
  if (req.body.visibility !== undefined) {
    updates.visibility = v.oneOf(req.body.visibility, ['public', 'anonymous'], { label: 'Вид персоны' });
  }
  if (req.body.avatar_url !== undefined) {
    const { sanitizeImageUrl } = require('../utils/post-utils');
    updates.avatar_url = req.body.avatar_url ? sanitizeImageUrl(req.body.avatar_url) : null;
  }
  if (!Object.keys(updates).length) throw bad('Нет полей для обновления');
  const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const { rows } = await query(
    `UPDATE gchat_personas SET ${sets} WHERE id=$${Object.keys(updates).length + 1} RETURNING *`,
    [...Object.values(updates), pid]
  );
  res.json({ persona: rows[0] });
}));

/** DELETE /api/gchats/:id/personas/:pid — удалить персону (свою или с правом personas) */
router.delete('/:id/personas/:pid', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pid = parseInt(req.params.pid, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  const { rows: cur } = await query('SELECT * FROM gchat_personas WHERE id=$1 AND chat_id=$2', [pid, id]);
  const p = cur[0];
  if (!p) throw notFound('Персона не найдена');
  if (p.owner_id !== req.user.id && !hasPerm(chat, member, req.user, 'personas')) {
    throw forbidden('Недостаточно прав');
  }
  await query('DELETE FROM gchat_personas WHERE id=$1', [pid]);
  res.json({ ok: true });
}));
/* ================= ПОДЧАТСЫ ================= */

/** POST /api/gchats/:id/subchats — создать подчатс (макс. 5) */
router.post('/:id/subchats', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'manage')) throw forbidden('Недостаточно прав');
  const { rows: cnt } = await query('SELECT COUNT(*)::int AS n FROM gchat_subchats WHERE chat_id=$1', [id]);
  if (cnt[0].n >= 5) throw bad('Максимум 5 подчатсов');
  const name = v.str(req.body.name, { label: 'Название подчатса', min: 1, max: 80 });
  const { rows } = await query(
    'INSERT INTO gchat_subchats (chat_id, name, icon, position) VALUES ($1,$2,$3,$4) RETURNING *',
    [id, name, sanitizeIcon(req.body.icon), cnt[0].n]
  );
  res.status(201).json({ subchat: rows[0] });
}));

/** DELETE /api/gchats/:id/subchats/:sid — удалить подчатс */
router.delete('/:id/subchats/:sid', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const sid = parseInt(req.params.sid, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user.id);
  if (!hasPerm(chat, member, req.user, 'manage')) throw forbidden('Недостаточно прав');
  await query('DELETE FROM gchat_subchats WHERE id=$1 AND chat_id=$2', [sid, id]);
  res.json({ ok: true });
}));

/* ================= ИГНОР ================= */

/** GET /api/gchats/ignored — список игнорируемых */
router.get('/ignored', requireAuth, asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.avatar_url FROM gchat_ignores i JOIN users u ON u.id=i.ignored_id
     WHERE i.user_id=$1 ORDER BY u.username`,
    [req.user.id]
  );
  res.json({ items: rows });
}));

/** POST /api/gchats/ignore — игнорировать/перестать игнорировать пользователя в чатсах */
router.post('/ignore', requireAuth, asyncH(async (req, res) => {
  const uid = v.int(req.body.user_id, { label: 'Пользователь', min: 1 });
  const ignored = v.bool(req.body.ignored, true);
  if (uid === req.user.id) throw bad('Нельзя игнорировать себя');
  if (ignored) {
    await query('INSERT INTO gchat_ignores (user_id, ignored_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, uid]);
  } else {
    await query('DELETE FROM gchat_ignores WHERE user_id=$1 AND ignored_id=$2', [req.user.id, uid]);
  }
  res.json({ ok: true, ignored });
}));

/* ================= БЕЙДЖ УВЕДОМЛЕНИЙ ЧАТСОВ ================= */

/** GET /api/gchats/notif-badge — непрочитанные уведомления чатсов + сообщения */
router.get('/notif-badge', requireAuth, asyncH(async (req, res) => {
  const CHAT_TYPES = [
    'chat_request', 'chat_approved', 'chat_declined', 'chat_invite',
    'chat_invite_accepted', 'chat_invite_declined', 'chat_kicked', 'chat_banned',
    'chat_requests_blocked', 'chat_added', 'persona_request', 'persona_approved',
    'persona_declined', 'mention',
  ];
  const { rows: n } = await query(
    `SELECT COUNT(*)::int AS n FROM notifications
     WHERE user_id=$1 AND read=false AND type = ANY($2::text[])`,
    [req.user.id, CHAT_TYPES]
  );
  const { rows: m } = await query(
    `SELECT COALESCE(SUM((SELECT COUNT(*)::int FROM gchat_messages gm
        WHERE gm.chat_id=c.id AND gm.created_at > mm.last_read_at
          AND (gm.sender_id IS NULL OR gm.sender_id <> $1) AND gm.kind='user')), 0)::int AS n
     FROM gchat_members mm JOIN gchats c ON c.id=mm.chat_id
     WHERE mm.user_id=$1 AND c.kind <> 'private'`,
    [req.user.id]
  );
  res.json({ notifications: n[0].n, messages: m[0].n, total: n[0].n + m[0].n });
}));

/** GET /api/gchats/:id/search?q= — поиск сообщений: по @автору или ключевым словам */
router.get('/:id/search', optionalAuth, asyncH(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const id = parseInt(req.params.id, 10);
  const chat = await loadChat(id);
  const member = await loadMember(id, req.user?.id);
  const isStaff = req.user && ['moderator', 'admin'].includes(req.user.role);
  if (!member && chat.msg_visibility !== 'everyone' && !isStaff) {
    throw forbidden('Сообщения чатса доступны только участникам');
  }
  let q = String(req.query.q || '').trim();
  if (q.length < 1) throw bad('Укажите никнейм (@ник) или ключевое слово');
  if (q.length > 60) throw bad('Поисковый запрос слишком длинный (макс. 60)');

  const byAuthor = q.startsWith('@');
  q = q.replace(/^@+/, '').trim();
  if (!q) throw bad('Укажите никнейм после @ или ключевое слово');

  const conds = ['m.chat_id=$1', 'm.deleted=false', "m.kind='user'"];
  const params = [id];
  params.push(`%${q}%`);
  const ph = `$${params.length}`;
  if (byAuthor) {
    conds.push(`u.username ILIKE ${ph}`);
  } else {
    conds.push(`(m.content ILIKE ${ph} OR u.username ILIKE ${ph} OR p.name ILIKE ${ph})`);
  }

  const { rows } = await query(
    `SELECT m.id, m.content, m.image_url, m.created_at,
            u.username AS sender_username, u.avatar_url AS sender_avatar,
            p.name AS persona_name, p.avatar_url AS persona_avatar
     FROM gchat_messages m
     LEFT JOIN users u ON u.id=m.sender_id
     LEFT JOIN gchat_personas p ON p.id=m.persona_id
     WHERE ${conds.join(' AND ')}
     ORDER BY m.id DESC
     LIMIT 40`,
    params
  );
  res.json({ items: rows, total: rows.length });
}));

module.exports = router;















