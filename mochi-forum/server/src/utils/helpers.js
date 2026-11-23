const { pool } = require('../config/db');

/** Класс API-ошибок с HTTP-статусом */
class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const bad = (msg, extra) => new ApiError(400, msg, extra);
const notFound = (msg = 'Не найдено') => new ApiError(404, msg);
const forbidden = (msg = 'Недостаточно прав', extra) => new ApiError(403, msg, extra);
const unauthorized = (msg = 'Требуется авторизация') => new ApiError(401, msg);

/** Обёртка для асинхронных обработчиков */
const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Пагинация из query-параметров */
function paginate(q, defLimit = 20, maxLimit = 50) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function pages(total, limit) {
  return Math.max(1, Math.ceil(total / limit));
}

const RU_MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',
  ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',і:'i',ї:'yi',є:'ye',ґ:'g',
};

/** Транслитерация + slug */
function slugify(str) {
  return String(str)
    .toLowerCase()
    .split('')
    .map((ch) => RU_MAP[ch] !== undefined ? RU_MAP[ch] : ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'topic';
}

/**
 * Создать уведомление (не бросает ошибок — уведомления не критичны).
 * Первый аргумент игнорируется (совместимость со старыми вызовами).
 */
async function notify(_db, { userId, type, actorId = null, entityType = null, entityId = null, payload = {} }) {
  if (!userId || userId === actorId) return;
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, actor_id, entity_type, entity_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, type, actorId, entityType, entityId, JSON.stringify(payload)]
    );
  } catch (e) {
    console.error('[notify]', e.message);
  }
}

/** Валидация объекта темы оформления */
function sanitizeTheme(t) {
  const out = {};
  if (!t || typeof t !== 'object') return { mode: 'dark' };
  if (['light', 'dark'].includes(t.mode)) out.mode = t.mode;
  else out.mode = 'dark';
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (typeof t.accent === 'string' && hex.test(t.accent)) out.accent = t.accent;
  if (typeof t.accent2 === 'string' && hex.test(t.accent2)) out.accent2 = t.accent2;
  if (Number.isFinite(+t.radius)) out.radius = Math.min(28, Math.max(4, +t.radius));
  if (Number.isFinite(+t.fontScale)) out.fontScale = Math.min(1.25, Math.max(0.85, +t.fontScale));
  if (typeof t.gradient === 'boolean') out.gradient = t.gradient;
  return out;
}

module.exports = { ApiError, bad, notFound, forbidden, unauthorized, asyncH, paginate, pages, slugify, notify, sanitizeTheme };