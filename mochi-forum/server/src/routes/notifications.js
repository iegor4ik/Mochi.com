const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const { asyncH, paginate, pages } = require('../utils/helpers');

const router = express.Router();

/** GET /api/notifications?types=chat_request,mention — фильтр по типам */
router.get('/', requireAuth, asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query, 30);
  const types = String(req.query.types || '').split(',').map((s) => s.trim()).filter(Boolean);
  const total = (
    await query(
      `SELECT COUNT(*)::int AS n FROM notifications
       WHERE user_id=$1 ${types.length ? 'AND type = ANY($2::text[])' : ''}`,
      types.length ? [req.user.id, types] : [req.user.id]
    )
  ).rows[0].n;

  const { rows } = await query(
    `SELECT n.id, n.type, n.entity_type, n.entity_id, n.payload, n.read, n.created_at,
            a.username AS actor_username, a.avatar_url AS actor_avatar
     FROM notifications n LEFT JOIN users a ON a.id=n.actor_id
     WHERE n.user_id=$1 ${types.length ? 'AND n.type = ANY($4::text[])' : ''}
     ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
    types.length ? [req.user.id, limit, offset, types] : [req.user.id, limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** GET /api/notifications/unread-count?scope=chats — счётчик (scope=chats — только чатсовые типы) */
router.get('/unread-count', requireAuth, asyncH(async (req, res) => {
  const CHAT_TYPES = [
    'chat_request', 'chat_approved', 'chat_declined', 'chat_invite',
    'chat_invite_accepted', 'chat_invite_declined', 'chat_kicked', 'chat_banned',
    'chat_requests_blocked', 'chat_added', 'persona_request', 'persona_approved',
    'persona_declined', 'mention',
  ];
  const scope = req.query.scope === 'chats';
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM notifications
     WHERE user_id=$1 AND read=false ${scope ? 'AND type = ANY($2::text[])' : ''}`,
    scope ? [req.user.id, CHAT_TYPES] : [req.user.id]
  );
  res.json({ count: rows[0].n });
}));

/** POST /api/notifications/read — отметить прочитанными (ids[] или все) */
router.post('/read', requireAuth, asyncH(async (req, res) => {
  if (Array.isArray(req.body.ids) && req.body.ids.length) {
    const ids = req.body.ids.map((x) => parseInt(x, 10)).filter(Number.isFinite).slice(0, 200);
    if (!ids.length) return res.json({ ok: true });
    await query(
      `UPDATE notifications SET read=true WHERE user_id=$1 AND id = ANY($2::int[])`,
      [req.user.id, ids]
    );
  } else {
    await query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  }
  res.json({ ok: true });
}));

module.exports = router;