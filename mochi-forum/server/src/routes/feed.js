const express = require('express');
const { query } = require('../config/db');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { asyncH, unauthorized, paginate, pages } = require('../utils/helpers');
const { excerptFromHtml } = require('../utils/post-utils');

const router = express.Router();

const TABS = {
  recent: 'p.created_at DESC',
  popular: 'p.views DESC, p.created_at DESC',
  following: 'p.created_at DESC',
};

/**
 * GET /api/feed?tab=recent|popular|following&page=&limit=
 * Лента постов: недавние / популярные / подписки.
 * В ленту попадают только публичные посты.
 */
router.get('/', optionalAuth, asyncH(async (req, res) => {
  const tab = TABS[req.query.tab] ? req.query.tab : 'recent';
  const { page, limit, offset } = paginate(req.query);

  const conds = [`p.deleted = false`, `p.visibility = 'public'`];
  const params = [];
  if (tab === 'following') {
    if (!req.user) throw unauthorized('Войдите, чтобы видеть ленту подписок');
    params.push(req.user.id);
    conds.push(`p.author_id IN (SELECT following_id FROM follows WHERE follower_id=$${params.length})`);
  }

  const whereSql = conds.join(' AND ');
  const total = (await query(`SELECT COUNT(*)::int AS n FROM user_posts p WHERE ${whereSql}`, params)).rows[0].n;
  const { rows } = await query(
    `SELECT p.id, p.title, p.cover_image, p.tags, p.views, p.created_at,
            p.content->>'html' AS html,
            u.username AS author_username, u.avatar_url AS author_avatar, u.role AS author_role
     FROM user_posts p JOIN users u ON u.id = p.author_id
     WHERE ${whereSql}
     ORDER BY ${TABS[tab]}
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  res.json({
    tab,
    items: rows.map((r) => ({ ...r, excerpt: excerptFromHtml(r.html, 200), html: undefined })),
    page,
    totalPages: pages(total, limit),
    total,
  });
}));

/** POST /api/feed не предусмотрен — но оставляем роут аутентификации для консистентности */
router.use('/', (req, res, next) => next());

module.exports = router;