const express = require('express');
const { query } = require('../config/db');
const { asyncH, notFound } = require('../utils/helpers');

const router = express.Router();

/** GET /api/locations — список локаций (для будущего лобби) */
router.get('/', asyncH(async (req, res) => {
  const { rows } = await query('SELECT slug, name, created_at FROM locations ORDER BY id');
  res.json({ locations: rows });
}));

/** GET /api/locations/:slug — карта одной локации */
router.get('/:slug', asyncH(async (req, res) => {
  const { rows } = await query('SELECT slug, name, map FROM locations WHERE slug = $1', [req.params.slug]);
  if (!rows.length) throw notFound('Локация не найдена');
  res.json({ location: rows[0] });
}));

module.exports = router;
