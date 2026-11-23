const express = require('express');
const { query } = require('../config/db');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { imageUpload } = require('../middleware/upload');
const { v } = require('../middleware/validate');
const { asyncH, notFound, forbidden, bad, paginate, pages, slugify, notify } = require('../utils/helpers');

const router = express.Router();

const SORTS = {
  activity: 't.pinned DESC, t.last_activity_at DESC',
  new: 't.pinned DESC, t.created_at DESC',
  top: 't.pinned DESC, t.views DESC',
  discussed: 't.pinned DESC, t.post_count DESC',
};

/** GET /api/topics?category=&sort=&page= */
router.get('/', asyncH(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const sort = SORTS[req.query.sort] || SORTS.activity;

  let categoryId = null;
  if (req.query.category) {
    const c = await query('SELECT id FROM categories WHERE slug=$1', [String(req.query.category)]);
    if (!c.rows[0]) throw notFound('Категория не найдена');
    categoryId = c.rows[0].id;
  }

  const total = (
    await query('SELECT COUNT(*)::int AS n FROM topics WHERE ($1::int IS NULL OR category_id=$1)', [categoryId])
  ).rows[0].n;

  const { rows } = await query(
    `SELECT t.id, t.title, t.slug, t.views, t.post_count, t.pinned, t.locked,
            t.created_at, t.last_activity_at,
            u.username AS author_username, u.avatar_url AS author_avatar, u.role AS author_role,
            c.name AS category_name, c.slug AS category_slug, c.color AS category_color
     FROM topics t
     JOIN users u ON u.id=t.author_id
     JOIN categories c ON c.id=t.category_id
     WHERE ($1::int IS NULL OR t.category_id=$1)
     ORDER BY ${sort}
     LIMIT $2 OFFSET $3`,
    [categoryId, limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** POST /api/topics — создать тему (multipart или JSON) */
router.post('/', requireAuth, imageUpload.single('image'), asyncH(async (req, res) => {
  const categoryId = v.int(req.body.category_id, { label: 'Категория', min: 1 });
  const title = v.str(req.body.title, { label: 'Заголовок', min: 5, max: 200 });
  const content = v.str(req.body.content, { label: 'Текст', min: 10, max: 20000 });
  // картинка: файл (multipart) или уже загруженный URL (JSON)
  const imageUrl = req.file
    ? `/uploads/${req.file.filename}`
    : (req.body.image_url ? String(req.body.image_url).slice(0, 500) : null);

  const cat = await query('SELECT id FROM categories WHERE id=$1', [categoryId]);
  if (!cat.rows[0]) throw notFound('Категория не найдена');

  let slug = slugify(title);
  const dup = await query('SELECT id FROM topics WHERE slug=$1', [slug]);
  if (dup.rows.length) slug = `${slug}-${Date.now().toString(36)}`;

  const { rows } = await query(
    `INSERT INTO topics (category_id, author_id, title, slug, content, image_url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [categoryId, req.user.id, title, slug, content, imageUrl]
  );
  await query(`UPDATE topics SET post_count=1 WHERE id=$1`, [rows[0].id]);
  res.status(201).json({ topic: rows[0] });
}));

/** GET /api/topics/:id — тема + автор (+ просмотр) */
router.get('/:id', asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query(
    `SELECT t.*, u.username AS author_username, u.avatar_url AS author_avatar,
            u.role AS author_role, u.signature AS author_signature,
            c.name AS category_name, c.slug AS category_slug, c.color AS category_color
     FROM topics t JOIN users u ON u.id=t.author_id JOIN categories c ON c.id=t.category_id
     WHERE t.id=$1`,
    [id]
  );
  if (!rows[0]) throw notFound('Тема не найдена');
  // счётчик просмотров — fire & forget
  query('UPDATE topics SET views=views+1 WHERE id=$1', [id]).catch(() => {});
  res.json({ topic: rows[0] });
}));

/** GET /api/topics/:id/posts — посты темы с пагинацией */
router.get('/:id/posts', asyncH(async (req, res) => {
  const topicId = parseInt(req.params.id, 10);
  const { page, limit, offset } = paginate(req.query);
  const meId = req.user ? req.user.id : 0;

  const total = (
    await query('SELECT COUNT(*)::int AS n FROM posts WHERE topic_id=$1 AND deleted=false', [topicId])
  ).rows[0].n;

  const { rows } = await query(
    `SELECT p.id, p.content, p.image_url, p.like_count, p.edited, p.deleted,
            p.parent_post_id, p.created_at, p.updated_at,
            u.username AS author_username, u.avatar_url AS author_avatar,
            u.role AS author_role, u.signature AS author_signature,
            (EXISTS (SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$2)) AS liked_by_me,
            par.username AS parent_username
     FROM posts p
     JOIN users u ON u.id=p.author_id
     LEFT JOIN posts pp ON pp.id=p.parent_post_id
     LEFT JOIN users par ON par.id=pp.author_id
     WHERE p.topic_id=$1 AND p.deleted=false
     ORDER BY p.created_at ASC
     LIMIT $3 OFFSET $4`,
    [topicId, meId, limit, offset]
  );
  res.json({ items: rows, page, totalPages: pages(total, limit), total });
}));

/** POST /api/topics/:id/posts — ответ в теме */
router.post('/:id/posts', requireAuth, imageUpload.single('image'), asyncH(async (req, res) => {
  const topicId = parseInt(req.params.id, 10);
  const content = v.str(req.body.content, { label: 'Текст', min: 1, max: 20000 });
  // картинка: файл (multipart) или уже загруженный URL (JSON)
  const imageUrl = req.file
    ? `/uploads/${req.file.filename}`
    : (req.body.image_url ? String(req.body.image_url).slice(0, 500) : null);
  let parentId = null;
  if (req.body.parent_post_id) {
    parentId = v.int(req.body.parent_post_id, { label: 'Родительский пост', min: 1 });
    const pp = await query('SELECT id, author_id, topic_id FROM posts WHERE id=$1', [parentId]);
    if (!pp.rows[0] || pp.rows[0].topic_id !== topicId) throw bad('Родительский пост не найден в этой теме');
  }

  const t = await query('SELECT id, locked, author_id, title FROM topics WHERE id=$1', [topicId]);
  if (!t.rows[0]) throw notFound('Тема не найдена');
  if (t.rows[0].locked && !['moderator', 'admin'].includes(req.user.role)) {
    throw forbidden('Тема закрыта для новых сообщений');
  }

  const { rows } = await query(
    `INSERT INTO posts (topic_id, author_id, parent_post_id, content, image_url)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [topicId, req.user.id, parentId, content, imageUrl]
  );
  const post = rows[0];
  await query(
    `UPDATE topics SET post_count=(SELECT COUNT(*)::int FROM posts WHERE topic_id=$1 AND deleted=false),
                     last_activity_at=now() WHERE id=$1`,
    [topicId]
  );

  // уведомления: автору темы и автору родительского поста
  await notify(query, {
    userId: t.rows[0].author_id, type: 'reply', actorId: req.user.id,
    entityType: 'post', entityId: post.id,
    payload: { topic_id: topicId, topic_title: t.rows[0].title },
  });
  if (parentId) {
    const par = await query('SELECT author_id FROM posts WHERE id=$1', [parentId]);
    await notify(query, {
      userId: par.rows[0]?.author_id, type: 'reply', actorId: req.user.id,
      entityType: 'post', entityId: post.id,
      payload: { topic_id: topicId, topic_title: t.rows[0].title },
    });
  }
  res.status(201).json({ post });
}));

/** PATCH /api/topics/:id — правка контента / закрепление / закрытие */
router.patch('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query('SELECT * FROM topics WHERE id=$1', [id]);
  const topic = rows[0];
  if (!topic) throw notFound('Тема не найдена');

  const isOwner = topic.author_id === req.user.id;
  const isStaff = ['moderator', 'admin'].includes(req.user.role);
  if (!isOwner && !isStaff) throw forbidden();

  const updates = {};
  if (req.body.title !== undefined) {
    if (!isOwner && !isStaff) throw forbidden();
    updates.title = v.str(req.body.title, { label: 'Заголовок', min: 5, max: 200 });
  }
  if (req.body.content !== undefined) {
    if (!isOwner && !isStaff) throw forbidden();
    updates.content = v.str(req.body.content, { label: 'Текст', min: 10, max: 20000 });
  }
  if (req.body.image_url !== undefined) {
    if (!isOwner && !isStaff) throw forbidden();
    updates.image_url = req.body.image_url ? String(req.body.image_url).slice(0, 500) : null;
  }
  if (req.body.pinned !== undefined) {
    if (!isStaff) throw forbidden('Закреплять могут только модераторы');
    updates.pinned = v.bool(req.body.pinned);
  }
  if (req.body.locked !== undefined) {
    if (!isStaff) throw forbidden('Закрывать темы могут только модераторы');
    updates.locked = v.bool(req.body.locked);
  }
  if (!Object.keys(updates).length) throw bad('Нет полей для обновления');

  const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const params = [...Object.values(updates), id];
  const r = await query(`UPDATE topics SET ${sets}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params);
  res.json({ topic: r.rows[0] });
}));

/** DELETE /api/topics/:id */
router.delete('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query('SELECT author_id FROM topics WHERE id=$1', [id]);
  if (!rows[0]) throw notFound('Тема не найдена');
  const isOwner = rows[0].author_id === req.user.id;
  const isStaff = ['moderator', 'admin'].includes(req.user.role);
  if (!isOwner && !isStaff) throw forbidden();
  await query('DELETE FROM topics WHERE id=$1', [id]);
  res.json({ ok: true });
}));

module.exports = router;