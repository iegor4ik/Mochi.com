const { bad } = require('./helpers');

/** Валидаторы полей (копия паттерна основного сервера). Возвращают значение или бросают ApiError(400). */
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

  int(value, { label = 'Значение', min = -Infinity, max = Infinity, optional = false, def = null } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return def;
      throw bad(`${label}: обязательно`);
    }
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) throw bad(`${label}: должно быть числом`);
    if (n < min || n > max) throw bad(`${label}: допустимо от ${min} до ${max}`);
    return n;
  },

  num(value, { label = 'Значение', min = -Infinity, max = Infinity, optional = false, def = null } = {}) {
    if (value === undefined || value === null || value === '') {
      if (optional) return def;
      throw bad(`${label}: обязательно`);
    }
    const n = Number(value);
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

module.exports = { v };
