const jwt = require('jsonwebtoken');

// Тот ЖЕ секрет, что у основного сайта (JWT_SECRET в server/.env)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

/**
 * Проверить JWT форума (только проверка подписи и срока — регистрации в игре нет).
 * Бросает ошибку, если токен невалиден. Возвращает payload { id }.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    const e = new Error('Требуется авторизация'); e.status = 401; throw e;
  }
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    const e = new Error('Сессия недействительна, войдите на форум заново'); e.status = 401; throw e;
  }
}

/** Достать Bearer-токен из заголовка */
function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Express-мидлварь: обязательная авторизация (кладёт req.userId) */
function requireAuth(req, res, next) {
  try {
    const payload = verifyToken(bearerToken(req));
    req.userId = payload.id;
    next();
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
  }
}

module.exports = { verifyToken, bearerToken, requireAuth, JWT_SECRET };
