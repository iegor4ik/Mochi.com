const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const { v } = require('../middleware/validate');
const { asyncH, notFound, forbidden, bad, notify } = require('../utils/helpers');
const { releaseUpload } = require('../utils/uploads');

const router = express.Router();

/**
 * Проверка политики личных сообщений получателя:
 * 'all' — пишут все; 'followers' — только подписчики получателя;
 * 'following' — только те, на кого подписан получатель.
 * Модераторы и админы пишут всегда.
 */
async function assertCanDm(sender, recipientId) {
  const { rows } = await query('SELECT id, dm_policy FROM users WHERE id=$1', [recipientId]);
  const target = rows[0];
  if (!target) throw notFound('Пользователь не найден');
  if (target.id === sender.id) return target;
  if (['moderator', 'admin'].includes(sender.role)) return target;
  if (target.dm_policy === 'all') return target;

  const check = target.dm_policy === 'followers'
    ? 'SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2'   // отправитель подписан на получателя
    : 'SELECT 1 FROM follows WHERE follower_id=$2 AND following_id=$1';  // получатель подписан на отправителя
  const ok = await query(check, [sender.id, target.id]);
  if (!ok.rows[0]) {
    throw forbidden(target.dm_policy === 'followers'
      ? 'Пользователь разрешает личные сообщения только своим подписчикам'
      : 'Пользователь разрешает личные сообщения только тем, на кого он подписан');
  }
  return target;
}

/** GET /api/chat/conversations — список диалогов (с фильтром архивирования) */
router.get('/conversations', requireAuth, asyncH(async (req, res) => {
  const showArchived = req.query.archived === 'true';
  const userId = req.user.id;
  
  // Определяем условие архивирования в зависимости от того, какой это пользователь
  const archiveCondition = showArchived
    ? `((cv.user1_id=$1 AND cv.archived_by_user1 = true) OR (cv.user2_id=$1 AND cv.archived_by_user2 = true))`
    : `((cv.user1_id=$1 AND cv.archived_by_user1 = false) OR (cv.user2_id=$1 AND cv.archived_by_user2 = false))`;
  
  // Определяем колонну для сортировки игнорирования
  const ignoreSort = `CASE 
    WHEN cv.user1_id=$1 AND cv.ignored_by_user1 = true THEN 1
    WHEN cv.user2_id=$1 AND cv.ignored_by_user2 = true THEN 1
    ELSE 0
  END`;

  const { rows } = await query(
    `SELECT cv.id, cv.last_message_at,
            cv.user1_id, cv.user2_id,
            ou.id AS other_id, ou.username AS other_username,
            ou.avatar_url AS other_avatar, ou.role AS other_role,
            ou.last_seen_at AS other_last_seen,
            lm.content AS last_content, lm.image_url AS last_image,
            lm.sender_id AS last_sender_id, lm.created_at AS last_at,
            (SELECT COUNT(*)::int FROM messages m
              WHERE m.conversation_id=cv.id AND m.sender_id<>$1 AND m.read_at IS NULL) AS unread,
            (CASE WHEN cv.user1_id=$1 THEN cv.ignored_by_user1 ELSE cv.ignored_by_user2 END) AS is_ignored
     FROM conversations cv
     JOIN users ou ON ou.id = CASE WHEN cv.user1_id=$1 THEN cv.user2_id ELSE cv.user1_id END
     LEFT JOIN LATERAL (
       SELECT m.* FROM messages m WHERE m.conversation_id=cv.id ORDER BY m.created_at DESC LIMIT 1
     ) lm ON true
     WHERE (cv.user1_id=$1 OR cv.user2_id=$1) AND ${archiveCondition}
     ORDER BY ${ignoreSort} DESC, cv.last_message_at DESC`,
    [userId]
  );

  // приватные групповые чаты — отображаются в личных сообщениях
  const { rows: groups } = await query(
    `SELECT c.id, c.name, c.photo, c.private_open, c.member_count, c.last_message_at,
            (SELECT content FROM gchat_messages gm WHERE gm.chat_id=c.id ORDER BY gm.created_at DESC LIMIT 1) AS last_content,
            (SELECT image_url FROM gchat_messages gm WHERE gm.chat_id=c.id ORDER BY gm.created_at DESC LIMIT 1) AS last_image,
            (SELECT sender_id FROM gchat_messages gm WHERE gm.chat_id=c.id ORDER BY gm.created_at DESC LIMIT 1) AS last_sender_id,
            (SELECT COUNT(*)::int FROM gchat_messages gm
              WHERE gm.chat_id=c.id AND gm.created_at > m.last_read_at
                AND (gm.sender_id IS NULL OR gm.sender_id <> $1) AND gm.kind='user') AS unread
     FROM gchats c JOIN gchat_members m ON m.chat_id=c.id AND m.user_id=$1
     WHERE c.kind='private'
     ORDER BY c.last_message_at DESC NULLS LAST`,
    [userId]
  );

  res.json({ items: rows, groups });
}));

