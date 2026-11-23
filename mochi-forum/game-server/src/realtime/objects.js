/**
 * Объекты мира: инвентарь-руки (SS13-стиль), перетаскивание (pull), физика броска.
 * Всё авторитарно на сервере. Категории:
 *   item — можно взять в руку (twoHanded — занимает обе);
 *   pull — можно только тащить, занимая обе руки.
 */
const { circleHitsWalls, clampToBounds, findFreeSpot } = require('./map');

const PICKUP_RADIUS = 120;       // дистанция подбора (клик/E)
const THROW_MAX_SPEED = 500;     // макс. скорость броска (м/с)
const THROW_DEFAULT_SPEED = 380; // если клиент не прислал силу
const FRICTION = 3.2;            // затухание скорости в полёте, 1/с
const STOP_SPEED = 25;           // ниже — предмет останавливается
const PLAYER_R = 22;             // радиус тела игрока (зеркалит room.PLAYER_RADIUS)
const DRAG_SPEED_MULTIPLIER = 0.25;

/** Описания предметов. cat: pull — предмет нельзя взять, для буксировки нужны обе руки. */
const DEFS = {
  ball:        { cat: 'item', twoHanded: false, radius: 13, name: 'Мяч' },
  box:         { cat: 'item', twoHanded: false, radius: 16, name: 'Коробка' },
  stone:       { cat: 'item', twoHanded: false, radius: 13, name: 'Камень' },
  wrench:      { cat: 'item', twoHanded: false, radius: 14, name: 'Гаечный ключ' },
  screwdriver: { cat: 'item', twoHanded: false, radius: 12, name: 'Отвёртка' },
  crowbar:     { cat: 'item', twoHanded: true,  radius: 18, name: 'Лом' },
  sledge:      { cat: 'item', twoHanded: true,  radius: 18, name: 'Кувалда' },
  crate:       { cat: 'pull', twoHanded: false, radius: 30, name: 'Большой ящик' },
  barrel:      { cat: 'pull', twoHanded: false, radius: 24, name: 'Бочка' },
};

const defOf = (defKey) => DEFS[defKey] || { cat: 'item', twoHanded: false, radius: 14, name: defKey };
const radiusOf = (defKey) => defOf(defKey).radius;
const otherHand = (h) => (h === 'left' ? 'right' : 'left');
const movementSpeedMultiplier = (room, player) =>
  room.objects.some((o) => o.pulledBy === player.userId) ? DRAG_SPEED_MULTIPLIER : 1;
/** Сущность объекта мира (в памяти комнаты; персистится по требованию). */
class WorldObject {
  constructor(row) {
    this.id = row.id;
    this.locationId = row.location_id;
    this.defKey = row.def_key;
    this.x = row.x;
    this.y = row.y;
    this.vx = row.vx || 0;
    this.vy = row.vy || 0;
    this.heldBy = row.taken_by || null; // legacy-колонка taken_by = «кто держит»
    this.hand = 'right';                // left | right | both
    this.pulledBy = row.pulled_by || null;
    this.dragX = 0;
    this.dragY = 1;
    this.dirty = false;
    this.lastHit = null;                // игрок, в которого врезался летящий предмет
  }

  toPublic() {
    return {
      id: this.id,
      def_key: this.defKey,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      vx: this.vx || 0,
      vy: this.vy || 0,
      heldBy: this.heldBy || null,
      hand: this.heldBy || this.pulledBy ? this.hand : null,
      pulledBy: this.pulledBy || null,
      dragX: this.pulledBy ? this.dragX : null,
      dragY: this.pulledBy ? this.dragY : null,
    };
  }

  /** Позиция предмета в руке или при буксировке. */
  heldPos(holder, hand) {
    const d = defOf(this.defKey);
    if (this.pulledBy) {
      return {
        x: holder.x + this.dragX * (PLAYER_R + d.radius + 12),
        y: holder.y + this.dragY * (PLAYER_R + d.radius + 12),
        angle: Math.atan2(this.dragY, this.dragX),
      };
    }
    if (d.twoHanded || hand === 'both') {
      return {
        x: holder.x + Math.cos(holder.face) * (PLAYER_R + 16),
        y: holder.y + Math.sin(holder.face) * (PLAYER_R + 16),
        angle: holder.face,
      };
    }
    const side = hand === 'left' ? -1 : 1;
    const a = holder.face + side * (Math.PI / 4);
    const dist = PLAYER_R + 16;
    return { x: holder.x + Math.cos(a) * dist, y: holder.y + Math.sin(a) * dist, angle: a };
  }

