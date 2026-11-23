const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { asyncH, notFound } = require('../utils/helpers');
const { v } = require('../utils/validate');

const router = express.Router();

/** GET /api/locations/:slug/chat?limit=20 — история чата локации */
router.get('/:slug/chat', requireAuth, asyncH(async (req, res) => {
  const slug = v.str(req.params.slug, { label: 'Локация', max: 64 });
  const limit = v.int(req.query.limit, { label: 'Лимит', min: 1, max: 50, optional: true, def: 20 });
  const { rows: loc } = await query('SELECT id FROM locations WHERE slug = $1', [slug]);
  if (!loc.length) throw notFound('Локация не найдена');
  const { rows } = await query(
    `SELECT user_id, username, text, created_at
     FROM chat_messages WHERE location_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [loc[0].id, limit]
  );
  res.json({ messages: rows.reverse() }); // старые сверху
}));

module.exports = router;
