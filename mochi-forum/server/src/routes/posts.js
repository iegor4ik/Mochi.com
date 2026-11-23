const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const { asyncH, notFound, forbidden, bad, notify } = require('../utils/helpers');

const router = express.Router();

/** PATCH /api/posts/:id — редактирование своего поста */
router.patch('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query('SELECT * FROM posts WHERE id=$1', [id]);
  const post = rows[0];
  if (!post || post.deleted) throw notFound('Пост не найден');
  if (post.author_id !== req.user.id && !['moderator', 'admin'].includes(req.user.role)) throw forbidden();

  const updates = {};
  if (req.body.content !== undefined) updates.content = v.str(req.body.content, { label: 'Текст', min: 1, max: 20000 });
  if (req.body.image_url !== undefined) updates.image_url = req.body.image_url ? String(req.body.image_url).slice(0, 500) : null;
  if (!Object.keys(updates).length) throw bad('Нет полей для обновления');

  const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const params = [...Object.values(updates), id];
  const r = await query(`UPDATE posts SET ${sets}, edited=true, updated_at=now() WHERE id=$${params.length} RETURNING *`, params);
  res.json({ post: r.rows[0] });
}));

/** DELETE /api/posts/:id — мягкое удаление */
router.delete('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query('SELECT * FROM posts WHERE id=$1', [id]);
  const post = rows[0];
  if (!post || post.deleted) throw notFound('Пост не найден');
  if (post.author_id !== req.user.id && !['moderator', 'admin'].includes(req.user.role)) throw forbidden();

  await query(`UPDATE posts SET deleted=true, content='', image_url=NULL, updated_at=now() WHERE id=$1`, [id]);
  await query(
    `UPDATE topics SET post_count=(SELECT COUNT(*)::int FROM posts WHERE topic_id=$1 AND deleted=false) WHERE id=$1`,
    [post.topic_id]
  );
  res.json({ ok: true });
}));

/** POST /api/posts/:id/like — поставить/снять лайк */
router.post('/:id/like', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query('SELECT id, author_id, topic_id FROM posts WHERE id=$1 AND deleted=false', [id]);
  const post = rows[0];
  if (!post) throw notFound('Пост не найден');

  const ins = await query(
    `INSERT INTO likes (user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`,
    [req.user.id, id]
  );
  let liked;
  if (ins.rows.length) {
    liked = true;
    await notify(query, {
      userId: post.author_id, type: 'like', actorId: req.user.id,
      entityType: 'post', entityId: id,
      payload: { topic_id: post.topic_id },
    });
  } else {
    await query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2', [req.user.id, id]);
    liked = false;
  }
  const cnt = await query('SELECT COUNT(*)::int AS n FROM likes WHERE post_id=$1', [id]);
  await query('UPDATE posts SET like_count=$2 WHERE id=$1', [id, cnt.rows[0].n]);
  res.json({ liked, like_count: cnt.rows[0].n });
}));

module.exports = router;