  /** Физика: предметы в руках/на буксире следуют за игроком, летящие — гаснут. */
  step(dt, room) {
    dt = Math.min(dt, 0.05);
    if (this.heldBy) {
      const holder = room.players.get(this.heldBy);
      if (!holder) { this.heldBy = null; this.hand = 'right'; this.dirty = true; return; }
      const p = this.heldPos(holder, this.hand);
      this.x = p.x; this.y = p.y;
      this.vx = 0; this.vy = 0;
      return;
    }
    if (this.pulledBy) {
      const puller = room.players.get(this.pulledBy);
      if (!puller) { this.pulledBy = null; this.dirty = true; return; }
      const speed = Math.hypot(puller.vx || 0, puller.vy || 0);
      if (speed > 12) {
        this.dragX = -puller.vx / speed;
        this.dragY = -puller.vy / speed;
      }
      const p = this.heldPos(puller, this.hand);
      this.x = p.x; this.y = p.y;
      this.vx = 0; this.vy = 0;
      return;
    }
    const speed = Math.hypot(this.vx, this.vy);
    if (speed <= 0.01) return;
    const wasFlying = true;
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!circleHitsWalls(room.map, nx, ny, defOf(this.defKey).radius)) {
      const c = clampToBounds(room.map, nx, ny, defOf(this.defKey).radius);
      this.x = c.x; this.y = c.y;
    } else {
      this.vx = 0; this.vy = 0; // врезались в стену
    }
    // игроки на пути летящего предмета
    if (speed > 120) {
      for (const pl of room.players.values()) {
        if (pl.userId === this.lastHit) continue;
        if (Math.hypot(pl.x - this.x, pl.y - this.y) < PLAYER_R + defOf(this.defKey).radius - 4) {
          this.lastHit = pl.userId;
          room.broadcast({
            type: 'bump',
            userId: pl.userId,
            text: `${defOf(this.defKey).name} прилетел в ${pl.username}!`,
          });
          break;
        }
      }
    } else {
      this.lastHit = null;
    }
    const decay = Math.max(0, 1 - FRICTION * dt);
    this.vx *= decay;
    this.vy *= decay;
    if (Math.hypot(this.vx, this.vy) < STOP_SPEED) { this.vx = 0; this.vy = 0; }
    this.dirty = true; // летящий предмет меняет позицию — нужен flush
    if (wasFlying && !this.vx && !this.vy) {
      // полёт завершён: финальная позиция валидна здесь — рассылаем всем
      room.broadcastObjectState(this);
    }
  }

  /** Бросок: скорость от клиента (≤ THROW_MAX_SPEED), направление — угол (рад). */
  launch(room, player, power, angle) {
    const speed = Math.max(0, Math.min(THROW_MAX_SPEED, Number(power) || THROW_DEFAULT_SPEED));
    const ang = Number.isFinite(angle) ? angle : (player.face != null ? player.face : Math.PI / 2);
    this.vx = Math.cos(ang) * speed;
    this.vy = Math.sin(ang) * speed;
    this.lastHit = null;
  }

  /** Положить/уронить у ног: чуть вперёд по взгляду. */
  placeAtFeet(room, player) {
    const f = player.face != null ? player.face : Math.PI / 2;
    this.x = player.x + Math.cos(f) * 34;
    this.y = player.y + Math.sin(f) * 34;
    this.vx = 0; this.vy = 0;
    const c = clampToBounds(room.map, this.x, this.y, defOf(this.defKey).radius);
    this.x = c.x; this.y = c.y;
    this.lastHit = null;
  }

  /** Свободное место рядом с игроком (если у ног стена). */
  placeNear(room, player) {
    const r = defOf(this.defKey).radius;
    this.placeAtFeet(room, player);
    if (circleHitsWalls(room.map, this.x, this.y, r)) {
      const spot = findFreeSpot(room.map, this.x, this.y, r);
      this.x = spot.x; this.y = spot.y;
    }
  }
}

/** Подбор в руку (SS13): одноручное — в активную (с обменом), двуручное — в обе. */
async function take(room, player, objectId) {
  const obj = room.objects.find((o) => o.id === objectId);
  if (!obj) return 'Объект не найден';
  const def = defOf(obj.defKey);
  if (def.cat !== 'item') return `${def.name} нельзя взять в руку`;
  if (obj.heldBy === player.userId) return 'Уже держишь это';
  if (obj.heldBy) {
    const other = room.players.get(obj.heldBy);
    return other ? `${def.name} в руках у ${other.username}` : `${def.name} кто-то держит`;
  }
  if (Math.hypot(obj.x - player.x, obj.y - player.y) > PICKUP_RADIUS) return 'Слишком далеко';

  if (def.twoHanded) {
    if (player.hands.left != null || player.hands.right != null) {
      const names = [player.hands.left, player.hands.right]
        .filter((x) => x != null)
        .map((x) => {
          const o = room.objects.find((w) => w.id === x);
          return o ? defOf(o.defKey).name : null;
        })
        .filter(Boolean);
      return `Руки заняты${names.length ? ` (${names.join(', ')})` : ''}`;
    }
    player.hands.left = obj.id;
    player.hands.right = obj.id;
    obj.hand = 'both';
  } else {
    const side = player.hands.active;
    const prevId = player.hands[side];
    if (prevId != null) {
      const prev = room.objects.find((o) => o.id === prevId);
      if (prev) {
        prev.heldBy = null;
        prev.hand = 'right';
        prev.placeNear(room, player);
        prev.dirty = true;
        room.broadcastObjectState(prev);
      }
    }
    player.hands[side] = obj.id;
    obj.hand = side;
  }
  obj.heldBy = player.userId;
  obj.vx = 0; obj.vy = 0;
  obj.pulledBy = null; // подбор перехватывает буксир
  obj.dirty = true;
  room.broadcastObjectState(obj);
  return true;
}

