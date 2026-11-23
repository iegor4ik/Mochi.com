const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const { unauthorized, forbidden } = require('../utils/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// троттлинг обновления last_seen_at (не чаще раза в минуту на пользователя)
const lastSeenWrites = new Map();

/** Обновить «был(а) в сети» (троттленно) */
function touchLastSeen(userId) {
  const now = Date.now();
  const prev = lastSeenWrites.get(userId) || 0;
  if (now - prev < 60 * 1000) return;
  lastSeenWrites.set(userId, now);
  // заодно чистим старые записи
  if (lastSeenWrites.size > 5000) {
    for (const [k, t] of lastSeenWrites) {
      if (now - t > 10 * 60 * 1000) lastSeenWrites.delete(k);
    }
  }
  query('UPDATE users SET last_seen_at=now() WHERE id=$1', [userId]).catch(() => {});
}

function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

/** Загрузить пользователя по id (свежие роль/бан из БД) */
async function loadUser(id) {
  const { rows } = await query(
    `SELECT id, username, email, role, avatar_url, bio, signature, theme, dm_policy,
            banned_until, ban_reason, created_at
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

function isBanned(user) {
  if (!user.ban_reason) return false;
  if (!user.banned_until) return true; // перманентный бан
  return new Date(user.banned_until) > new Date();
}

/** Обязательная авторизация */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized('Требуется авторизация');
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      throw unauthorized('Сессия недействительна, войдите заново');
    }
    const user = await loadUser(payload.id);
    if (!user) throw unauthorized('Пользователь не найден');
    if (isBanned(user)) {
      throw forbidden(
        `Вы забанены${user.banned_until ? ` до ${new Date(user.banned_until).toLocaleString('ru-RU')}` : ' навсегда'}. Причина: ${user.ban_reason}`,
        { banned: true }
      );
    }
    touchLastSeen(user.id);
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Опциональная авторизация (гость или пользователь) */
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await loadUser(payload.id);
        if (user && !isBanned(user)) { touchLastSeen(user.id); req.user = user; }
        else if (user && isBanned(user)) req.user = { ...user, read_only: true };
      } catch { /* гость */ }
    }
    next();
  } catch (e) {
    next(e);
  }
}

/** Проверка роли */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

module.exports = { signToken, requireAuth, optionalAuth, requireRole, isBanned };