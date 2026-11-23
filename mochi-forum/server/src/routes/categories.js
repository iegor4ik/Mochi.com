const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { v } = require('../middleware/validate');
const { asyncH, notFound, bad, slugify } = require('../utils/helpers');

const router = express.Router();

/** GET /api/categories — список со счётчиками */
router.get('/', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM topics t WHERE t.category_id=c.id) AS topic_count,
       COALESCE((SELECT SUM(t.post_count)::int FROM topics t WHERE t.category_id=c.id), 0) AS post_count,
       (SELECT MAX(t.last_activity_at) FROM topics t WHERE t.category_id=c.id) AS last_activity
     FROM categories c
     ORDER BY c.position, c.id`
  );
  res.json({ items: rows });
}));

/** POST /api/categories — создать (admin) */
router.post('/', requireAuth, requireRole('admin'), asyncH(async (req, res) => {
  const name = v.str(req.body.name, { label: 'Название', min: 2, max: 100 });
  const description = v.str(req.body.description, { label: 'Описание', max: 500, optional: true });
  const icon = v.str(req.body.icon, { label: 'Иконка', max: 8, optional: true, def: '🍡' });
  const color = v.str(req.body.color, { label: 'Цвет', max: 7, optional: true, pattern: /^#[0-9a-fA-F]{6}$/ });
  const position = v.int(req.body.position, { label: 'Позиция', min: 0, max: 999, optional: true }) ?? 0;
  let slug = slugify(v.str(req.body.slug, { label: 'Slug', min: 2, max: 100, optional: true }) || name);

  const dup = await query('SELECT id FROM categories WHERE slug=$1', [slug]);
  if (dup.rows.length) slug = `${slug}-${Date.now().toString(36)}`;

  const { rows } = await query(
    `INSERT INTO categories (name, slug, description, icon, color, position)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, slug, description, icon, color, position]
  );
  res.status(201).json({ category: rows[0] });
}));

/** PATCH /api/categories/:id — изменить (admin) */
router.patch('/:id', requireAuth, requireRole('admin'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await query('SELECT * FROM categories WHERE id=$1', [id]);
  if (!cur.rows[0]) throw notFound('Категория не найдена');

  const name = req.body.name !== undefined ? v.str(req.body.name, { label: 'Название', min: 2, max: 100 }) : cur.rows[0].name;
  const description = req.body.description !== undefined ? v.str(req.body.description, { label: 'Описание', max: 500 }) : cur.rows[0].description;
  const icon = req.body.icon !== undefined ? v.str(req.body.icon, { label: 'Иконка', max: 8 }) : cur.rows[0].icon;
  const color = req.body.color !== undefined ? v.str(req.body.color, { label: 'Цвет', max: 7, pattern: /^#[0-9a-fA-F]{6}$/ }) : cur.rows[0].color;
  const position = req.body.position !== undefined ? v.int(req.body.position, { label: 'Позиция', min: 0, max: 999 }) : cur.rows[0].position;

  const { rows } = await query(
    `UPDATE categories SET name=$1, description=$2, icon=$3, color=$4, position=$5 WHERE id=$6 RETURNING *`,
    [name, description, icon, color, position, id]
  );
  res.json({ category: rows[0] });
}));

/** DELETE /api/categories/:id — удалить (admin). Темы удалятся каскадом. */
router.delete('/:id', requireAuth, requireRole('admin'), asyncH(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = await query('DELETE FROM categories WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw notFound('Категория не найдена');
  res.json({ ok: true });
}));

module.exports = router;