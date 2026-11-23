/**
 * Комната-локация: тик-цикл (20 Гц), авторитарное движение, снапшоты 10 Гц
 * с ограничением AOI (~600 px), игровой чат, объекты (руки/перетаскивание/броски),
 * переходы через двери. Пустые комнаты выгружаются из памяти.
 */
const { query } = require('../config/db');
const { getLocation, moveCircle, getSpawn } = require('./map');
const objects = require('./objects');
const { v } = require('../utils/validate');

const TICK_MS = 50;           // тик сервера: 20 Гц
const SNAPSHOT_MS = 100;      // снапшоты: 10 Гц
const AOI_RADIUS = 600;       // радиус «зоны интереса»
const PLAYER_RADIUS = 22;     // радиус тела-кругляшки
const MAX_SPEED = 220;        // px/s — максимум по ТЗ
const MOVE_MIN_INTERVAL = 50; // чаще 20 Гц сообщения move игнорируются
const CHAT_MAX_PER_WINDOW = 5;
const CHAT_WINDOW_MS = 10 * 1000;
const INTERACT_MAX_PER_SEC = 5;
const EXIT_RADIUS = 100;      // с какого расстояния можно «нажать E» на дверь

const rooms = new Map(); // slug → Room

const round1 = (n) => Math.round(n * 10) / 10;
const inAoi = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= AOI_RADIUS * AOI_RADIUS;

function sendTo(ws, frame) {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame));
}

