/**
 * Генератор PNG-плейсхолдеров для манифеста assets.js (ТЗ §9).
 * Только встроенные модули (zlib): минимальный PNG-энкодер.
 * Спрайты рисуются попиксельно: сферический шейдинг с бликом, объём,
 * сглаженные края через альфа-канал (без «битых пикселей»).
 * Запуск: node scripts/gen-placeholders.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', '..', 'public', 'js', 'game', 'assets');

// ---------- базовые утилиты ----------

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t); // smoothstep

/** Цвет [r,g,b] с яркостью k и белым бликом s */
function shade([r, g, b], k, s = 0) {
  const mix = (c) => Math.min(255, Math.round(c * k + 255 * s));
  return [mix(r), mix(g), mix(b)];
}

// __SPRITES__

/** Сфера (мяч): попиксельный шейдинг + блик сверху-слева + мягкий край */
function drawBall(size) {
  const px = new Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const r = size / 2 - 1;
  const base = [255, 92, 138]; // моти-розовый
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      const i = y * size + x;
      if (d >= r + 1) { px[i] = [0, 0, 0, 0]; continue; }
      // нормаль сферы
      const nz = Math.sqrt(Math.max(0, r * r - dx * dx - dy * dy)) / r;
      const nx = dx / r;
      const ny = dy / r;
      // свет сверху-слева-спереди
      let L = clamp01(nx * -0.45 + ny * -0.5 + nz * 0.74);
      let k = 0.55 + 0.55 * L;                 // объём
      const s = Math.pow(L, 14) * 0.9;         // блик
      const [rr, gg, bb] = shade(base, k, s);
      const outline = d > r - 1.6 ? 0.82 : 1;  // затемнение контура
      const edge = clamp01((r - d) / 1.2);     // сглаженный край
      px[i] = [
        Math.round(rr * outline),
        Math.round(gg * outline),
        Math.round(bb * outline),
        Math.round(255 * smooth(edge)),
      ];
    }
  }
  return px;
}

/** Ящик: деревянный, объёмный, с фасками и планками */
function drawBox(size) {
  const px = new Array(size * size);
  const b = 2; // фаска
  const base = [201, 162, 107];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const aa = clamp01((edge + 0.5) / 1.2); // сглаженный контур
      const tx = clamp01(x / (size - 1));
      const ty = clamp01(y / (size - 1));
      let k = 1.12 - 0.3 * (tx * 0.4 + ty * 0.6);
      if (edge < b) k *= (edge === Math.min(x, y)) ? 1.18 : 0.78; // фаски
      if (y === Math.round(size * 0.35) || y === Math.round(size * 0.68)) k *= 0.8; // планки
      const [rr, gg, bb] = shade(base, k);
      px[i] = [rr, gg, bb, Math.round(255 * smooth(aa))];
    }
  }
  return px;
}

/** Камень: неровный валун с гранями и объёмом */
function drawStone(size) {
  const px = new Array(size * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const base = [138, 147, 168];
  const r0 = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const a = Math.atan2(dy, dx);
      // неровный контур: радиус зависит от угла («грани» камня)
      const rr = r0 * (0.86 + 0.1 * Math.cos(a * 3 + 0.7) + 0.05 * Math.cos(a * 7));
      const d = Math.hypot(dx, dy);
      const i = y * size + x;
      if (d > rr + 1) { px[i] = [0, 0, 0, 0]; continue; }
      const nz = Math.sqrt(Math.max(0, rr * rr - dx * dx - dy * dy)) / rr;
      const nx = dx / rr;
      const ny = dy / rr;
      const L = clamp01(nx * -0.4 + ny * -0.55 + nz * 0.72);
      let k = 0.6 + 0.5 * L;
      if (d > rr - 1.5) k *= 0.8;
      const [rr2, gg, bb] = shade(base, k, Math.pow(L, 8) * 0.35);
      const edge = clamp01((rr - d) / 1.2);
      px[i] = [rr2, gg, bb, Math.round(255 * smooth(edge))];
    }
  }
  return px;
}

// __PART2__

/** Пол: мягкая двухтоновая клетка (без резких стыков тайлов) */
function drawFloor(size) {
  const px = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const cell = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
      let k = cell ? 0.94 : 1.02;
      const ex = Math.min(x, size - 1 - x) / size;
      const ey = Math.min(y, size - 1 - y) / size;
      k *= 0.96 + 0.08 * Math.min(1, Math.min(ex, ey) * 8);
      const [r, g, b] = shade([44, 53, 80], k);
      px[i] = [r, g, b, 255];
    }
  }
  return px;
}

/** Стена: панель с верхней подсветкой и нижней тенью */
function drawWall(size) {
  const px = new Array(size * size);
  const base = [74, 85, 120];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let k = 1;
      if (y < 3) k = 1.22;
      else if (y > size - 4) k = 0.78;
      if (x < 2 || x > size - 3) k *= 0.92;
      const [r, g, b] = shade(base, k);
      px[i] = [r, g, b, 255];
    }
  }
  return px;
}

/** Дверь: рама + светящееся полотно */
function drawDoor(size) {
  const px = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const inFrame = edge >= 4;
      const t = inFrame ? clamp01(1 - Math.abs(y - size / 2) / (size / 2)) : 0;
      let k = inFrame ? 1.05 + t * 0.25 : 0.8;
      if (!inFrame && edge < 1.5) k = 1.05;
      const [r, g, b] = shade([255, 184, 77], k, inFrame ? t * 0.12 : 0);
      px[i] = [r, g, b, 255];
    }
  }
  return px;
}

// ---------- PNG-энкодер ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Собрать PNG из матрицы пикселей [r,g,b,a] (RGBA, фильтр 0) */
function makePng(size, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((1 + size * 4) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px[y * size + x];
      const o = y * (1 + size * 4) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- генерация ----------

const SPECS = [
  ['floor.png', 64, drawFloor],
  ['wall.png', 64, drawWall],
  ['door.png', 64, drawDoor],
  ['ball.png', 64, drawBall],
  ['box.png', 48, drawBox],
  ['stone.png', 48, drawStone],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, draw] of SPECS) {
  const png = makePng(size, draw(size));
  fs.writeFileSync(path.join(OUT_DIR, name), png);
  console.log(`создан ${name} (${size}×${size}, ${png.length} байт)`);
}
console.log('Готово: плейсхолдеры в', OUT_DIR);

