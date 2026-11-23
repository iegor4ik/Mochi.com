const express = require('express');
const { query } = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const { v } = require('../middleware/validate');
const { asyncH, notFound, bad, paginate, pages, sanitizeTheme, notify } = require('../utils/helpers');
const { releaseUpload } = require('../utils/uploads');

const router = express.Router();

const DM_POLICIES = ['all', 'followers', 'following'];

/** GET /api/users/:username — профиль + статистика (+ подписки) */
router.get('/:username', optionalAuth, asyncH(async (req, res) => {
  const uname = String(req.params.username).toLowerCase();
  const viewerId = req.user ? req.user.id : 0;
  const { rows } = await query(
    `SELECT u.id, u.username, u.role, u.avatar_url, u.bio, u.signature, u.created_at, u.dm_policy,
            CASE WHEN u.ban_reason IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until > now())
                 THEN true ELSE false END AS is_banned,
            (SELECT COUNT(*)::int FROM topics t WHERE t.author_id=u.id) AS topics_count,
            (SELECT COUNT(*)::int FROM posts p WHERE p.author_id=u.id AND p.deleted=false) AS posts_count,
            (SELECT COUNT(*)::int FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.author_id=u.id) AS likes_received,
            (SELECT COUNT(*)::int FROM follows f WHERE f.following_id=u.id) AS followers_count,
            (SELECT COUNT(*)::int FROM follows f WHERE f.follower_id=u.id) AS following_count,
            (SELECT COUNT(*)::int FROM user_posts up WHERE up.author_id=u.id AND up.deleted=false
                AND ($2::int = u.id OR up.visibility IN ('public','personal'))) AS user_posts_count,
            EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=$2::int AND f.following_id=u.id) AS is_following
     FROM users u WHERE lower(u.username)=$1`,
    [uname, viewerId]
  );
  if (!rows[0]) throw notFound('Пользователь не найден');
  res.json({ user: rows[0] });
}));

/** GET /api/users/:username/topics */
router.get('/:username/topics', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const uname = String(req.params.username).toLowerCase();
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  const uid = u.rows[0].id;

  const total = (await query('SELECT COUNT(*)::int AS n FROM topics WHERE author_id=$1', [uid])).rows[0].n;
  const { rows } = await query(
    `SELECT t.id, t.title, t.slug, t.views, t.post_count, t.pinned, t.locked, t.created_at, t.last_activity_at,
            c.name AS category_name, c.slug AS category_slug, c.color AS category_color
     FROM topics t JOIN categories c ON c.id=t.category_id
     WHERE t.author_id=$1
     ORDER BY t.last_activity_at DESC LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** GET /api/users/:username/posts */
router.get('/:username/posts', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const uname = String(req.params.username).toLowerCase();
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  const uid = u.rows[0].id;

  const total = (await query('SELECT COUNT(*)::int AS n FROM posts WHERE author_id=$1 AND deleted=false', [uid])).rows[0].n;
  const { rows } = await query(
    `SELECT p.id, p.content, p.image_url, p.like_count, p.created_at, p.topic_id,
            t.title AS topic_title
     FROM posts p JOIN topics t ON t.id=p.topic_id
     WHERE p.author_id=$1 AND p.deleted=false
     ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
    [uid, limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** PUT /api/users/me — обновить профиль, тему и приватность ЛС */
router.put('/me', requireAuth, asyncH(async (req, res) => {
  const bio = v.str(req.body.bio, { label: 'О себе', max: 500, optional: true });
  const signature = v.str(req.body.signature, { label: 'Подпись', max: 200, optional: true });
  let theme;
  if (req.body.theme !== undefined) theme = JSON.stringify(sanitizeTheme(req.body.theme));
  let dmPolicy = null;
  if (req.body.dm_policy !== undefined) {
    dmPolicy = v.oneOf(req.body.dm_policy, DM_POLICIES, { label: 'Кто может писать в ЛС' });
  }

  const { rows } = await query(
    `UPDATE users SET
       bio = COALESCE($1, bio),
       signature = COALESCE($2, signature),
       theme = COALESCE($3::jsonb, theme),
       dm_policy = COALESCE($4, dm_policy),
       updated_at = now()
     WHERE id=$5 RETURNING *`,
    [req.body.bio === undefined ? null : bio,
     req.body.signature === undefined ? null : signature,
     theme || null, dmPolicy, req.user.id]
  );
  const u = rows[0];
  res.json({ user: { id: u.id, username: u.username, role: u.role, avatar_url: u.avatar_url, bio: u.bio, signature: u.signature, theme: u.theme, dm_policy: u.dm_policy } });
}));

/** POST /api/users/:username/follow — подписаться */
router.post('/:username/follow', requireAuth, asyncH(async (req, res) => {
  const uname = String(req.params.username).toLowerCase();
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  if (u.rows[0].id === req.user.id) throw bad('Нельзя подписаться на себя');

  const ins = await query(
    `INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)
     ON CONFLICT (follower_id, following_id) DO NOTHING RETURNING follower_id`,
    [req.user.id, u.rows[0].id]
  );
  if (ins.rows[0]) {
    await notify(query, {
      userId: u.rows[0].id, type: 'follow', actorId: req.user.id,
      entityType: 'user', entityId: req.user.id,
      payload: { username: req.user.username },
    });
  }
  res.json({ following: true });
}));

/** DELETE /api/users/:username/follow — отписаться */
router.delete('/:username/follow', requireAuth, asyncH(async (req, res) => {
  const uname = String(req.params.username).toLowerCase();
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  await query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [req.user.id, u.rows[0].id]);
  res.json({ following: false });
}));

/** GET /api/users/:username/followers — подписчики */
router.get('/:username/followers', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const uname = String(req.params.username).toLowerCase();
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  const total = (await query('SELECT COUNT(*)::int AS n FROM follows WHERE following_id=$1', [u.rows[0].id])).rows[0].n;
  const { rows } = await query(
    `SELECT us.id, us.username, us.role, us.avatar_url, us.bio
     FROM follows f JOIN users us ON us.id=f.follower_id
     WHERE f.following_id=$1
     ORDER BY f.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [u.rows[0].id]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** GET /api/users/:username/following — подписки */
router.get('/:username/following', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const uname = String(req.params.username).toLowerCase();
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  const total = (await query('SELECT COUNT(*)::int AS n FROM follows WHERE follower_id=$1', [u.rows[0].id])).rows[0].n;
  const { rows } = await query(
    `SELECT us.id, us.username, us.role, us.avatar_url, us.bio
     FROM follows f JOIN users us ON us.id=f.following_id
     WHERE f.follower_id=$1
     ORDER BY f.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    [u.rows[0].id]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** POST /api/users/me/avatar — загрузка аватара */
router.post('/me/avatar', requireAuth, imageUpload.single('image'), asyncH(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
  const url = `/uploads/${req.file.filename}`;
  const old = (await query('SELECT avatar_url FROM users WHERE id=$1', [req.user.id])).rows[0]?.avatar_url;
  await query('UPDATE users SET avatar_url=$1, updated_at=now() WHERE id=$2', [url, req.user.id]);
  // старый аватар больше не нужен — удаляем файл (если он нигде больше не используется)
  if (old && old !== url) await releaseUpload(old);
  res.json({ url });
}));

module.exports = router;