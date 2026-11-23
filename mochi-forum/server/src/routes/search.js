const express = require('express');
const { query } = require('../config/db');
const { asyncH, bad, paginate, pages } = require('../utils/helpers');

const router = express.Router();

/** GET /api/search?q=&type=topics|posts|users|all (+ #тег — поиск постов по хэштегу) */
router.get('/', asyncH(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) throw bad('Поисковый запрос: минимум 2 символа');
  if (q.length > 100) throw bad('Поисковый запрос слишком длинный (макс. 100)');

  const type = ['topics', 'posts', 'users', 'chats', 'all'].includes(req.query.type) ? req.query.type : 'all';
  const like = `%${q}%`;
  const out = {};

  // запрос вида «#tag» — ищем публичные посты профиля по хэштегу
  const isTagQuery = q.startsWith('#');
  const tag = isTagQuery ? q.slice(1).trim().toLowerCase() : null;

  if (isTagQuery && tag) {
    const total = (
      await query(
        `SELECT COUNT(*)::int AS n FROM user_posts
         WHERE deleted=false AND visibility='public' AND tags @> ARRAY[$1::text]`,
        [tag]
      )
    ).rows[0].n;
    const { rows } = await query(
      `SELECT up.id, up.title, up.cover_image, up.tags, up.views, up.created_at,
              u.username AS author_username, u.avatar_url AS author_avatar
       FROM user_posts up JOIN users u ON u.id=up.author_id
       WHERE up.deleted=false AND up.visibility='public' AND up.tags @> ARRAY[$1::text]
       ORDER BY up.created_at DESC LIMIT 20`,
      [tag]
    );
    out.tagPosts = { items: rows, total, tag };
  }
  if (isTagQuery && !tag) throw bad('Укажите тег после решётки, например #моти');

  // групповые чаты (чатсы): по названию/описанию или по #тегу
  if (type === 'chats' || type === 'all') {
    const chatConds = [`c.kind <> 'private'`];
    const chatParams = [];
    if (isTagQuery && tag) {
      chatParams.push(tag);
      chatConds.push(`c.tags @> ARRAY[$${chatParams.length}::text]`);
    } else {
      chatParams.push(like);
      chatConds.push(`(c.name ILIKE $${chatParams.length} OR c.description->>'html' ILIKE $${chatParams.length})`);
    }
    const chatWhere = chatConds.join(' AND ');
    const total = (
      await query(`SELECT COUNT(*)::int AS n FROM gchats c WHERE ${chatWhere}`, chatParams)
    ).rows[0].n;
    const { rows } = await query(
      `SELECT c.id, c.kind, c.name, c.photo, c.tags, c.member_count, c.created_at,
              c.description->>'html' AS html,
              u.username AS owner_username, u.avatar_url AS owner_avatar
       FROM gchats c JOIN users u ON u.id=c.owner_id
       WHERE ${chatWhere}
       ORDER BY c.member_count DESC, c.created_at DESC LIMIT 20`,
      chatParams
    );
    out.chats = {
      items: rows.map((c) => ({
        ...c,
        excerpt: String(c.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
        html: undefined,
      })),
      total,
    };
  }

  // для тег-запросов отдаём результат сразу (посты + чатсы по тегу)
  if (isTagQuery && tag) return res.json({ q, ...out });

  if (type === 'topics' || type === 'all') {
    const total = (
      await query(`SELECT COUNT(*)::int AS n FROM topics WHERE title ILIKE $1 OR content ILIKE $1`, [like])
    ).rows[0].n;
    const { rows } = await query(
      `SELECT t.id, t.title, t.content, t.post_count, t.views, t.created_at,
              u.username AS author_username, u.avatar_url AS author_avatar,
              c.name AS category_name, c.slug AS category_slug, c.color AS category_color
       FROM topics t JOIN users u ON u.id=t.author_id JOIN categories c ON c.id=t.category_id
       WHERE t.title ILIKE $1 OR t.content ILIKE $1
       ORDER BY t.last_activity_at DESC LIMIT 20`,
      [like]
    );
    out.topics = { items: rows, total };
  }

  if (type === 'posts' || type === 'all') {
    const total = (
      await query(`SELECT COUNT(*)::int AS n FROM posts WHERE deleted=false AND content ILIKE $1`, [like])
    ).rows[0].n;
    const { rows } = await query(
      `SELECT p.id, p.content, p.created_at, p.topic_id, t.title AS topic_title,
              u.username AS author_username, u.avatar_url AS author_avatar
       FROM posts p JOIN users u ON u.id=p.author_id JOIN topics t ON t.id=p.topic_id
       WHERE p.deleted=false AND p.content ILIKE $1
       ORDER BY p.created_at DESC LIMIT 20`,
      [like]
    );
    out.posts = { items: rows, total };
  }

  if (type === 'users' || type === 'all') {
    const total = (
      await query(`SELECT COUNT(*)::int AS n FROM users WHERE username ILIKE $1`, [like])
    ).rows[0].n;
    const { rows } = await query(
      `SELECT id, username, role, avatar_url, bio, created_at FROM users
       WHERE username ILIKE $1 ORDER BY username LIMIT 20`,
      [like]
    );
    out.users = { items: rows, total };
  }

  // публичные посты профиля по названию/тексту (обычный поиск)
  if (type === 'all') {
    const total = (
      await query(
        `SELECT COUNT(*)::int AS n FROM user_posts
         WHERE deleted=false AND visibility='public' AND (title ILIKE $1 OR content->>'html' ILIKE $1)`,
        [like]
      )
    ).rows[0].n;
    const { rows } = await query(
      `SELECT up.id, up.title, up.cover_image, up.tags, up.created_at, up.content->>'html' AS html,
              u.username AS author_username, u.avatar_url AS author_avatar
       FROM user_posts up JOIN users u ON u.id=up.author_id
       WHERE up.deleted=false AND up.visibility='public' AND (up.title ILIKE $1 OR up.content->>'html' ILIKE $1)
       ORDER BY up.created_at DESC LIMIT 20`,
      [like]
    );
    out.articles = { items: rows, total };
  }

  res.json({ q, ...out });
}));

module.exports = router;