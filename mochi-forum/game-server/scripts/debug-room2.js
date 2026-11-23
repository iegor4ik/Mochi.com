/**
 * Точечный репро: переход в room2 и ходьба к двери. Печатает все кадры
 * (кроме шумовых снапшотов — их позиции каждые 500 мс) и коды закрытия.
 * Запуск: node scripts/debug-room2.js
 */
require('dotenv').config();
const WebSocket = require('ws');

const GAME_WS = process.env.GAME_WS_URL || 'ws://localhost:3001/ws';
const MAIN = process.env.MAIN_API_URL || 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (ws, o) => ws.send(JSON.stringify(o));

function waitFrame(ws, type, timeoutMs, pred) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`кадр ${type} не пришёл`)), timeoutMs);
    ws.__waiters = ws.__waiters || [];
    ws.__waiters.push({ type, pred, resolve, timer });
  });
}

async function main() {
  const token = await fetch(`${MAIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'tech_guy', password: 'tech12345' }),
  }).then((r) => r.json()).then((d) => d.token);

  const ws = new WebSocket(GAME_WS);
  ws.on('close', (code) => console.log(`!! WS закрыт: code=${code}`));
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    // 1) попытка удовлетворить ожидающий кадр
    const waiters = ws.__waiters || [];
    const i = waiters.findIndex((w) => w.type === f.type && (!w.pred || w.pred(f)));
    if (i >= 0) {
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(f);
    }
    // 2) печать всего, кроме шума
    if (f.type === 'snapshot' || f.type === 'object_state') return;
    console.log('<<', JSON.stringify(f).slice(0, 160));
    if (f.type === 'error') console.log('  [сервер] error:', f.message);
  });

  await new Promise((res) => ws.on('open', res));
  send(ws, { type: 'auth', token });
  await waitFrame(ws, 'auth_ok', 5000);
  send(ws, { type: 'join', location: 'hub' });
  const join = await waitFrame(ws, 'join_ok', 5000);
  console.log(`join hub: вы на (${join.you.x},${join.you.y})`);

  // к двери
  send(ws, { type: 'move', x: 1500, y: 450 });
  let arrived = false;
  const t0 = Date.now();
  while (!arrived && Date.now() - t0 < 20000) {
    const snap = await waitFrame(ws, 'snapshot', 3000).catch(() => null);
    if (!snap) break;
    const me = snap.players.find((p) => p.userId === join.you.userId);
    if (me && Math.hypot(me.x - 1520, me.y - 448) < 80) arrived = true;
  }
  console.log(`у двери: ${arrived} (за ${(Date.now() - t0) / 1000}с)`);
  if (!arrived) { console.log('НЕ ДОШЁЛ до двери — тест остановлен'); process.exit(1); }

  send(ws, { type: 'use_exit', exitId: 'door-to-room2' });
  const room2 = await waitFrame(ws, 'join_ok', 8000, (f) => f.location.slug === 'room2');
  console.log(`в room2: спавн (${room2.you.x},${room2.you.y})`);

  // ходьба к двери room2
  send(ws, { type: 'move', x: 400, y: 528 });
  const t1 = Date.now();
  let pos = { x: room2.you.x, y: room2.you.y };
  for (let i = 0; i < 30; i++) {
    const snap = await waitFrame(ws, 'snapshot', 3000).catch(() => null);
    if (!snap) { console.log('снапшоты кончились!'); break; }
    const me = snap.players.find((p) => p.userId === join.you.userId);
    if (me) pos = me;
    if (i % 5 === 0) console.log(`  t=${((Date.now() - t1) / 1000).toFixed(1)}с поз=(${pos.x},${pos.y})`);
    if (me && Math.hypot(me.x - 400, me.y - 528) < 80) {
      console.log(`ДОШЁЛ за ${(Date.now() - t1) / 1000}с`);
      process.exit(0);
    }
  }
  console.log(`НЕ ДОШЁЛ: застрял на (${pos.x},${pos.y}), цель (400,528)`);
  process.exit(1);
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
