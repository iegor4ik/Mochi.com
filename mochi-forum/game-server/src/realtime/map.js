/**
 * Карты локаций: загрузка из БД с кэшем, валидация встроенного формата,
 * коллизии «круг vs стены», точки спавна. Загрузка пользовательских Tiled-карт —
 * за пределами MVP, но валидатор JSON уже работает (см. validateMapObject).
 */
const { query } = require('../config/db');
const { bad } = require('../utils/helpers');
const { v } = require('../utils/validate');

const CACHE_TTL = 60 * 1000; // карта меняется редко — кэш на минуту
const cache = new Map();     // slug → { data, ts }

/** Число с границами (для полей карты) */
function num(value, { label, min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`Карта: ${label} должно быть числом`);
  if (n < min || n > max) throw bad(`Карта: ${label} вне допустимого диапазона`);
  return n;
}

/**
 * Валидация карты во встроенном формате:
 * { width, height, walls: [{x,y,w,h}], exits: [{id,x,y,w,h,to,spawn}], spawns: [{id,x,y}] }
 * (проверка до записи в JSONB — никаких исполняемых полей)
 */
function validateMapObject(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw bad('Карта: ожидается JSON-объект');
  const out = {
    width: num(map.width, { label: 'width', min: 320, max: 8000 }),
    height: num(map.height, { label: 'height', min: 240, max: 8000 }),
    walls: [],
    exits: [],
    spawns: [],
  };
  if (!Array.isArray(map.walls) || map.walls.length > 1000) throw bad('Карта: некорректный список стен');
  for (const w of map.walls) {
    out.walls.push({
      x: num(w.x, { label: 'wall.x', min: -10000, max: 10000 }),
      y: num(w.y, { label: 'wall.y', min: -10000, max: 10000 }),
      w: num(w.w, { label: 'wall.w', min: 1, max: 8000 }),
      h: num(w.h, { label: 'wall.h', min: 1, max: 8000 }),
    });
  }
  if (map.exits != null) {
    if (!Array.isArray(map.exits) || map.exits.length > 100) throw bad('Карта: некорректный список дверей');
    for (const e of map.exits) {
      out.exits.push({
        id: v.str(e.id, { label: 'exit.id', min: 1, max: 64, pattern: /^[a-zA-Z0-9_-]+$/ }),
        x: num(e.x, { label: 'exit.x', min: -10000, max: 10000 }),
        y: num(e.y, { label: 'exit.y', min: -10000, max: 10000 }),
        w: num(e.w, { label: 'exit.w', min: 1, max: 800 }),
        h: num(e.h, { label: 'exit.h', min: 1, max: 800 }),
        to: v.str(e.to, { label: 'exit.to', min: 1, max: 64 }),
        spawn: v.str(e.spawn, { label: 'exit.spawn', min: 1, max: 64, optional: true, def: 'default' }),
      });
    }
  }
  if (map.spawns != null) {
    if (!Array.isArray(map.spawns) || map.spawns.length > 100) throw bad('Карта: некорректный список спавнов');
    for (const s of map.spawns) {
      out.spawns.push({
        id: v.str(s.id, { label: 'spawn.id', min: 1, max: 64, pattern: /^[a-zA-Z0-9_-]+$/ }),
        x: num(s.x, { label: 'spawn.x', min: 0, max: 10000 }),
        y: num(s.y, { label: 'spawn.y', min: 0, max: 10000 }),
      });
    }
  }
  return out;
}

/** Загрузить локацию (кэш в памяти → БД). Возвращает {id, slug, name, map} или null. */
async function getLocation(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  const { rows } = await query('SELECT id, slug, name, map FROM locations WHERE slug = $1', [slug]);
  if (!rows.length) return null;
  const row = rows[0];
  const map = validateMapObject(row.map); // кривая карта в БД → понятная ошибка
  const data = { id: row.id, slug: row.slug, name: row.name, map };
  cache.set(slug, { data, ts: Date.now() });
  return data;
}

/** Задевает ли круг стены карты */
function circleHitsWalls(map, x, y, r) {
  for (const w of map.walls) {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Кламп позиции в границы карты */
function clampToBounds(map, x, y, r) {
  return {
    x: Math.min(map.width - r, Math.max(r, x)),
    y: Math.min(map.height - r, Math.max(r, y)),
  };
}

/**
 * Авторитарное перемещение круга из (x,y) к (nx,ny) со скольжением вдоль стен
 * (ось X и ось Y проверяются отдельно). Возвращает фактическую позицию.
 */
function moveCircle(map, x, y, nx, ny, r) {
  let px = circleHitsWalls(map, nx, y, r) ? x : nx;
  let py = circleHitsWalls(map, px, ny, r) ? y : ny;
  ({ x: px, y: py } = clampToBounds(map, px, py, r));
  return { x: px, y: py };
}

/** Точка спавна по id (или первая/центр карты), вынесенная из стен */
function getSpawn(map, spawnId) {
  let s = (map.spawns || []).find((p) => p.id === spawnId) || (map.spawns || [])[0];
  if (!s) s = { x: map.width / 2, y: map.height / 2 };
  return findFreeSpot(map, s.x, s.y, 22);
}

/** Ближайшая свободная (не в стене, в границах) точка — поиск по спирали */
function findFreeSpot(map, x, y, r) {
  if (!circleHitsWalls(map, x, y, r)) {
    const c = clampToBounds(map, x, y, r);
    if (c.x === x && c.y === y) return { x, y };
  }
  for (let d = 8; d <= 320; d += 8) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const sx = Math.round(x + Math.cos(a) * d);
      const sy = Math.round(y + Math.sin(a) * d);
      if (sx < r || sy < r || sx > map.width - r || sy > map.height - r) continue;
      if (!circleHitsWalls(map, sx, sy, r)) return { x: sx, y: sy };
    }
  }
  return { x: map.width / 2, y: map.height / 2 };
}

module.exports = {
  getLocation,
  validateMapObject,
  circleHitsWalls,
  clampToBounds,
  moveCircle,
  getSpawn,
  findFreeSpot,
};
