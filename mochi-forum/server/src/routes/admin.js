const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const { asyncH, notFound, bad, forbidden, paginate, pages, notify } = require('../utils/helpers');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

/** GET /api/admin/stats — сводка */
router.get('/stats', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM users) AS users_total,
       (SELECT COUNT(*)::int FROM users WHERE created_at > now() - interval '1 day') AS users_today,
       (SELECT COUNT(*)::int FROM topics) AS topics_total,
       (SELECT COUNT(*)::int FROM posts WHERE deleted=false) AS posts_total,
       (SELECT COUNT(*)::int FROM messages) AS messages_total,
       (SELECT COUNT(*)::int FROM reports WHERE status='open') AS reports_open,
       (SELECT COUNT(*)::int FROM users WHERE ban_reason IS NOT NULL AND (banned_until IS NULL OR banned_until > now())) AS banned_now`
  );
  res.json({ stats: rows[0] });
}));

/** GET /api/admin/users?q=&page= */
router.get('/users', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query, 20);
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const whereCount = q ? `WHERE u.username ILIKE $1 OR u.email ILIKE $1` : '';
  const where = q ? `WHERE u.username ILIKE $3 OR u.email ILIKE $3` : '';

  const total = (
    await query(`SELECT COUNT(*)::int AS n FROM users u ${whereCount}`, q ? [like] : [])
  ).rows[0].n;

  const params = q ? [limit, offset, like] : [limit, offset];
  const { rows } = await query(
    `SELECT u.id, u.username, u.email, u.role, u.avatar_url, u.created_at,
            u.banned_until, u.ban_reason,
            CASE WHEN u.ban_reason IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until > now())
                 THEN true ELSE false END AS is_banned,
            (SELECT COUNT(*)::int FROM topics t WHERE t.author_id=u.id) AS topics_count,
            (SELECT COUNT(*)::int FROM posts p WHERE p.author_id=u.id AND p.deleted=false) AS posts_count
     FROM users u ${where}
     ORDER BY u.id LIMIT $1 OFFSET $2`,
    params
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** PATCH /api/admin/users/:id — роль / бан / разбан */
router.patch('/users/:id', asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const target = (await query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!target) throw notFound('Пользователь не найден');

  // --- смена роли ---
  if (req.body.role !== undefined) {
    const role = v.oneOf(req.body.role, ['user', 'moderator', 'admin'], { label: 'Роль' });
    if (target.id === req.user.id && role !== 'admin') throw bad('Нельзя понизить собственную роль администратора');
    if (target.role === 'admin' && role !== 'admin') {
      const admins = (await query(`SELECT COUNT(*)::int AS n FROM users WHERE role='admin'`)).rows[0].n;
      if (admins <= 1) throw bad('Это последний администратор — нельзя снять права');
    }
    await query('UPDATE users SET role=$1, updated_at=now() WHERE id=$2', [role, id]);
    await notify(query, {
      userId: id, type: 'role_changed', actorId: req.user.id,
      payload: { role },
    });
    return res.json({ ok: true, role });
  }

  // --- бан ---
  if (req.body.action === 'ban') {
    if (target.id === req.user.id) throw bad('Нельзя забанить самого себя');
    if (target.role === 'admin') throw forbidden('Администратора нельзя забанить');
    const reason = v.str(req.body.reason, { label: 'Причина бана', min: 3, max: 300 });
    let until = null; // null = навсегда
    if (req.body.days !== undefined && req.body.days !== null && req.body.days !== '') {
      const days = v.int(req.body.days, { label: 'Дней', min: 1, max: 3650 });
      until = new Date(Date.now() + days * 24 * 3600 * 1000);
    }
    await query(
      `UPDATE users SET banned_until=$1, ban_reason=$2, updated_at=now() WHERE id=$3`,
      [until, reason, id]
    );
    await query(
      `INSERT INTO bans (user_id, moderator_id, reason, until) VALUES ($1,$2,$3,$4)`,
      [id, req.user.id, reason, until]
    );
    await notify(query, {
      userId: id, type: 'banned', actorId: req.user.id,
      payload: { reason, until: until ? until.toISOString() : null },
    });
    return res.json({ ok: true, banned: true, until });
  }

  // --- разбан ---
  if (req.body.action === 'unban') {
    await query(`UPDATE users SET banned_until=NULL, ban_reason=NULL, updated_at=now() WHERE id=$1`, [id]);
    await query(`UPDATE bans SET active=false WHERE user_id=$1 AND active=true`, [id]);
    await notify(query, { userId: id, type: 'unbanned', actorId: req.user.id, payload: {} });
    return res.json({ ok: true, banned: false });
  }

  throw bad('Укажите action=ban|unban или role');
}));

/** DELETE /api/admin/users/:id — удалить пользователя (кроме себя и других админов) */
router.delete('/users/:id', asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) throw bad('Нельзя удалить собственный аккаунт из админки');
  const target = (await query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
  if (!target) throw notFound('Пользователь не найден');
  if (target.role === 'admin') throw forbidden('Нельзя удалить другого администратора');
  await query('DELETE FROM users WHERE id=$1', [id]);
  res.json({ ok: true });
}));

/** GET /api/admin/bans — история банов */
router.get('/bans', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query, 30);
  const total = (await query('SELECT COUNT(*)::int AS n FROM bans')).rows[0].n;
  const { rows } = await query(
    `SELECT b.*, tu.username AS user_username, mu.username AS moderator_username
     FROM bans b LEFT JOIN users tu ON tu.id=b.user_id LEFT JOIN users mu ON mu.id=b.moderator_id
     ORDER BY b.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

module.exports = router;