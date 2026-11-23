
/**
 * Интеграционный тест realtime-ядра (нужен запущенный game-server на :3001,
 * форум на :3000 и сид демо-юзеров: admin/admin123, sakura/sakura123).
 *
 * Проверяет: auth-кадр, join, player_join/leave, движение и стены, чат (+лимиты),
 * объекты take/put/throw, переход через дверь hub ↔ room2.
 * Запуск: node scripts/test-ws.js
 */
require('dotenv').config();
const WebSocket = require('ws');

const MAIN = process.env.MAIN_API_URL || 'http://localhost:3000';
const GAME_WS = process.env.GAME_WS_URL || 'ws://localhost:3001/ws';

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.log(`  [FAIL] ${name} ${extra}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (ws, obj) => ws.send(JSON.stringify(obj));

/** Открыть WS, авторизоваться, вернуть клиент */
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GAME_WS);
    ws.on('message', (raw) => {
      let f;
      try { f = JSON.parse(raw.toString()); } catch { return; }
      const waiters = ws.__waiters || [];
      const i = waiters.findIndex((w) => w.type === f.type && (!w.pred || w.pred(f)));
      if (i >= 0) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        w.resolve(f);
        
      } else if (f.type === 'auth_ok') {
        ws.__authok = f;
      } else if (f.type === 'error') {
        console.log('  [сервер] error:', f.message);
      }

    });
    ws.on('error', reject);
    ws.on('close', (code) => { ws.closeCode = code; });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      waitFrame(ws, 'auth_ok', 8000)
        .then((f) => resolve({ ws, user: f.user }))
        .catch(reject);
    });
  });
}

function waitFrame(ws, type, timeoutMs = 5000, pred = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`кадр ${type} не пришёл за ${timeoutMs} мс`)), timeoutMs);
    ws.__waiters = ws.__waiters || [];
    ws.__waiters.push({ type, pred, resolve, timer });
  });
}

// __PART2__

/** Токен для тестов: отдельные тестовые аккаунты (не пересекаются с живыми сессиями).
 *  Если аккаунта нет — регистрируется. Возвращает { token, login }. */
async function testToken(login, password) {
  const res = await fetch(`${MAIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  if (res.ok) return (await res.json()).token;
  // регистрация тестового аккаунта (demo-юзеры может занять живой игрок)
  const reg = await fetch(`${MAIN}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: login, email: `${login}@test.local`, password }),
  });
  if (!reg.ok) throw new Error(`не удалось создать тестовый аккаунт ${login}: ${(await reg.json()).error}`);
  return (await reg.json()).token;
}

async function main() {
  console.log('Получаю токены форума...');
  const t1 = await testToken('gamer_test_a', 'gamer_test_pass_1');
  const t2 = await testToken('gamer_test_b', 'gamer_test_pass_2');

  console.log('\n--- Этап 4: auth-кадр и комнаты ---');
  const c1 = await connect(t1);
  ok('auth_ok отдаёт профиль', c1.user && c1.user.id > 0 && !!c1.user.username, JSON.stringify(c1.user));

  const badCode = await new Promise((resolve) => {
    const ws = new WebSocket(GAME_WS);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'garbage' })));
    ws.on('close', (code) => resolve(code));
    ws.on('error', () => resolve(-1));
  });
  ok('битый токен → close 4401', badCode === 4401, `code=${badCode}`);

  send(c1.ws, { type: 'join', location: 'hub' });
  const join1 = await waitFrame(c1.ws, 'join_ok');
  ok('join_ok: локация hub', join1.location && join1.location.slug === 'hub');
  ok('join_ok: карта со стенами/дверью', join1.location.map.walls.length > 0 && join1.location.map.exits.length > 0);
  ok('join_ok: объекты из БД', Array.isArray(join1.objects) && join1.objects.length >= 5, `получено ${join1.objects && join1.objects.length}`);

  const c2 = await connect(t2);
  send(c2.ws, { type: 'join', location: 'hub' });
  const join2 = await waitFrame(c2.ws, 'join_ok');
  await waitFrame(c1.ws, 'player_join', 5000, (f) => f.player.userId === join2.you.userId);
  ok('второй игрок виден (player_join)', true);

  console.log('\n--- Этап 5: движение, стены, AOI ---');
  send(c2.ws, { type: 'move', x: 400, y: 450 });
  const near = await waitFrame(c1.ws, 'snapshot', 8000, (f) =>
    f.players.some((p) => p.userId === join2.you.userId && Math.abs(p.x - 400) < 30));
  const me = near.players.find((p) => p.userId === join2.you.userId);
  ok('движение синхронно (снапшоты 10 Гц)', !!me, `x=${me && me.x}`);

  // цель внутри стены (x:700..724) — сервер обязан остановить раньше
  send(c2.ws, { type: 'move', x: 720, y: 450 });
  const stopped = await waitFrame(c1.ws, 'snapshot', 9000, (f) => {
    const p = f.players.find((q) => q.userId === join2.you.userId);
    return p && p.x < 700 && Math.abs(p.y - 450) < 40;
  });
  const wp = stopped.players.find((p) => p.userId === join2.you.userId);
  ok('стена непроходима (кламп у стены)', wp.x < 700, `x=${wp.x} (цель 720)`);


  console.log('\n--- Этап 6: чат ---');
  send(c2.ws, { type: 'chat', text: 'Привет из теста!' });
  const chatFrame = await waitFrame(c1.ws, 'chat', 5000, (f) => f.text === 'Привет из теста!');
  ok('chat-событие с ником и координатами', chatFrame.username === join2.you.username && Number.isFinite(chatFrame.x));
  send(c1.ws, { type: 'chat', text: '   ' });
  const chatErr = await waitFrame(c1.ws, 'error', 3000);
  ok('пустое сообщение отклонено', /Сообщение/.test(chatErr.message), chatErr.message);
  const hist = await fetch(`http://localhost:3001/api/locations/hub/chat?limit=20`, {
    headers: { Authorization: `Bearer ${t1}` },
  }).then((r) => r.json());
  ok('история чата содержит сообщение', hist.messages.some((m) => m.text === 'Привет из теста!'));

  console.log('\n--- Этап 7: объекты take/put/throw ---');
  // актуальный снапшот c2: выбираем ближайший свободный объект и идём к нему
  const snap2 = await waitFrame(c2.ws, 'snapshot');
  const c2p = snap2.players.find((p) => p.userId === join2.you.userId);
  const free = snap2.objects.filter((o) => o.taken_by == null);
  const target = free.sort((a, b) =>
    Math.hypot(a.x - c2p.x, a.y - c2p.y) - Math.hypot(b.x - c2p.x, b.y - c2p.y))[0];
  const distObj = Math.hypot(target.x - c2p.x, target.y - c2p.y);
  send(c2.ws, { type: 'move', x: target.x, y: target.y });
  await sleep(Math.min(6000, (distObj / 220) * 1000 + 800)); // дорога (220 px/s, серверный лимит)
  const ball = target;
  send(c2.ws, { type: 'interact', action: 'take', objectId: ball.id });
  await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === ball.id && f.object.heldBy === join2.you.userId);
  ok('take: heldBy у первого взявшего', true);

  await waitFrame(c1.ws, 'snapshot', 3000, (f) => f.objects.some((o) => o.id === ball.id && o.heldBy === join2.you.userId));
  ok('предмет в руке виден другим (идёт за держащим)', true);
  send(c2.ws, { type: 'interact', action: 'put' });
  const put = await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === ball.id && f.object.heldBy == null);
  // кладётся по стороне «руки» (учитывая dir), у ног держащего
  ok('put: объект положен у ног', Math.abs(put.object.x - target.x) <= 60 && Math.abs(put.object.y - target.y) <= 60, `x=${put.object.x} y=${put.object.y}`);

  send(c2.ws, { type: 'interact', action: 'take', objectId: ball.id });
  await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === ball.id && f.object.heldBy === join2.you.userId);
  // направление броска — в свободное пространство (raycast по стенам карты)
  const walls = join1.location.map.walls;
  const hits = (x, y, r) => walls.some((w) => {
    const cx = Math.max(w.x, Math.min(x, w.x + w.w));
    const cy = Math.max(w.y, Math.min(y, w.y + w.h));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  });
  let best = { d: -1, dx: 1, dy: 0 };
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let d = 0;
    for (let s = 16; s <= 400; s += 16) {
      if (hits(put.object.x + dx * s, put.object.y + dy * s, 13)) break;
      d = s;
    }
    if (d > best.d) best = { d, dx, dy };
  }
  send(c2.ws, { type: 'interact', action: 'throw', dir: { x: best.dx, y: best.dy } });
  const flying = await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === ball.id && f.object.vx !== undefined);
  ok('throw: скорость ≤500 и полёт начат', Math.hypot(flying.object.vx || 0, flying.object.vy || 0) > 0 && Math.hypot(flying.object.vx || 0, flying.object.vy || 0) <= 500, `v=${flying.object.vx},${flying.object.vy}`);
  const landed = await waitFrame(c1.ws, 'object_state', 8000, (f) => f.object.id === ball.id && !f.object.vx && !f.object.vy);
  const flight = Math.hypot(landed.object.x - put.object.x, landed.object.y - put.object.y);
  ok('throw: затухание и остановка', flight > 20, `пролетел ${Math.round(flight)}px`);

  // --- использование предмета (заготовка на будущее): взять → use → исчезает ---
  const snap3 = await waitFrame(c2.ws, 'snapshot', 3000);
  const me3 = snap3.players.find((p) => p.userId === join2.you.userId);
  const near2 = snap3.objects.filter((o) => o.heldBy == null)
    .sort((a, b) => Math.hypot(a.x - me3.x, a.y - me3.y) - Math.hypot(b.x - me3.x, b.y - me3.y))[0];
  const d2 = Math.hypot(near2.x - me3.x, near2.y - me3.y);
  send(c2.ws, { type: 'move', x: near2.x, y: near2.y });
  await sleep(Math.min(6000, (d2 / 220) * 1000 + 800));
  send(c2.ws, { type: 'interact', action: 'take', objectId: near2.id });
  await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === near2.id && f.object.heldBy === join2.you.userId);
  send(c2.ws, { type: 'interact', action: 'use' });
  const gone = await waitFrame(c1.ws, 'object_removed', 5000, (f) => f.id === near2.id);
  ok('use: предмет исчез (object_removed)', gone.id === near2.id);
  // предмет в снапшотах больше не приходит
  const afterUse = await waitFrame(c2.ws, 'snapshot', 3000, (f) => !f.objects.some((o) => o.id === near2.id));
  ok('use: использованный объект исчез из снапшотов', !!afterUse);

  // --- инвентарь-руки: подбор в активную руку, своп слотов, X, drop ---
  const snap4 = await waitFrame(c2.ws, 'snapshot', 3000);
  const me4 = snap4.players.find((p) => p.userId === join2.you.userId);
  const free4 = snap4.objects
    .filter((o) => o.heldBy == null && !['crate', 'barrel'].includes(o.def_key))
    .sort((a, b) => Math.hypot(a.x - me4.x, a.y - me4.y) - Math.hypot(b.x - me4.x, b.y - me4.y));
  const itemA = free4[0];
  const dA = Math.hypot(itemA.x - me4.x, itemA.y - me4.y);
  send(c2.ws, { type: 'move', x: itemA.x, y: itemA.y });
  await sleep(Math.min(6000, (dA / 220) * 1000 + 800));
  send(c2.ws, { type: 'interact', action: 'take', objectId: itemA.id });
  await waitFrame(c2.ws, 'object_state', 5000, (f) => f.object.id === itemA.id && f.object.heldBy === join2.you.userId && f.object.hand === 'right');
  ok('руки: подбор в активную (правую) руку', true);
  send(c2.ws, { type: 'interact', action: 'swap' });
  await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === itemA.id && f.object.hand === 'left');
  ok('swap: предмет переложился в левую руку', true);
  send(c2.ws, { type: 'interact', action: 'active' });
  const sysFrame = await waitFrame(c2.ws, 'sys', 5000);
  ok('X: активная рука переключается (sys)', /Активная рука/.test(sysFrame.message), sysFrame.message);
  send(c2.ws, { type: 'interact', action: 'drop' });
  await waitFrame(c1.ws, 'object_state', 5000, (f) => f.object.id === itemA.id && f.object.heldBy == null);
  ok('drop: предмет из активной руки упал у ног', true);

  // __PART3__

  console.log('\n--- Этап 8: переход hub ↔ room2 ---');
  // c1 подходит к двери (быть в AOI события), c2 идёт к двери — ждём прихода обоих
  send(c1.ws, { type: 'move', x: 1400, y: 430 });
  send(c2.ws, { type: 'move', x: 1500, y: 450 });
  await waitFrame(c2.ws, 'snapshot', 20000, (f) => {
    const p = f.players.find((q) => q.userId === join2.you.userId);
    return p && Math.hypot(p.x - 1520, p.y - 448) < 80;
  });
  // ожидания регистрируем ДО отправки use_exit: player_leave приходит раньше join_ok
  const leaveP = waitFrame(c1.ws, 'player_leave', 8000, (f) => f.userId === join2.you.userId);
  send(c2.ws, { type: 'use_exit', exitId: 'door-to-room2' });

  const room2join = await waitFrame(c2.ws, 'join_ok', 8000, (f) => f.location.slug === 'room2');
  ok('переход в room2 по двери (та же WS-сессия)', room2join.location.name === 'Пустая комната');
  const spawnDef = room2join.location.map.spawns.find((s) => s.id === 'default');
  ok('спавн в заданной точке', Math.abs(room2join.you.x - spawnDef.x) < 2 && Math.abs(room2join.you.y - spawnDef.y) < 2, `${room2join.you.x},${room2join.you.y}`);
  await leaveP;
  ok('c1 получил player_leave (в AOI)', true);
  // обратно в hub: к нижней двери room2 (центр 400,528)
  send(c2.ws, { type: 'move', x: 400, y: 528 });
  await waitFrame(c2.ws, 'snapshot', 15000, (f) => {
    const p = f.players.find((q) => q.userId === join2.you.userId);
    return p && Math.hypot(p.x - 400, p.y - 528) < 80;
  });
  const joinP = waitFrame(c1.ws, 'player_join', 8000, (f) => f.player.userId === join2.you.userId);
  send(c2.ws, { type: 'use_exit', exitId: 'door-to-hub' });
  const hubBack = await waitFrame(c2.ws, 'join_ok', 8000, (f) => f.location.slug === 'hub');
  const spawnBack = hubBack.location.map.spawns.find((s) => s.id === 'from-room2');
  ok('возврат в hub, спавн from-room2', Math.abs(hubBack.you.x - spawnBack.x) < 2 && Math.abs(hubBack.you.y - spawnBack.y) < 2, `${hubBack.you.x},${hubBack.you.y}`);
  await joinP;
  ok('c1 видит возвращение c2 (player_join)', true);


  console.log(`\n===== ИТОГО: ${passed} PASS, ${failed} FAIL =====`);
  c1.ws.close();
  c2.ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[test-ws] fatal:', e.message);
  process.exit(1);
});