/** История чата локации (последние limit сообщений, старые сверху) */
async function fetchHistory(locationId, limit = 20) {
  const { rows } = await query(
    `SELECT user_id, username, text, created_at
     FROM chat_messages WHERE location_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [locationId, limit]
  );
  return rows.reverse();
}

class Room {
  constructor(loc, objectRows) {
    this.locationId = loc.id;
    this.slug = loc.slug;
    this.name = loc.name;
    this.map = loc.map;
    this.players = new Map(); // userId → player
    this.objects = objectRows;
    this.flushTimer = null;
    this.lastTick = Date.now();
    this.seenObjects = new Map(); // userId → Set(id объектов в AOI, для деспауна)
  }

  start() {
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.snapshotTimer = setInterval(() => this.sendSnapshots(), SNAPSHOT_MS);
  }

  destroy() {
    clearInterval(this.tickTimer);
    clearInterval(this.snapshotTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.seenObjects.clear();
  }

  /* ---------------- игроки ---------------- */

  /** Публичное представление: направление взгляда — угол (рад), активная рука */
  publicPlayer(p) {
    return {
      userId: p.userId,
      username: p.username,
      avatar: p.avatar || null,
      x: round1(p.x),
      y: round1(p.y),
      face: Math.round((p.face != null ? p.face : Math.PI / 2) * 100) / 100,
      activeHand: p.hands.active,
    };
  }

  async addPlayer(ws, user, { spawnId } = {}) {
    // один аккаунт — одна игровая сессия: старое подключение закрывается
    const existing = this.players.get(user.id);
    if (existing) {
      sendTo(existing.ws, { type: 'error', message: 'Ваш аккаунт подключён из другого окна' });
      this.removePlayer(existing.ws, { skipUnload: true });
      existing.ws.close(4000, 'replaced');
    }
    const spawn = getSpawn(this.map, spawnId);
    const player = {
      ws,
      user, // профиль (нужен при переходе между локациями)
      userId: user.id,
      username: user.username,
      avatar: user.avatar || null,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      tx: spawn.x,
      ty: spawn.y,
      face: Math.PI / 2, // смотрим «вниз» при входе
      moving: false,
      hands: { left: null, right: null, active: 'right' },
      lastMoveAccepted: 0,
      chatTimes: [],
      interactTimes: [],
    };
    this.players.set(user.id, player);
    ws.room = this;

    const history = await fetchHistory(this.locationId, 20);
    sendTo(ws, {
      type: 'join_ok',
      you: this.publicPlayer(player),
      location: { slug: this.slug, name: this.name, map: this.map },
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      objects: this.objectsList(player.userId, player),
      chatHistory: history,
    });
    // стартовый набор «видимых» объектов — от него считаем деспаун
    this.seenObjects.set(
      player.userId,
      new Set(this.objectsList(player.userId, player).map((o) => o.id))
    );
    // player_join — только тем, кто в AOI
    for (const other of this.players.values()) {
      if (other !== player && inAoi(other, player)) {
        sendTo(other.ws, { type: 'player_join', player: this.publicPlayer(player) });
      }
    }
  }

  removePlayer(ws, { skipUnload = false } = {}) {
    const player = [...this.players.values()].find((p) => p.ws === ws);
    if (!player) return;
    // соединение оборвалось с предметами в руках — они падают у ног, буксиры отпускаются
    objects.releaseAll(this, player);
    this.players.delete(player.userId);
    this.seenObjects.delete(player.userId);
    ws.room = null;
    for (const other of this.players.values()) {
      if (inAoi(other, player)) {
        sendTo(other.ws, { type: 'player_leave', userId: player.userId });
      }
    }
    if (!skipUnload && this.players.size === 0) this.unload();
  }

  /** Комната опустела: сохранить объекты и выгрузить из памяти */
  unload() {
    this.flushObjects().catch(() => {});
    this.destroy();
    if (rooms.get(this.slug) === this) rooms.delete(this.slug);
  }

  /* ---------------- движение (авторитарное) ---------------- */

  /** Целевая точка от клиента: кламп в границы; скорость сервер держит сам */
  setMoveTarget(player, msg) {
    const now = Date.now();
    if (now - player.lastMoveAccepted < MOVE_MIN_INTERVAL) return; // чаще 20 Гц — игнор
    player.lastMoveAccepted = now;
    const x = Number(msg.x);
    const y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      sendTo(player.ws, { type: 'error', message: 'move: некорректные координаты' });
      return;
    }
    if (msg.face != null) {
      const f = Number(msg.face);
      if (Number.isFinite(f)) player.face = Math.atan2(Math.sin(f), Math.cos(f));
    }
    // кламп в границы карты; телепорт невозможен — сервер ведёт игрока сам
    player.tx = Math.min(this.map.width - 1, Math.max(1, x));
    player.ty = Math.min(this.map.height - 1, Math.max(1, y));
    player.moving = true;
  }

  /** Отдельный кадр взгляда (поворот на месте) */
  setFace(player, face) {
    const f = Number(face);
    if (!Number.isFinite(f)) return;
    player.face = Math.atan2(Math.sin(f), Math.cos(f));
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;

    for (const p of this.players.values()) {
      p.vx = 0;
      p.vy = 0;
      if (!p.moving) continue;
      const oldX = p.x;
      const oldY = p.y;
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const speed = MAX_SPEED * objects.movementSpeedMultiplier(this, p);
      const step = speed * dt; // сервер сам ограничивает скорость
      let nx;
      let ny;
      if (dist <= step) {
        nx = p.tx;
        ny = p.ty;
        p.moving = false;
      } else {
        nx = p.x + (dx / dist) * step;
        ny = p.y + (dy / dist) * step;
      }
      const res = moveCircle(this.map, p.x, p.y, nx, ny, PLAYER_RADIUS); // стены/границы
      p.x = res.x;
      p.y = res.y;
      p.vx = (p.x - oldX) / Math.max(dt, 0.001);
      p.vy = (p.y - oldY) / Math.max(dt, 0.001);
    }

    // физика объектов: полёт, следование за держащим/тящим
    objects.step(dt, this);
    // любой «грязный» объект планирует debounce-запись в БД
    const dirtyObj = this.objects.find((o) => o.dirty);
    if (dirtyObj) this.markDirty(dirtyObj);
  }

  /* ---------------- снапшоты (AOI) ---------------- */

  /** Объекты для отправки: всё в AOI (в руках — видны всем, у держащего) */
  objectsList(forUserId, around) {
    const list = [];
    for (const o of this.objects) {
      if (around && !inAoi(around, o)) continue; // AOI
      list.push(o.toPublic());
    }
    return list;
  }

  sendSnapshots() {
    for (const p of this.players.values()) {
      const players = [];
      for (const q of this.players.values()) {
        if (q === p || inAoi(p, q)) players.push(this.publicPlayer(q));
      }
      const objects = this.objectsList(p.userId, p);
      // деспаун: объекты, покинувшие AOI
      let seen = this.seenObjects.get(p.userId);
      if (!seen) { seen = new Set(); this.seenObjects.set(p.userId, seen); }
      const ids = new Set(objects.map((o) => o.id));
      for (const oid of [...seen]) {
        if (!ids.has(oid)) {
          seen.delete(oid);
          sendTo(p.ws, { type: 'object_despawn', id: oid });
        }
      }
      for (const oid of ids) seen.add(oid);
      sendTo(p.ws, { type: 'snapshot', players, objects });
    }
  }

  /* ---------------- чат ---------------- */

  async chat(player, text) {
    const now = Date.now();
    player.chatTimes = player.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (player.chatTimes.length >= CHAT_MAX_PER_WINDOW) {
      sendTo(player.ws, { type: 'error', message: 'Слишком много сообщений — подождите пару секунд' });
      return;
    }
    let clean;
    try {
      clean = v.str(text, { label: 'Сообщение', min: 1, max: 300 });
    } catch (e) {
      sendTo(player.ws, { type: 'error', message: e.message });
      return;
    }
    player.chatTimes.push(now);
    // чат пишем в БД сразу (персистентность по ТЗ)
    query(
      'INSERT INTO chat_messages (location_id, user_id, username, text) VALUES ($1,$2,$3,$4)',
      [this.locationId, player.userId, player.username, clean]
    ).catch((e) => console.error('[chat] insert:', e.message));
    // рассылка только в AOI говорящего
    for (const other of this.players.values()) {
      if (other === player || inAoi(player, other)) {
        sendTo(other.ws, {
          type: 'chat',
          userId: player.userId,
          username: player.username,
          x: round1(player.x),
          y: round1(player.y),
          text: clean,
        });
      }
    }
  }

  /* ---------------- объекты ---------------- */

  markDirty(obj) {
    obj.dirty = true;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushObjects().catch((e) => console.error('[objects] flush:', e.message));
      }, 5000); // debounce-запись ~раз в 5 с
    }
  }

  async flushObjects() {
    const dirty = this.objects.filter((o) => o.dirty);
    if (!dirty.length) return;
    for (const o of dirty) o.dirty = false;
    for (const o of dirty) {
      await query(
        `UPDATE world_objects
         SET x = $2, y = $3, vx = $4, vy = $5, taken_by = $6, pulled_by = $7, updated_at = now()
         WHERE id = $1`,
        [o.id, o.x, o.y, o.vx, o.vy, o.heldBy, o.pulledBy]
      );
    }
  }

  broadcastObjectState(obj) {
    for (const p of this.players.values()) {
      sendTo(p.ws, { type: 'object_state', object: obj.toPublic() });
    }
  }

  /** Общая рассылка кадра всем в комнате (например, bump от летящего предмета) */
  broadcast(frame) {
    for (const p of this.players.values()) {
      sendTo(p.ws, frame);
    }
  }

  /** Предмет израсходован: убрать из комнаты, из AOI-наборов и из БД */
  async removeWorldObject(obj) {
    const idx = this.objects.indexOf(obj);
    if (idx >= 0) this.objects.splice(idx, 1);
    for (const p of this.players.values()) {
      const seen = this.seenObjects.get(p.userId);
      if (seen) seen.delete(obj.id);
      sendTo(p.ws, { type: 'object_removed', id: obj.id });
    }
    try {
      await query('DELETE FROM world_objects WHERE id = $1', [obj.id]);
    } catch (e) {
      console.error('[objects] delete:', e.message);
    }
  }

  /* ---------------- действия с объектами (лимит 5/с) ---------------- */

  async interact(player, msg) {
    const now = Date.now();
    player.interactTimes = player.interactTimes.filter((t) => now - t < 1000);
    if (player.interactTimes.length >= INTERACT_MAX_PER_SEC) {
      sendTo(player.ws, { type: 'error', message: 'Слишком много действий' });
      return;
    }
    player.interactTimes.push(now);
    let res;
    switch (msg.action) {
      case 'take': {
        const objectId = v.int(msg.objectId, { label: 'objectId', min: 1, optional: true, def: null });
        res = objectId == null ? 'Не указан объект' : await objects.take(this, player, objectId);
        break;
      }
      case 'put':
      case 'drop':
        res = await objects.dropFromHand(this, player);
        break;
      case 'throw':
        res = await objects.throwObj(this, player, msg.dir);
        break;
      case 'use':
        res = await objects.use(this, player);
        break;
      case 'swap': {
        v.oneOf(msg.hand, ['left', 'right'], { label: 'Рука', optional: true, def: null });
        res = await objects.swapHands(this, player);
        break;
      }
      case 'active':
        res = await objects.switchHand(this, player);
        break;
      case 'pull': {
        const objectId = v.int(msg.objectId, { label: 'objectId', min: 1, optional: true, def: null });
        res = objectId == null ? 'Не указан объект' : await objects.pull(this, player, objectId);
        break;
      }
      default:
        res = 'Неизвестное действие';
    }
    if (typeof res === 'string' && res) {
      sendTo(player.ws, { type: 'error', message: res });
    }
  }

  /* ---------------- переходы через двери ---------------- */

  /** Проверить близость к двери и перевести игрока в целевую локацию */
  async useExit(player, exitId) {
    const exit = (this.map.exits || []).find((e) => e.id === exitId);
    if (!exit) {
      sendTo(player.ws, { type: 'error', message: 'Дверь не найдена' });
      return;
    }
    const cx = exit.x + exit.w / 2;
    const cy = exit.y + exit.h / 2;
    if (Math.hypot(player.x - cx, player.y - cy) > EXIT_RADIUS) {
      sendTo(player.ws, { type: 'error', message: 'Дверь слишком далеко — подойдите ближе' });
      return;
    }
    const target = await getRoom(exit.to);
    if (!target) {
      sendTo(player.ws, { type: 'error', message: 'Локация временно недоступна' });
      return;
    }
    // переход = leave текущей + join новой в той же WS-сессии
    this.removePlayer(player.ws);
    await target.addPlayer(player.ws, player.user, { spawnId: exit.spawn });
  }
}

/** Получить (или загрузить) комнату по slug локации */
async function getRoom(slug) {
  const clean = v.str(slug, { label: 'Локация', max: 64 });
  let room = rooms.get(clean);
  if (room) return room;
  const loc = await getLocation(clean);
  if (!loc) return null;
  const { rows } = await query(
    'SELECT id, def_key, x, y, vx, vy, taken_by, pulled_by FROM world_objects WHERE location_id = $1',
    [loc.id]
  );
  room = new Room(loc, rows.map((r) => new objects.WorldObject(r)));
  rooms.set(clean, room);
  room.start();
  console.log(`[room] локация «${room.name}» загружена (${room.objects.length} объектов)`);
  return room;
}

/** Все активные комнаты (для graceful shutdown) */
function allRooms() {
  return [...rooms.values()];
}

module.exports = { getRoom, allRooms, inAoi, AOI_RADIUS, PLAYER_RADIUS };
