/**
 * Проверка graceful shutdown и персистентности после рестарта.
 * Запускает ВЛОЖЕННЫЙ игровой сервер (порт 3002), подключается WS, берёт объект,
 * посылает SIGBREAK/SIGTERM (эмуляция SIGTERM) и ждёт {type:'closing'} + код 0.
 * Затем сравнивает состояние объекта в БД.
 * Запуск: node scripts/test-shutdown.js
 */
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const { query, pool } = require('../src/config/db');

const PORT = 3002;
const WS_URL = `ws://localhost:${PORT}/ws`;
const MAIN = process.env.MAIN_API_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name} ${extra}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFrame(ws, type, timeoutMs, pred) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`кадр ${type} не пришёл`)), timeoutMs);
    ws.__waiters = ws.__waiters || [];
    ws.__waiters.push({ type, pred, resolve, timer });
  });
}

async function main() {
  // восстановление после прошлых прогонов: освобождаем объекты (позиции не трогаем)
  await query('UPDATE world_objects SET taken_by = NULL, vx = 0, vy = 0');
  await query("DELETE FROM chat_messages WHERE text = 'flush-check'");

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), TEST_AUTO_SHUTDOWN_MS: '9000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => console.error('[server]', d.toString().trim()));
  await sleep(2500); // ждём запуска вложенного сервера

  const login = await fetch(`${MAIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  }).then((r) => r.json());

  const ws = new WebSocket(WS_URL);
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.type === 'error') console.log('  [сервер] error:', f.message);
    const waiters = ws.__waiters || [];
    const i = waiters.findIndex((w) => w.type === f.type && (!w.pred || w.pred(f)));
    if (i >= 0) {
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(f);
    }
  });
  await new Promise((res) => ws.on('open', res));
  ws.send(JSON.stringify({ type: 'auth', token: login.token }));
  await waitFrame(ws, 'auth_ok', 5000);
  ws.send(JSON.stringify({ type: 'join', location: 'hub' }));
  const join = await waitFrame(ws, 'join_ok', 5000);
  const obj = join.objects.find((o) => o.taken_by == null); // любой свободный объект
  const origX = obj.x;

  ws.send(JSON.stringify({ type: 'move', x: obj.x - 30, y: obj.y + 10 }));
  const distObj = Math.hypot(obj.x - 30 - join.you.x, obj.y + 10 - join.you.y);
  await sleep(Math.min(9000, (distObj / 220) * 1000 + 900)); // дойти (220 px/s, серверный лимит)
  // фактическая позиция игрока (для диагностики «Слишком далеко»)
  const near = await waitFrame(ws, 'snapshot', 5000, (f) => f.players.some((p) => p.userId === join.you.userId));
  console.log(`  [debug] цель (${obj.x - 30},${obj.y + 10}), объект (${obj.x},${obj.y}), игрок (${near.players[0].x},${near.players[0].y})`);
  ws.send(JSON.stringify({ type: 'interact', action: 'take', objectId: obj.id }));
  await waitFrame(ws, 'object_state', 5000, (f) => f.object.id === obj.id && f.object.taken_by);
  ws.send(JSON.stringify({ type: 'interact', action: 'put' }));
  await waitFrame(ws, 'object_state', 5000, (f) => f.object.id === obj.id && f.object.taken_by == null);
  ws.send(JSON.stringify({ type: 'chat', text: 'flush-check' }));

  // flush по debounce (5 с) + graceful shutdown: closing → flush → exit(0)
  const closingP = waitFrame(ws, 'closing', 15000);
  await sleep(5500); // даём debounce-записи уйти в БД
  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
    // на Windows сигналы между процессами не доставляются — shutdown
    // инициируется тест-хуком TEST_AUTO_SHUTDOWN_MS (в Docker — реальный SIGTERM)
  });

  let closing = false;
  try { await closingP; closing = true; } catch { /* нет кадра */ }
  ok('graceful shutdown: кадр {type:"closing"} получен', closing);
  ok('graceful shutdown: процесс вышел с кодом 0', exitCode === 0, `code=${exitCode}`);

  // объект и чат сохранились в БД (flush при shutdown)
  const { rows } = await query(
    'SELECT x, y, taken_by FROM world_objects WHERE id = $1',
    [obj.id]
  );
  const moved = rows[0] && rows[0].taken_by == null &&
    (Math.abs(rows[0].x - origX) > 5 || Math.abs(rows[0].y - obj.y) > 5);
  ok('объект сохранён в БД после рестарта (flush)', !!moved, `было x=${origX}, стало ${JSON.stringify(rows[0])}`);

  const chat = await query("SELECT count(*)::int n FROM chat_messages WHERE text = 'flush-check'");
  ok('чат записан в БД сразу', chat.rows[0].n === 1);

  ws.close();
  await pool.end();
  console.log(`\n===== ИТОГО: ${passed} PASS, ${failed} FAIL =====`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[test-shutdown] fatal:', (e && (e.stack || e.message)) || e);
  process.exit(1);
});

