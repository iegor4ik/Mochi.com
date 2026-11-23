const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const { asyncH, notFound, bad, paginate, pages, notify } = require('../utils/helpers');

const router = express.Router();

/** POST /api/reports — отправить жалобу */
router.post('/', requireAuth, asyncH(async (req, res) => {
  const targetType = v.oneOf(req.body.target_type, ['post', 'topic', 'message', 'user'], { label: 'Тип объекта' });
  const targetId = v.int(req.body.target_id, { label: 'ID объекта', min: 1 });
  const reason = v.str(req.body.reason, { label: 'Причина', min: 5, max: 500 });

  // проверяем существование цели
  const table = { post: 'posts', topic: 'topics', message: 'messages', user: 'users' }[targetType];
  const exists = await query(`SELECT id FROM ${table} WHERE id=$1`, [targetId]);
  if (!exists.rows[0]) throw notFound('Объект жалобы не найден');

  const dup = await query(
    `SELECT id FROM reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status='open'`,
    [req.user.id, targetType, targetId]
  );
  if (dup.rows.length) throw bad('Вы уже отправили жалобу на этот объект — она на рассмотрении');

  const { rows } = await query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, targetType, targetId, reason]
  );

  // уведомим модераторов и админов
  const staff = await query(`SELECT id FROM users WHERE role IN ('moderator','admin')`);
  for (const s of staff.rows) {
    await notify(query, {
      userId: s.id, type: 'report', actorId: req.user.id,
      entityType: 'report', entityId: rows[0].id,
      payload: { target_type: targetType },
    });
  }
  res.status(201).json({ report: rows[0] });
}));

/** GET /api/reports?status= — очередь жалоб (moderator/admin) */
router.get('/', requireAuth, requireRole('moderator', 'admin'), asyncH(async (req, res) => {
  const status = req.query.status && ['open', 'resolved', 'dismissed'].includes(req.query.status)
    ? req.query.status : null;
  const { page, limit, offset } = paginate(req.query, 20);

  const total = (
    await query('SELECT COUNT(*)::int AS n FROM reports WHERE ($1::text IS NULL OR status=$1)', [status])
  ).rows[0].n;

  const { rows } = await query(
    `SELECT r.*, ru.username AS reporter_username,
            mu.username AS resolved_by_username
     FROM reports r
     LEFT JOIN users ru ON ru.id=r.reporter_id
     LEFT JOIN users mu ON mu.id=r.resolved_by
     WHERE ($1::text IS NULL OR r.status=$1)
     ORDER BY CASE WHEN r.status='open' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** GET /api/reports/target?type=&id= — превью объекта жалобы (mod/admin) */
router.get('/target', requireAuth, requireRole('moderator', 'admin'), asyncH(async (req, res) => {
  const type = v.oneOf(req.query.type, ['post', 'topic', 'message', 'user'], { label: 'Тип' });
  const id = v.int(req.query.id, { label: 'ID', min: 1 });
  let row;
  if (type === 'post') {
    row = (await query(
      `SELECT p.id, p.content, p.image_url, p.created_at, u.username AS author_username, p.topic_id
       FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=$1`, [id])).rows[0];
  } else if (type === 'topic') {
    row = (await query(
      `SELECT t.id, t.title, t.content, t.created_at, u.username AS author_username
       FROM topics t JOIN users u ON u.id=t.author_id WHERE t.id=$1`, [id])).rows[0];
  } else if (type === 'message') {
    row = (await query(
      `SELECT m.id, m.content, m.image_url, m.created_at, u.username AS author_username, m.conversation_id
       FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.id=$1`, [id])).rows[0];
  } else {
    row = (await query(
      `SELECT id, username, role, bio, created_at,
              CASE WHEN ban_reason IS NOT NULL AND (banned_until IS NULL OR banned_until > now())
                   THEN true ELSE false END AS is_banned
       FROM users WHERE id=$1`, [id])).rows[0];
  }
  if (!row) throw notFound('Объект не найден');
  res.json({ target: { ...row, _type: type } });
}));

/** PATCH /api/reports/:id — обработать жалобу (mod/admin) */
router.patch('/:id', requireAuth, requireRole('moderator', 'admin'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = v.oneOf(req.body.status, ['resolved', 'dismissed'], { label: 'Статус' });
  const note = v.str(req.body.note, { label: 'Комментарий', max: 500, optional: true });

  const cur = await query('SELECT * FROM reports WHERE id=$1', [id]);
  if (!cur.rows[0]) throw notFound('Жалоба не найдена');
  if (cur.rows[0].status !== 'open') throw bad('Жалоба уже обработана');

  const { rows } = await query(
    `UPDATE reports SET status=$1, resolved_by=$2, resolution_note=$3 WHERE id=$4 RETURNING *`,
    [status, req.user.id, note || null, id]
  );

  await notify(query, {
    userId: rows[0].reporter_id, type: 'report_resolved', actorId: req.user.id,
    entityType: 'report', entityId: id,
    payload: { status },
  });
  res.json({ report: rows[0] });
}));

module.exports = router;