const { bad } = require('../utils/helpers');

/** Валидаторы полей. Каждый возвращает очищенное значение или бросает ApiError(400). */
const v = {
  str(value, { label = 'Поле', min = 1, max = 10000, pattern = null, optional = false, def = '' } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return def;
      throw bad(`${label}: обязательно для заполнения`);
    }
    const s = String(value).trim();
    if (s.length < min) throw bad(`${label}: минимум ${min} символов`);
    if (s.length > max) throw bad(`${label}: максимум ${max} символов`);
    if (pattern && !pattern.test(s)) throw bad(`${label}: недопустимый формат`);
    return s;
  },

  email(value, { label = 'Email', optional = false } = {}) {
    const s = v.str(value, { label, max: 255, optional });
    if (!optional && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad(`${label}: некорректный адрес`);
    return s.toLowerCase();
  },

  int(value, { label = 'Значение', min = -Infinity, max = Infinity, optional = false } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return null;
      throw bad(`${label}: обязательно`);
    }
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) throw bad(`${label}: должно быть числом`);
    if (n < min || n > max) throw bad(`${label}: допустимо от ${min} до ${max}`);
    return n;
  },

  oneOf(value, list, { label = 'Значение', optional = false, def = null } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return def;
      throw bad(`${label}: обязательно`);
    }
    if (!list.includes(value)) throw bad(`${label}: допустимые значения — ${list.join(', ')}`);
    return value;
  },

  bool(value, def = false) {
    if (value === undefined || value === null) return def;
    return value === true || value === 'true' || value === 1;
  },
};

/** Простое ограничение частоты запросов (in-memory) */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 30, message = 'Слишком много запросов, попробуйте позже' } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, arr] of hits) {
      const fresh = arr.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return next(bad(message));
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

module.exports = { v, rateLimit };