/** POST /api/chat/conversations — открыть/создать диалог с пользователем */
router.post('/conversations', requireAuth, asyncH(async (req, res) => {
  const username = v.str(req.body.username, { label: 'Имя пользователя', min: 3, max: 32 });
  if (username.toLowerCase() === req.user.username.toLowerCase()) throw bad('Нельзя открыть чат с самим собой');

  const u = await query('SELECT id, username FROM users WHERE lower(username)=$1', [username.toLowerCase()]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');

  // приватность: кому разрешено писать этому пользователю
  await assertCanDm(req.user, u.rows[0].id);

  const lo = Math.min(req.user.id, u.rows[0].id);
  const hi = Math.max(req.user.id, u.rows[0].id);
  const { rows } = await query(
    `INSERT INTO conversations (user1_id, user2_id) VALUES ($1,$2)
     ON CONFLICT (user1_id,user2_id) DO UPDATE SET last_message_at=conversations.last_message_at
     RETURNING *`,
    [lo, hi]
  );
  res.status(201).json({ conversation: rows[0], other: u.rows[0] });
}));

async function assertParticipant(convId, userId) {
  const { rows } = await query('SELECT * FROM conversations WHERE id=$1', [convId]);
  if (!rows[0]) throw notFound('Диалог не найден');
  if (rows[0].user1_id !== userId && rows[0].user2_id !== userId) throw forbidden('Это не ваш диалог');
  return rows[0];
}

/** GET /api/chat/conversations/:id/messages */
router.get('/conversations/:id/messages', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  await assertParticipant(convId, req.user.id);

  // входящие без картинки/текста помечаем прочитанными при открытии
  await query(
    `UPDATE messages SET read_at=now()
     WHERE conversation_id=$1 AND sender_id<>$2 AND read_at IS NULL`,
    [convId, req.user.id]
  );

  let afterId = null;
  if (req.query.after_id) afterId = v.int(req.query.after_id, { label: 'after_id', min: 0 });

  const { rows } = await query(
    `SELECT m.id, m.content, m.image_url, m.sender_id, m.read_at, m.created_at,
            u.username AS sender_username, u.avatar_url AS sender_avatar
     FROM messages m JOIN users u ON u.id=m.sender_id
     WHERE m.conversation_id=$1 AND ($2::int IS NULL OR m.id > $2)
     ORDER BY m.created_at ASC, m.id ASC
     LIMIT 200`,
    [convId, afterId]
  );
  res.json({ items: rows, typing: dmTyping(convId, req.user.id) });
}));

/* ---------- «Печатает…» для личных диалогов (в памяти процесса) ---------- */
const dmTypingMap = new Map(); // convId -> Map(userId -> {username, expires})

function setDmTyping(convId, userId, username) {
  if (!dmTypingMap.has(convId)) dmTypingMap.set(convId, new Map());
  dmTypingMap.get(convId).set(userId, { username, expires: Date.now() + 6000 });
}
function dmTyping(convId, excludeUserId) {
  const m = dmTypingMap.get(convId);
  if (!m) return [];
  const now = Date.now();
  const out = [];
  for (const [uid, val] of m) {
    if (val.expires < now) { m.delete(uid); continue; }
    if (uid === excludeUserId) continue;
    out.push({ user_id: uid, username: val.username });
  }
  return out;
}

/** POST /api/chat/conversations/:id/typing — «я печатаю» */
router.post('/conversations/:id/typing', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  await assertParticipant(convId, req.user.id);
  setDmTyping(convId, req.user.id, req.user.username);
  res.json({ ok: true });
}));

