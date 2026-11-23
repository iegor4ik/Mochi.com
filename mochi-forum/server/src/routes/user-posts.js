const express = require('express');
const { query } = require('../config/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const { asyncH, notFound, forbidden, bad, paginate, pages, slugify } = require('../utils/helpers');
const {
  sanitizePostContent, sanitizeTags, sanitizeImageUrl, excerptFromHtml,
} = require('../utils/post-utils');

const router = express.Router();

const VISIBILITIES = ['public', 'personal', 'private'];

const LIST_SELECT = `
  SELECT p.id, p.title, p.cover_image, p.visibility, p.tags, p.views, p.topic_id,
         p.created_at, p.updated_at, p.content->>'html' AS html, p.content AS content_json,
         u.id AS author_id, u.username AS author_username,
         u.avatar_url AS author_avatar, u.role AS author_role
  FROM user_posts p JOIN users u ON u.id = p.author_id`;

/** Декоратор элемента списка: добавляет excerpt */
function listItem(row) {
  return { ...row, excerpt: excerptFromHtml(row.html, 220), html: undefined };
}

/**
 * GET /api/user-posts?author=<username>&visibility=&page=&limit=
 * Список постов автора. Автор видит все свои посты (в т.ч. приватные),
 * остальные — только публичные и личные.
 */
router.get('/', optionalAuth, asyncH(async (req, res) => {
  const uname = String(req.query.author || '').toLowerCase().trim();
  if (!uname) throw bad('Не указан автор (параметр author)');
  const u = await query('SELECT id FROM users WHERE lower(username)=$1', [uname]);
  if (!u.rows[0]) throw notFound('Пользователь не найден');
  const authorId = u.rows[0].id;
  const isAuthor = !!req.user && req.user.id === authorId;
  const { page, limit, offset } = paginate(req.query);

  const conds = ['p.author_id=$1', 'p.deleted=false'];
  const params = [authorId];
  if (!isAuthor) conds.push(`p.visibility IN ('public','personal')`);
  if (isAuthor && VISIBILITIES.includes(req.query.visibility)) {
    params.push(req.query.visibility);
    conds.push(`p.visibility=$${params.length}`);
  }

  const whereSql = conds.join(' AND ');
  const total = (await query(`SELECT COUNT(*)::int AS n FROM user_posts p WHERE ${whereSql}`, params)).rows[0].n;
  const { rows } = await query(
    `${LIST_SELECT} WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({ items: rows.map(listItem), page, totalPages: pages(total, limit), total });
}));

/** POST /api/user-posts — создать пост (обязательно только название) */
router.post('/', requireAuth, asyncH(async (req, res) => {
  const title = v.str(req.body.title, { label: 'Название', min: 1, max: 200 });
  const visibility = v.oneOf(req.body.visibility, VISIBILITIES, { label: 'Видимость', optional: true, def: 'public' });
  const content = sanitizePostContent(req.body.content);
  const cover = sanitizeImageUrl(req.body.cover_image);
  const tags = sanitizeTags(req.body.tags);

  const { rows } = await query(
    `INSERT INTO user_posts (author_id, title, content, cover_image, visibility, tags)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`,
    [req.user.id, title, JSON.stringify(content), cover, visibility, tags]
  );
  res.status(201).json({ post: rows[0] });
}));

/** GET /api/user-posts/:id — открыть пост (приватный доступен именно по прямой ссылке) */
router.get('/:id', optionalAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await query(
    `${LIST_SELECT} WHERE p.id=$1 AND p.deleted=false`,
    [id]
  );
  if (!rows[0]) throw notFound('Пост не найден');
  const post = rows[0];

  const isAuthor = !!req.user && req.user.id === post.author_id;
  if (!isAuthor) {
    await query('UPDATE user_posts SET views=views+1 WHERE id=$1', [id]);
    post.views = +post.views + 1;
  }

  // тема, привязанная к посту (для ссылки «Тема: …»)
  let topic = null;
  if (post.topic_id) {
    const t = await query('SELECT id, title FROM topics WHERE id=$1', [post.topic_id]);
    topic = t.rows[0] || null;
  }
  const content = {
    html: post.html || '',
    fonts: (post.content_json && post.content_json.fonts) || [],
  };
  res.json({ post: { ...post, content, is_author: isAuthor }, topic });
}));

/** PATCH /api/user-posts/:id — редактировать свой пост (админ — тоже) */
router.patch('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await query('SELECT * FROM user_posts WHERE id=$1 AND deleted=false', [id]);
  if (!cur.rows[0]) throw notFound('Пост не найден');
  const p = cur.rows[0];
  const isStaff = req.user.role === 'admin';
  if (p.author_id !== req.user.id && !isStaff) throw forbidden('Редактировать можно только свои посты');

  const updates = {};
  if (req.body.title !== undefined) updates.title = v.str(req.body.title, { label: 'Название', min: 1, max: 200 });
  if (req.body.content !== undefined) updates.content = JSON.stringify(sanitizePostContent(req.body.content));
  if (req.body.cover_image !== undefined) updates.cover_image = sanitizeImageUrl(req.body.cover_image);
  if (req.body.visibility !== undefined) updates.visibility = v.oneOf(req.body.visibility, VISIBILITIES, { label: 'Видимость' });
  if (req.body.tags !== undefined) updates.tags = sanitizeTags(req.body.tags);
  if (!Object.keys(updates).length) throw bad('Нет полей для обновления');

  const sets = Object.keys(updates).map((k, i) => `${k}=$${i + 1}`).join(', ');
  const params = [...Object.values(updates), id];
  const { rows } = await query(
    `UPDATE user_posts SET ${sets}, updated_at=now() WHERE id=$${params.length} RETURNING *`,
    params
  );
  // картинки, исчезнувшие при редактировании (обложка / из HTML), освобождаем
  try {
    const { extractUploadUrls, releaseUpload } = require('../utils/uploads');
    const collect = (p2) => new Set([
      ...extractUploadUrls(p2.cover_image),
      ...extractUploadUrls(p2.content && p2.content.html),
    ].filter(Boolean));
    for (const u of collect(p)) if (!collect(rows[0]).has(u)) await releaseUpload(u);
  } catch (e) { console.error('[user-posts] release:', e.message); }
  res.json({ post: rows[0] });
}));

/** DELETE /api/user-posts/:id — удалить пост (автор или модерация) */
router.delete('/:id', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await query('SELECT author_id, cover_image, content FROM user_posts WHERE id=$1', [id]);
  if (!cur.rows[0]) throw notFound('Пост не найден');
  const isStaff = ['moderator', 'admin'].includes(req.user.role);
  if (cur.rows[0].author_id !== req.user.id && !isStaff) throw forbidden();
  await query('DELETE FROM user_posts WHERE id=$1', [id]);
  // обложка и картинки из HTML поста больше не нужны (если не используются где-то ещё)
  const { extractUploadUrls, releaseUpload } = require('../utils/uploads');
  const urls = new Set([
    ...extractUploadUrls(cur.rows[0].cover_image),
    ...extractUploadUrls(cur.rows[0].content && cur.rows[0].content.html),
  ].filter(Boolean));
  for (const u of urls) await releaseUpload(u);
  res.json({ ok: true });
}));

/**
 * POST /api/user-posts/:id/topic — создать тему-обсуждение к посту.
 * Только автор поста, один раз. Название = «Тема: <название поста>».
 */
router.post('/:id/topic', requireAuth, asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await query('SELECT * FROM user_posts WHERE id=$1 AND deleted=false', [id]);
  const post = cur.rows[0];
  if (!post) throw notFound('Пост не найден');
  if (post.author_id !== req.user.id) throw forbidden('Тему к посту может создать только его автор');
  if (post.topic_id) throw bad('Тема для этого поста уже создана');

  // категория: «general» или первая доступная
  const cat = await query('SELECT id FROM categories ORDER BY (slug=\'general\') DESC, position ASC, id ASC LIMIT 1');
  if (!cat.rows[0]) throw bad('Нет категорий для создания темы');

  const title = `Тема: ${post.title}`.slice(0, 200);
  const content = `Обсуждение поста «${post.title}».\n\nЧитать пост: #/post/${post.id}`;
  let slug = slugify(`tema-${post.title}`);
  const dup = await query('SELECT id FROM topics WHERE slug=$1', [slug]);
  if (dup.rows.length) slug = `${slug}-${Date.now().toString(36)}`;

  const t = await query(
    `INSERT INTO topics (category_id, author_id, title, slug, content, post_count)
     VALUES ($1,$2,$3,$4,$5,1) RETURNING *`,
    [cat.rows[0].id, req.user.id, title, slug, content]
  );
  await query('UPDATE user_posts SET topic_id=$1, updated_at=now() WHERE id=$2', [t.rows[0].id, id]);
  res.status(201).json({ topic: t.rows[0] });
}));

module.exports = router;