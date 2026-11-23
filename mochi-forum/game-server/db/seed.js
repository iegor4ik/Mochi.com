/**
 * Сид игровых данных: локации hub («Хаб») и room2 («Пустая комната») + объекты.
 * Идемпотентен: локации — INSERT ... ON CONFLICT (slug) DO NOTHING;
 * объекты — вставляются только если такого же (location, def_key, x, y) ещё нет.
 * Повторный запуск ничего не ломает и не дублирует.
 */
const { pool, query } = require('../src/config/db');

// Встроенный формат карты (см. ТЗ §4): стены, двери-переходы, точки спавна
const HUB_MAP = {
  width: 1600,
  height: 900,
  walls: [
    { x: 0, y: 0, w: 1600, h: 24 },      // верхняя граница
    { x: 0, y: 876, w: 1600, h: 24 },    // нижняя граница
    { x: 0, y: 0, w: 24, h: 900 },       // левая граница
    { x: 1576, y: 0, w: 24, h: 900 },    // правая граница
    { x: 700, y: 24, w: 24, h: 380 },    // внутренняя стена (проверка коллизий)
    { x: 700, y: 560, w: 24, h: 316 },   // внутренняя стена (проход внизу/вверху)
    { x: 1100, y: 160, w: 220, h: 24 },  // уголок-«помост»
  ],
  exits: [
    // дверь в room2 (спавн в комнате — «default»)
    { id: 'door-to-room2', x: 1496, y: 416, w: 48, h: 64, to: 'room2', spawn: 'default' },
  ],
  spawns: [
    { id: 'default', x: 200, y: 450 },
    { id: 'from-room2', x: 1400, y: 450 }, // точка возврата из room2 (у двери, но не в ней)
  ],
};

const ROOM2_MAP = {
  width: 800,
  height: 600,
  walls: [
    { x: 0, y: 0, w: 800, h: 24 },
    { x: 0, y: 576, w: 800, h: 24 },
    { x: 0, y: 0, w: 24, h: 600 },
    { x: 776, y: 0, w: 24, h: 600 },
    { x: 300, y: 200, w: 200, h: 24 },
  ],
  exits: [
    // дверь обратно в хаб (спавн в хабе — «from-room2»)
    { id: 'door-to-hub', x: 376, y: 496, w: 48, h: 64, to: 'hub', spawn: 'from-room2' },
  ],
  spawns: [
    { id: 'default', x: 120, y: 120 },
  ],
};

const LOCATIONS = [
  { slug: 'hub', name: 'Хаб', map: HUB_MAP },
  { slug: 'room2', name: 'Пустая комната', map: ROOM2_MAP },
];

// Демо-объекты: [slug локации, тип, x, y]
// item  — можно взять в руки (wrench/screwdriver — одноручные, crowbar/sledge — двуручные)
// pull  — можно только тащить (crate/barrel)
const OBJECTS = [
  ['hub', 'ball', 320, 300],
  ['hub', 'ball', 360, 340],
  ['hub', 'box', 500, 260],
  ['hub', 'box', 540, 300],
  ['hub', 'stone', 900, 520],
  ['hub', 'ball', 960, 560],
  ['hub', 'wrench', 420, 620],
  ['hub', 'screwdriver', 470, 660],
  ['hub', 'crowbar', 1150, 320],
  ['hub', 'sledge', 1210, 380],
  ['hub', 'crate', 1300, 660],
  ['hub', 'barrel', 1360, 710],
  ['room2', 'box', 500, 420],
  ['room2', 'wrench', 200, 300],
  ['room2', 'crate', 600, 200],
];

async function run() {
  for (const loc of LOCATIONS) {
    const { rows } = await query(
      `INSERT INTO locations (slug, name, map)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [loc.slug, loc.name, JSON.stringify(loc.map)]
    );
    if (rows.length) console.log(`Локация «${loc.name}» (${loc.slug}) создана (#${rows[0].id})`);
    else console.log(`Локация «${loc.slug}» уже существует — пропускаю`);
  }

  for (const [slug, defKey, x, y] of OBJECTS) {
    const { rowCount } = await query(
      `INSERT INTO world_objects (location_id, def_key, x, y)
       SELECT l.id, $2::varchar, $3::real, $4::real FROM locations l
       WHERE l.slug = $1::varchar
         AND NOT EXISTS (
           SELECT 1 FROM world_objects o
           WHERE o.location_id = l.id AND o.def_key = $2::varchar
             AND o.x = $3::real AND o.y = $4::real
         )`,
      [slug, defKey, x, y]
    );
    if (rowCount) console.log(`Объект ${defKey} (${x},${y}) в ${slug} создан`);
  }

  const { rows } = await query(
    `SELECT l.slug, count(o.id) AS objects
     FROM locations l LEFT JOIN world_objects o ON o.location_id = l.id
     GROUP BY l.slug ORDER BY l.slug`
  );
  for (const r of rows) console.log(`Итог: ${r.slug} — объектов: ${r.objects}`);
  await pool.end();
}

run().catch((e) => {
  console.error('[seed] fatal:', e.message);
  process.exit(1);
});