/** POST /api/chat/conversations/:id/messages — отправить сообщение (текст и/или фото) */
router.post('/conversations/:id/messages', requireAuth, imageUpload.single('image'), asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const conv = await assertParticipant(convId, req.user.id);

  const content = v.str(req.body.content, { label: 'Сообщение', min: 1, max: 4000, optional: true });
  // картинка может прийти файлом (multipart) или уже загруженным URL (JSON)
  const imageUrl = req.file
    ? `/uploads/${req.file.filename}`
    : (req.body.image_url ? String(req.body.image_url).slice(0, 500) : null);
  if (!content && !imageUrl) throw bad('Сообщение не может быть пустым (нужен текст или фото)');

  const recipientId = conv.user1_id === req.user.id ? conv.user2_id : conv.user1_id;
  // приватность получателя проверяется и при отправке сообщения
  await assertCanDm(req.user, recipientId);
  const { rows } = await query(
    `INSERT INTO messages (conversation_id, sender_id, content, image_url)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [convId, req.user.id, content || '', imageUrl]
  );
  await query('UPDATE conversations SET last_message_at=now() WHERE id=$1', [convId]);

  await notify(query, {
    userId: recipientId, type: 'message', actorId: req.user.id,
    entityType: 'conversation', entityId: convId,
    payload: { from: req.user.username },
  });
  res.status(201).json({ message: rows[0] });
}));

/** PATCH /api/chat/conversations/:id/messages/:msgId — редактировать сообщение */
router.patch('/conversations/:id/messages/:msgId', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const msgId = parseInt(req.params.msgId, 10);
  const conv = await assertParticipant(convId, req.user.id);

  const { rows: msgs } = await query('SELECT * FROM messages WHERE id=$1 AND conversation_id=$2', [msgId, convId]);
  if (!msgs[0]) throw notFound('Сообщение не найдено');
  if (msgs[0].sender_id !== req.user.id) throw forbidden('Можно редактировать только свои сообщения');

  const content = v.str(req.body.content, { label: 'Сообщение', min: 1, max: 4000, optional: false });
  const { rows } = await query(
    'UPDATE messages SET content=$1, updated_at=now() WHERE id=$2 RETURNING *',
    [content, msgId]
  );
  res.json({ message: rows[0] });
}));

/** DELETE /api/chat/conversations/:id/messages/:msgId — удалить сообщение */
router.delete('/conversations/:id/messages/:msgId', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const msgId = parseInt(req.params.msgId, 10);
  const conv = await assertParticipant(convId, req.user.id);

  const { rows: msgs } = await query('SELECT * FROM messages WHERE id=$1 AND conversation_id=$2', [msgId, convId]);
  if (!msgs[0]) throw notFound('Сообщение не найдено');
  if (msgs[0].sender_id !== req.user.id) throw forbidden('Можно удалять только свои сообщения');

  await query('DELETE FROM messages WHERE id=$1', [msgId]);
  // фото из удалённого сообщения больше не нужно
  if (msgs[0].image_url) await releaseUpload(msgs[0].image_url);
  res.json({ ok: true });
}));

/** PATCH /api/chat/conversations/:id/archive — архивировать диалог */
router.patch('/conversations/:id/archive', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const conv = await assertParticipant(convId, req.user.id);

  const isArchived = req.body.archived !== false; // по умолчанию архивируем
  const userCol = req.user.id === conv.user1_id ? 'archived_by_user1' : 'archived_by_user2';
  
  await query(`UPDATE conversations SET ${userCol}=$1 WHERE id=$2`, [isArchived, convId]);
  res.json({ ok: true });
}));

/** PATCH /api/chat/conversations/:id/ignore — игнорировать диалог (не показывать уведомления) */
router.patch('/conversations/:id/ignore', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const conv = await assertParticipant(convId, req.user.id);

  const isIgnored = req.body.ignored !== false; // по умолчанию игнорируем
  const userCol = req.user.id === conv.user1_id ? 'ignored_by_user1' : 'ignored_by_user2';
  
  await query(`UPDATE conversations SET ${userCol}=$1 WHERE id=$2`, [isIgnored, convId]);
  res.json({ ok: true });
}));

/** DELETE /api/chat/conversations/:id/clear — удалить все сообщения из диалога */
router.delete('/conversations/:id/clear', requireAuth, asyncH(async (req, res) => {
  const convId = parseInt(req.params.id, 10);
  const conv = await assertParticipant(convId, req.user.id);

  const { rows: imgs } = await query('SELECT image_url FROM messages WHERE conversation_id=$1 AND image_url IS NOT NULL', [convId]);
  await query('DELETE FROM messages WHERE conversation_id=$1', [convId]);
  for (const r of imgs) await releaseUpload(r.image_url);
  res.json({ ok: true });
}));

module.exports = router;