/** Положить/уронить предмет из активной руки у ног. */
async function dropFromHand(room, player) {
  const side = player.hands.active;
  const id = player.hands[side];
  if (id == null) return 'Рука пуста';
  const obj = room.objects.find((o) => o.id === id);
  if (!obj) { player.hands[side] = null; return true; }
  if (obj.hand === 'both') { player.hands.left = null; player.hands.right = null; }
  else player.hands[side] = null;
  if (obj.pulledBy === player.userId) {
    obj.pulledBy = null;
    obj.hand = 'right';
    obj.dirty = true;
    room.broadcastObjectState(obj);
    return true;
  }
  obj.heldBy = null;
  obj.hand = 'right';
  obj.placeAtFeet(room, player);
  obj.dirty = true;
  room.broadcastObjectState(obj);
  return true;
}

/** Бросок из активной руки: вылет вперёд по взгляду, сила от клиента. */
async function throwObj(room, player, dir) {
  const side = player.hands.active;
  const id = player.hands[side];
  if (id == null) return 'Рука пуста — нечего бросать';
  const obj = room.objects.find((o) => o.id === id);
  if (!obj) { player.hands[side] = null; return true; }
  if (obj.hand === 'both') { player.hands.left = null; player.hands.right = null; }
  else player.hands[side] = null;
  obj.heldBy = null;
  obj.hand = 'right';
  obj.x = player.x + Math.cos(player.face) * (PLAYER_R + 8);
  obj.y = player.y + Math.sin(player.face) * (PLAYER_R + 8);
  const c = clampToBounds(room.map, obj.x, obj.y, defOf(obj.defKey).radius);
  obj.x = c.x; obj.y = c.y;
  // направление: вектор {x,y} от клиента (тесты/курсор), иначе — взгляд
  let angle = player.face != null ? player.face : Math.PI / 2;
  const dx = Number(dir && dir.x);
  const dy = Number(dir && dir.y);
  if (Number.isFinite(dx) && Number.isFinite(dy) && (dx !== 0 || dy !== 0)) {
    angle = Math.atan2(dy, dx);
  }
  obj.launch(room, player, dir && dir.power, angle);
  obj.dirty = true;
  room.broadcastObjectState(obj);
  return true;
}

/** Использовать предмет из активной руки: расходуется и исчезает. */
async function use(room, player) {
  const side = player.hands.active;
  const id = player.hands[side];
  if (id == null) return 'Рука пуста';
  const obj = room.objects.find((o) => o.id === id);
  if (!obj) { player.hands[side] = null; return true; }
  if (obj.hand === 'both') { player.hands.left = null; player.hands.right = null; }
  else player.hands[side] = null;
  obj.heldBy = null;
  obj.pulledBy = null;
  obj.vx = 0; obj.vy = 0;
  await room.removeWorldObject(obj);
  return true;
}

/** Клик по слоту руки: предметы двух рук меняются местами. */
async function swapHands(room, player) {
  if (player.hands.left === player.hands.right && player.hands.left != null) {
    return 'Двуручный предмет держат обе руки';
  }
  const a = player.hands.active;
  const b = otherHand(a);
  if (player.hands[a] == null && player.hands[b] == null) return 'Руки пусты';
  const idA = player.hands[a];
  const idB = player.hands[b];
  const objA = idA != null ? room.objects.find((o) => o.id === idA) : null;
  const objB = idB != null ? room.objects.find((o) => o.id === idB) : null;
  player.hands[a] = idB != null ? idB : null;
  player.hands[b] = idA != null ? idA : null;
  if (objA) { objA.hand = b; objA.dirty = true; room.broadcastObjectState(objA); }
  if (objB) { objB.hand = a; objB.dirty = true; room.broadcastObjectState(objB); }
  return true;
}

