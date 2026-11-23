/**
 * Внутренний эндпоинт для игровых сервисов (game-server).
 * Отдаёт МИНИМУМ данных профиля: id, username, avatar, role, is_banned.
 * Доступ: JWT форума (как у обычного пользователя) + опционально X-Internal-Key.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { isBanned } = require('../middleware/auth');
const { asyncH, unauthorized, forbidden, notFound } = require('../utils/helpers');
const { v } = require('../middleware/validate');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/** GET /api/internal/user/:id — минимальный профиль для игрового сервера */
router.get('/user/:id', asyncH(async (req, res) => {
  // если ключ задан — требуем его от вызывающего сервиса
  if (INTERNAL_API_KEY && req.headers['x-internal-key'] !== INTERNAL_API_KEY) {
    throw forbidden('Недостаточно прав');
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    throw unauthorized('Требуется авторизация');
  }
  const id = v.int(req.params.id, { label: 'id', min: 1 });
  if (payload.id !== id) throw forbidden('Недостаточно прав');
  const { rows } = await query(
    'SELECT id, username, avatar_url, role, ban_reason, banned_until FROM users WHERE id = $1',
    [id]
  );
  const u = rows[0];
  if (!u) throw notFound('Пользователь не найден');
  // только минимум (§8 ТЗ): никаких email/bio/etc.
  res.json({
    user: {
      id: u.id,
      username: u.username,
      avatar: u.avatar_url,
      role: u.role,
      is_banned: isBanned(u),
    },
  });
}));

module.exports = router;
