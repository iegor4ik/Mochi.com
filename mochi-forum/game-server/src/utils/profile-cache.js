/**
 * Кэш профилей пользователей основного сайта.
 * Профиль берётся у MAIN_API_URL (/api/internal/user/:id) и держится в памяти
 * 5–15 минут: активные игровые сессии переживают недоступность основного API,
 * новые подключения при недоступности — отклоняются с понятной ошибкой.
 */
const MAIN_API_URL = process.env.MAIN_API_URL || 'http://localhost:3000';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const TTL = 10 * 60 * 1000; // 10 минут (вилка из ТЗ: 5–15 мин)

const cache = new Map(); // userId → { data, ts }

/** Загрузить профиль с основного API (без кэша). Нужен JWT самого пользователя —
 *  внутренний эндпоинт форума проверяет его как обычную авторизацию. */
async function fetchProfile(userId, token) {
  const headers = { Authorization: `Bearer ${token}` };
  if (INTERNAL_API_KEY) headers['X-Internal-Key'] = INTERNAL_API_KEY;
  let res;
  try {
    res = await fetch(`${MAIN_API_URL}/api/internal/user/${userId}`, { headers });
  } catch {
    const e = new Error('Сервис форума временно недоступен, попробуйте позже'); e.status = 503; throw e;
  }
  const data = await res.json().catch(() => ({}));
  const user = data && data.user;
  if (!res.ok || !user) {
    const e = new Error((data && data.error) || 'Профиль недоступен');
    e.status = res.status === 404 ? 401 : 502;
    e.banned = !!(data && data.banned);
    throw e;
  }
  return user; // { id, username, avatar, role, is_banned }
}

/**
 * Получить профиль (из кэша или с основного API).
 * token — JWT пользователя (нужен только при промахе кэша).
 * force=true — обновить кэш, минуя TTL (периодическая перепроверка банов).
 */
async function getProfile(userId, token, { force = false } = {}) {
  const hit = cache.get(userId);
  if (!force && hit && Date.now() - hit.ts < TTL) return hit.data;
  if (!token) {
    // токена нет (например, перепроверка бана после потери сессии) — отдаём кэш, даже просроченный
    if (hit) return hit.data;
    const e = new Error('Профиль недоступен'); e.status = 401; throw e;
  }
  const data = await fetchProfile(userId, token);
  cache.set(userId, { data, ts: Date.now() });
  if (cache.size > 10000) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.ts > TTL) cache.delete(k);
  }
  return data;
}

module.exports = { getProfile };