/** Переключить активную руку (клавиша X). */
async function switchHand(room, player) {
  player.hands.active = otherHand(player.hands.active);
  return true;
}

/** Тащить/отпустить предмет: предметы с cat=pull занимают обе руки. */
async function pull(room, player, objectId) {
  const obj = room.objects.find((o) => o.id === objectId);
  if (!obj) return 'Объект не найден';
  const def = defOf(obj.defKey);
  if (obj.heldBy) {
    const other = room.players.get(obj.heldBy);
    if (obj.heldBy !== player.userId) {
      return other ? `${def.name} в руках у ${other.username}` : `${def.name} кто-то держит`;
    }
    if (player.hands.left === obj.id) player.hands.left = null;
    if (player.hands.right === obj.id) player.hands.right = null;
    obj.heldBy = null;
  }
  if (obj.pulledBy === player.userId) {
    obj.pulledBy = null;
    if (obj.hand === 'both') {
      if (player.hands.left === obj.id) player.hands.left = null;
      if (player.hands.right === obj.id) player.hands.right = null;
    } else if (player.hands[obj.hand] === obj.id) {
      player.hands[obj.hand] = null;
    }
    obj.hand = 'right';
    obj.dirty = true;
    room.broadcastObjectState(obj);
    return true;
  }
  if (Math.hypot(obj.x - player.x, obj.y - player.y) > PICKUP_RADIUS) return 'Слишком далеко';
  if (obj.pulledBy) {
    const other = room.players.get(obj.pulledBy);
    return other ? `Его тащит ${other.username}` : 'Его уже тащат';
  }
  const takesBothHands = def.cat === 'pull';
  let hand = player.hands.active;
  if (takesBothHands) {
    if (player.hands.left != null || player.hands.right != null) return 'Чтобы тащить этот предмет, нужны свободные руки';
    player.hands.left = obj.id;
    player.hands.right = obj.id;
    hand = 'both';
  } else {
    if (player.hands[hand] != null) hand = otherHand(hand);
    if (player.hands[hand] != null) return 'Обе руки заняты';
    player.hands[hand] = obj.id;
  }
  for (const o of room.objects) {
    if (o.pulledBy === player.userId && o.id !== obj.id) {
      o.pulledBy = null;
      if (o.hand === 'both') {
        if (player.hands.left === o.id) player.hands.left = null;
        if (player.hands.right === o.id) player.hands.right = null;
      } else if (player.hands[o.hand] === o.id) {
        player.hands[o.hand] = null;
      }
      o.hand = 'right';
      o.dirty = true;
      room.broadcastObjectState(o);
    }
  }
  obj.pulledBy = player.userId;
  obj.hand = hand;
  const speed = Math.hypot(player.vx || 0, player.vy || 0);
  const dx = speed > 12 ? -player.vx : obj.x - player.x;
  const dy = speed > 12 ? -player.vy : obj.y - player.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.001) {
    obj.dragX = dx / len;
    obj.dragY = dy / len;
  } else {
    const face = Number.isFinite(player.face) ? player.face : Math.PI / 2;
    obj.dragX = -Math.cos(face);
    obj.dragY = -Math.sin(face);
  }
  obj.vx = 0; obj.vy = 0;
  obj.dirty = true;
  room.broadcastObjectState(obj);
  return true;
}

/** При выходе игрока: предметы падают у ног, буксиры отпускаются. */
async function releaseAll(room, player) {
  const ids = [...new Set([player.hands.left, player.hands.right].filter((x) => x != null))];
  player.hands.left = null;
  player.hands.right = null;
  for (const id of ids) {
    const obj = room.objects.find((o) => o.id === id);
    if (!obj) continue;
    obj.heldBy = null;
    obj.hand = 'right';
    obj.placeNear(room, player);
    obj.dirty = true;
    room.broadcastObjectState(obj);
  }
  for (const o of room.objects) {
    if (o.pulledBy === player.userId) {
      o.pulledBy = null;
      if (o.hand === 'both') {
        if (player.hands.left === o.id) player.hands.left = null;
        if (player.hands.right === o.id) player.hands.right = null;
      } else if (player.hands[o.hand] === o.id) {
        player.hands[o.hand] = null;
      }
      o.hand = 'right';
      o.dirty = true;
      room.broadcastObjectState(o);
    }
  }
}

/** Общий шаг физики объектов (вызывается из room.tick). */
async function step(dt, room) {
  for (const o of room.objects) o.step(dt, room);
}

module.exports = {
  DEFS, defOf, radiusOf, WorldObject, PICKUP_RADIUS, THROW_MAX_SPEED, DRAG_SPEED_MULTIPLIER,
  movementSpeedMultiplier,
  take, dropFromHand, throwObj, use, swapHands, switchHand, pull, releaseAll, step,
};
