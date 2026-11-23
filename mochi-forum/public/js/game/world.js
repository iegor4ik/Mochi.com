/**
 * Сцена игры «Хаб» (Phaser 3): мир из карт БД, игроки-кругляшки, предсказание
 * движения с реконсиляцией, инвентарь-руки (SS13), перетаскивание, броски.
 * Объекты: item (в руки: одноручные/двуручные) и pull (только тащить).
 * Предметы — через GameItems (манифест + canvas), персонажи — GameCharacter.
 */
window.GameWorld = (() => {
  const CFG = window.GAME_CONFIG;
  const AOI = 600; // радиус зоны интереса (зеркалит сервер)

  let scene = null;
  let game = null;
  let myUserId = null;
  let map = null;
  let netBound = false;
  const players = new Map();    // userId → rec { data, container, sim, rx, ry, mvx, mvy, faceTarget }
  const objData = new Map();    // id → последнее состояние объекта (из любых кадров)
  const objSprites = new Map(); // id → sprite (только видимые)
  let statics = [];             // стены/двери локации
  const keysState = {};         // WASD/стрелки
  let lastMoveSent = 0;
  let lastFaceSent = Math.PI / 2;
  let lastFaceSentAt = 0;
  let clickFace = null;         // { angle, until } — поворот по клику (на месте)
  let contextAction = null;     // 'take' | 'pull' | 'exit' | 'holding'
  let contextTarget = null;
  let pointerWorld = null;      // мировая позиция курсора (для броска Ctrl+Q)
  let hud = null;               // инвентарь: два слота-руки внизу
  let ctrlPointerHandler = null;

  const avatarUrl = (p) => {
    if (!p.avatar) return null;
    return /^https?:/.test(p.avatar) ? p.avatar : CFG.MAIN_ORIGIN + p.avatar;
  };

  /** Позиция игрока в экранных координатах (для HTML-пузырей чата) */
  function getPlayerScreenPos(userId) {
    const rec = players.get(userId);
    if (!rec || !scene) return null;
    const cam = scene.cameras.main;
    return {
      x: (rec.container.x - cam.worldView.x) * cam.zoom + cam.x - 60,
      y: (rec.container.y - cam.worldView.y) * cam.zoom + cam.y - 78,
    };
  }

  /** Клиентская коллизия для предсказания (сервер — авторитет, это только визуал) */
  function hitsWall(x, y, r) {
    if (!map) return false;
    for (const w of map.walls) {
      const cx = Math.max(w.x, Math.min(x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(y, w.y + w.h));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
    return false;
  }

  /** Руки собираются из серверных состояний удерживаемых и буксируемых предметов. */
  function myHands() {
    const me = players.get(myUserId);
    const active = me && me.data && me.data.activeHand ? me.data.activeHand : 'right';
    const hands = { left: null, right: null, active };
    for (const o of objData.values()) {
      if (o.heldBy !== myUserId && o.pulledBy !== myUserId) continue;
      if (o.hand === 'both') { hands.left = o.id; hands.right = o.id; }
      else if (o.hand === 'left' || o.hand === 'right') hands[o.hand] = o.id;
    }
    return hands;
  }

  /** Предмет в активной руке (объект или null) */
  function activeItem() {
    const h = myHands();
    const o = h[h.active] != null ? objData.get(h[h.active]) : null;
    return o && o.heldBy === myUserId ? o : null;
  }

  /** Выполнить fn, когда сцена Phaser готова (join_ok может прийти раньше create) */
  function whenSceneReady(fn) {
    if (scene) fn();
    else setTimeout(() => whenSceneReady(fn), 50);
  }

  /* ---------- создание сцены ---------- */

  function start(locationSlug) {
    if (game) return; // сцена уже живёт (переход между локациями внутри неё)
    window.__gameLocation = locationSlug;
    if (!netBound) { bindNet(); netBound = true; }
    const parent = document.getElementById('gameCanvasWrap');
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: parent.clientWidth || 1200,
      height: parent.clientHeight || 700,
      backgroundColor: '#1a2030',
      pixelArt: false,
      scene: { preload, create, update },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    });
  }

  function isStarted() {
    return !!game;
  }

  function stop() {
    if (scene && ctrlPointerHandler) {
      scene.game.canvas.removeEventListener('pointerdown', ctrlPointerHandler, true);
    }
    ctrlPointerHandler = null;
    if (game) { game.destroy(true); game = null; }
    players.clear();
    objData.clear();
    objSprites.clear();
    statics = [];
    scene = null;
    myUserId = null;
    map = null;
    contextAction = null;
    contextTarget = null;
    hud = null;
    clickFace = null;
  }

  function preload() {
    GameAssets.loadAll(this);       // манифест: floor/wall/door + ball/box/stone
    GameItems.ensureTextures(this); // canvas-текстуры новых предметов
  }

  function create() {
    scene = this;
    this.add.tileSprite(0, 0, 4000, 4000, 'floor').setOrigin(0).setDepth(-2);

    for (const set of Object.values(CFG.KEYS)) {
      for (const k of set) keysState[k] = false;
    }
    const normKey = (code) => String(code).replace('Key', '').replace('Arrow', '').toUpperCase();
    this.input.keyboard.on('keydown', (e) => {
      const k = normKey(e.code);
      if (k in keysState) keysState[k] = true;
      if (CFG.KEYS.interact.includes(k)) doInteract();
      if (k === 'X') doSwitchHand(); // смена активной руки (SS13)
      if (k === 'Q' && e.ctrlKey) {
        e.preventDefault(); // Ctrl+Q в некоторых браузерах закрывает окно
        doThrow();
      } else if (CFG.KEYS.put.includes(k)) {
        doDrop();
      }
    });
    this.input.keyboard.on('keyup', (e) => {
      const k = normKey(e.code);
      if (k in keysState) keysState[k] = false;
    });
    ctrlPointerHandler = (event) => {
      if (event.button !== 0 || !event.ctrlKey || myUserId == null) return;
      const bounds = this.game.canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * this.scale.width / bounds.width;
      const y = (event.clientY - bounds.top) * this.scale.height / bounds.height;
      const point = this.cameras.main.getWorldPoint(x, y);
      const hit = findObjectAt(point.x, point.y, true);
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      GameNet.send({ type: 'interact', action: 'pull', objectId: hit.id });
    };
    this.game.canvas.addEventListener('pointerdown', ctrlPointerHandler, true);
    // курсор: мировая позиция для броска по Ctrl+Q
    this.input.on('pointermove', (p) => {
      pointerWorld = { x: p.worldX, y: p.worldY };
    });
    this.input.on('wheel', (pointer, currentlyOver, dx, dy, dz, event) => {
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.001, 0.65, 1.8));
      if (event && event.preventDefault) event.preventDefault();
    });
    // клик: слот инвентаря → предмет в мире → поворот лицом
    this.input.on('pointerdown', (p) => {
      if (handleHudClick(p)) return;
      if (myUserId == null || !players.has(myUserId)) return;
      const hit = pickObjectAt(p.worldX, p.worldY);
      if (hit) {
        const ctrlClick = p.event && p.event.ctrlKey === true;
        if (ctrlClick) {
          GameNet.send({ type: 'interact', action: 'pull', objectId: hit.id });
        } else if (hit.pulledBy === myUserId || GameItems.def(hit.def_key).cat === 'pull') {
          GameNet.send({ type: 'interact', action: 'pull', objectId: hit.id });
        } else {
          GameNet.send({ type: 'interact', action: 'take', objectId: hit.id });
        }
        return;
      }
      const me = players.get(myUserId);
      const dx = p.worldX - me.container.x;
      const dy = p.worldY - me.container.y;
      if (Math.hypot(dx, dy) < 10) return; // клик по себе
      clickFace = { angle: Math.atan2(dy, dx), until: performance.now() + 1500 };
      me.faceTarget = Math.atan2(dy, dx);
      GameCharacter.setFaceAngle(me.container, me.faceTarget);
    });
    ensureHud();
  }

  /* ---------- net-обработчики (уровень модуля, регистрируются в start()) ---------- */

  /** Отправить join, когда и сцена, и авторизация готовы */
  function tryJoin() {
    if (!GameNet.connected || !window.__gameLocation) return;
    whenSceneReady(() => {
      GameNet.send({ type: 'join', location: window.__gameLocation });
    });
  }

  function bindNet() {
    GameNet.on('auth_ok', (f) => {
      myUserId = f.user.id;
      tryJoin(); // join отправляется сразу после auth_ok
    });
    GameNet.on('join_ok', onJoinOk);
    GameNet.on('snapshot', onSnapshot);
    GameNet.on('player_join', onPlayerJoin);
    GameNet.on('player_leave', onPlayerLeave);
    GameNet.on('chat', onChat);
    GameNet.on('object_state', onObjectState);
    GameNet.on('object_removed', onObjectRemoved);
    GameNet.on('object_despawn', onObjectDespawn);
    GameNet.on('error', (f) => UI.toast(f.message, 'error'));
  }

  /* ---------- join / snapshots ---------- */

  function onJoinOk(f) {
    map = f.location.map;
    myUserId = f.you.userId;
    GameChat.setLocation(f.location.name);
    GameChat.renderHistory(f.chatHistory);

    // пересборка статики при переходе между локациями
    for (const s of statics) s.destroy();
    statics = [];
    for (const w of map.walls) {
      statics.push(scene.add.image(w.x + w.w / 2, w.y + w.h / 2, 'wall').setDisplaySize(w.w, w.h).setDepth(2));
    }
    for (const e of map.exits || []) {
      statics.push(scene.add.image(e.x + e.w / 2, e.y + e.h / 2, 'door').setDisplaySize(e.w, e.h).setDepth(1));
    }
    scene.physics.world.setBounds(0, 0, map.width, map.height);
    scene.cameras.main.stopFollow();

    // чужие игроки прежней локации не переносятся
    for (const [uid, rec] of [...players]) {
      if (uid !== myUserId) { rec.container.destroy(); players.delete(uid); }
    }
    for (const p of f.players) upsertPlayer(p);

    // объекты прежней локации стираются полностью (данные + спрайты)
    for (const [, sp] of objSprites) sp.destroy();
    objSprites.clear();
    objData.clear();
    for (const o of f.objects) upsertObject(o);
  }

  function upsertPlayer(p) {
    let rec = players.get(p.userId);
    if (!rec) {
      const container = GameCharacter.create(scene, {
        userId: p.userId,
        username: p.username,
        avatar: avatarUrl(p),
        x: p.x,
        y: p.y,
      });
      rec = {
        data: p,
        container,
        // sim — предсказанная позиция (для себя), rx/ry — сглаженный рендер
        sim: { x: p.x, y: p.y, vx: 0, vy: 0 },
        rx: p.x,
        ry: p.y,
        mvx: 0, mvy: 0, // сглаженная скорость рендера (для «хвоста» тащимых предметов)
        faceTarget: p.userId === myUserId ? Math.PI / 2 : (p.face != null ? p.face : Math.PI / 2),
      };
      players.set(p.userId, rec);
      if (p.userId === myUserId) GameCharacter.setActiveHand(container, p.activeHand);
    } else {
      Object.assign(rec.data, p);
      if (p.userId === myUserId) {
        // мой взгляд — локальный (клики/движение); активная рука — от сервера
        GameCharacter.setActiveHand(rec.container, p.activeHand);
      } else {
        GameCharacter.setFaceAngle(rec.container, p.face != null ? p.face : Math.PI / 2);
      }
    }
    if (p.userId === myUserId && scene.cameras.main.followTarget !== rec.container) {
      scene.cameras.main.startFollow(rec.container, true, 1, 1);
    }
  }

  function onSnapshot(f) {
    for (const p of f.players) upsertPlayer(p);
    for (const o of f.objects) upsertObject(o);
  }

  function onPlayerJoin(f) {
    upsertPlayer(f.player);
  }

  function onPlayerLeave(f) {
    const rec = players.get(f.userId);
    if (rec) {
      rec.container.destroy();
      players.delete(f.userId);
      GameChat.hideBubble(f.userId);
    }
    // предметы, которые он держал/тащил, пересинхронизируются снапшотом
    for (const o of objData.values()) {
      if (o.heldBy === f.userId || o.pulledBy === f.userId) syncSprite(o.id);
    }
  }

  function onChat(f) {
    const col = '#' + GameCharacter.colorOf(f.userId).toString(16).padStart(6, '0');
    GameChat.addLine(f.text, { color: col });
    GameChat.showBubble(GameWorld, f.userId, f.text);
  }

  /* ---------- объекты ---------- */

  function upsertObject(o) {
    objData.set(o.id, o);
    syncSprite(o.id);
  }

  /** Спрайт объекта существует только когда он должен быть виден:
   *  «при игроке» — если игрок виден; на земле — если в моём AOI. */
  function syncSprite(id) {
    const o = objData.get(id);
    if (!o || !scene) return;
    let sp = objSprites.get(id);
    const carrierId = o.heldBy != null ? o.heldBy : (o.pulledBy != null ? o.pulledBy : null);
    const me = players.get(myUserId);
    let visible;
    if (carrierId != null) visible = players.has(carrierId); // виден, только если носитель виден
    else visible = !!me && Math.hypot(o.x - me.container.x, o.y - me.container.y) <= AOI + 40;
    if (!visible) {
      if (sp) { sp.destroy(); objSprites.delete(id); }
      return;
    }
    if (!sp) {
      const d = GameItems.def(o.def_key);
      sp = scene.add.image(o.x, o.y, GameItems.texKey(o.def_key)).setDepth(o.pulledBy != null ? 4 : 5);
      sp.setDisplaySize(d.w, d.h);
      sp.setData('objId', id);
      sp.setData('defKey', o.def_key);
      objSprites.set(id, sp);
    }
  }

  function onObjectState(f) {
    upsertObject(f.object);
  }

  function onObjectRemoved(f) {
    const o = objData.get(f.id);
    const wasMine = o && o.heldBy === myUserId;
    const sp = objSprites.get(f.id);
    if (sp) { sp.destroy(); objSprites.delete(f.id); }
    objData.delete(f.id);
  }

  /** Объект покинул мой AOI — сервер сообщает явно (фикс «объект не найден») */
  function onObjectDespawn(f) {
    const sp = objSprites.get(f.id);
    if (sp) { sp.destroy(); objSprites.delete(f.id); }
    objData.delete(f.id);
  }

  /* ---------- действия ---------- */

  function doInteract() {
    if (!scene) return;
    // E с предметом в активной руке — использовать
    if (activeItem()) {
      GameNet.send({ type: 'interact', action: 'use' });
      return;
    }
    if (contextAction === 'take' && contextTarget) {
      GameNet.send({ type: 'interact', action: 'take', objectId: contextTarget });
    } else if (contextAction === 'pull' && contextTarget) {
      GameNet.send({ type: 'interact', action: 'pull', objectId: contextTarget });
    } else if (contextAction === 'exit' && contextTarget) {
      const ov = document.getElementById('gameTransition');
      if (ov) ov.classList.add('show');
      GameNet.send({ type: 'use_exit', exitId: contextTarget });
    }
  }

  function doDrop() {
    const hands = myHands();
    if (hands[hands.active] == null) return;
    GameNet.send({ type: 'interact', action: 'drop' });
  }

  function doSwitchHand() {
    const me = players.get(myUserId);
    if (!me) return;
    // оптимистично locally: сервер подтвердит снапшотом
    me.data.activeHand = me.data.activeHand === 'left' ? 'right' : 'left';
    GameCharacter.setActiveHand(me.container, me.data.activeHand);
    GameNet.send({ type: 'interact', action: 'active' });
  }

  /** Бросок: Ctrl+Q; направление — на курсор, если он известен, иначе перед собой */
  function doThrow() {
    const me = players.get(myUserId);
    if (!me || !activeItem()) return;
    let angle = me.faceTarget != null ? me.faceTarget : Math.PI / 2;
    if (pointerWorld) {
      const wx = pointerWorld.x - me.container.x;
      const wy = pointerWorld.y - me.container.y;
      if (Math.hypot(wx, wy) > 8) angle = Math.atan2(wy, wx); // курсор не на персонаже
    }
    GameNet.send({ type: 'interact', action: 'throw', dir: { x: Math.cos(angle), y: Math.sin(angle) } });
  }

  /** Ближайший объект под курсором (для клика) */
  function pickObjectAt(wx, wy) {
    return findObjectAt(wx, wy, false);
  }

  function findObjectAt(wx, wy, includeHeldByMe) {
    let hit = null;
    let bestD = 1e9;
    for (const [id, sp] of objSprites) {
      const o = objData.get(id);
      if (!o || (o.heldBy != null && !(includeHeldByMe && o.heldBy === myUserId)) ||
          (o.pulledBy != null && o.pulledBy !== myUserId)) continue;
      if (o.heldBy === myUserId) {
        const bounds = sp.getBounds();
        const d = Math.hypot(sp.x - wx, sp.y - wy);
        if (bounds.contains(wx, wy) && d < bestD) { bestD = d; hit = o; }
      } else {
        const r = GameItems.def(o.def_key).radius + 14;
        const d = Math.hypot(sp.x - wx, sp.y - wy);
        if (d < r && d < bestD) { bestD = d; hit = o; }
      }
    }
    return hit;
  }

  function dragDirection(o, puller) {
    const serverLength = Math.hypot(o.dragX || 0, o.dragY || 0);
    if (serverLength > 0.001) return { x: o.dragX / serverLength, y: o.dragY / serverLength };
    const dx = o.x - puller.container.x;
    const dy = o.y - puller.container.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.001) return { x: dx / length, y: dy / length };
    const face = puller.container.getData('faceCur') || Math.PI / 2;
    return { x: -Math.cos(face), y: -Math.sin(face) };
  }

  function smoothAngle(current, target, amount) {
    let difference = target - current;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return current + difference * amount;
  }

  /* ---------- Контекст клавиши E для предметов/дверей (без экранных подсказок) ---------- */

  function updateActionContext() {
    if (!scene || !map || myUserId == null) return;
    const me = players.get(myUserId);
    if (!me) return;
    const px = me.container.x;
    const py = me.container.y;

    let kind = null;
    let payload = null;
    let best = 1e9;

    if (activeItem()) {
      // предмет в активной руке — постоянная подсказка действий
      kind = 'holding';
    } else {
      for (const [id, sp] of objSprites) {
        const o = objData.get(id);
        if (!o || o.heldBy != null) continue; // чужие руки не трогаем
        if (o.pulledBy != null && o.pulledBy !== myUserId) continue; // тащит кто-то другой
        const d = Math.hypot(sp.x - px, sp.y - py);
        if (d < 90 && d < best) {
          best = d;
          if (o.pulledBy === myUserId || GameItems.def(o.def_key).cat === 'pull') {
            kind = 'pull'; payload = o.id;
          } else {
            kind = 'take'; payload = o.id;
          }
        }
      }
      if (!kind) {
        for (const e of map.exits || []) {
          const d = Math.hypot(e.x + e.w / 2 - px, e.y + e.h / 2 - py);
          if (d < 100 && d < best) {
            best = d; kind = 'exit'; payload = e.id;
          }
        }
      }
    }

    contextAction = kind;
    contextTarget = payload;
  }

  /* ---------- HUD-инвентарь: два слота-руки (SS13) ---------- */

  function ensureHud() {
    if (hud || !scene) return;
    const root = document.getElementById('gameHandHud');
    if (!root) return;
    const slots = {};
    for (const button of root.querySelectorAll('[data-hand]')) {
      const side = button.dataset.hand;
      slots[side] = {
        button,
        image: button.querySelector('img'),
        label: button.querySelector('.game-hand-item-name'),
      };
      button.addEventListener('click', () => {
        GameNet.send({ type: 'interact', action: 'swap', hand: side });
      });
    }
    root.addEventListener('pointerdown', (event) => event.stopPropagation());
    hud = { root, slots, textureUrls: new Map() };
  }

  function handleHudClick(p) {
    return !!(p.event && p.event.target && p.event.target.closest &&
      p.event.target.closest('#gameHandHud'));
  }

  function updateHud() {
    if (!hud || !scene || myUserId == null) return;
    const hands = myHands();
    for (const side of ['left', 'right']) {
      const active = hands.active === side;
      const slot = hud.slots[side];
      slot.button.classList.toggle('active', active);
      slot.button.setAttribute('aria-pressed', String(active));
      const id = hands[side];
      const o = id != null ? objData.get(id) : null;
      if (o) {
        const item = GameItems.def(o.def_key);
        const key = GameItems.texKey(o.def_key);
        let src = hud.textureUrls.get(key);
        if (!src) {
          const texture = scene.textures.exists(key) ? scene.textures.get(key) : null;
          const source = texture && texture.getSourceImage();
          if (source) {
            src = typeof source.toDataURL === 'function' ? source.toDataURL() : source.src;
            if (src) hud.textureUrls.set(key, src);
          }
        }
        if (src) {
          slot.image.src = src;
          slot.image.hidden = false;
        } else {
          slot.image.removeAttribute('src');
          slot.image.hidden = true;
        }
        slot.label.textContent = item.name;
        slot.image.alt = item.name;
        slot.button.setAttribute('aria-label', `${side === 'left' ? 'Левая' : 'Правая'} рука: ${item.name}`);
        slot.button.classList.add('occupied');
      } else {
        slot.image.removeAttribute('src');
        slot.image.hidden = true;
        slot.image.alt = '';
        slot.label.textContent = '';
        slot.button.setAttribute('aria-label', side === 'left' ? 'Левая рука' : 'Правая рука');
        slot.button.classList.remove('occupied');
      }
    }
  }

  /* ---------- игровой цикл (плавное движение) ---------- */

  const MAX_SPEED = CFG.MAX_SPEED || 220; // px/s (лимит сервера)

  function update(time, delta) {
    if (!scene || myUserId == null || !map) return;
    const me = players.get(myUserId);
    if (!me || !me.sim) return;
    const dt = Math.min(0.05, delta / 1000);
    const R = GameCharacter.BODY_R; // радиус тела (= PLAYER_RADIUS сервера)

    /* --- 1. моё движение: предсказание с плавным разгоном/торможением --- */
    const pressed = (dir) => (CFG.KEYS[dir] || []).some((k) => keysState[k]);
    let ix = 0;
    let iy = 0;
    if (pressed('left')) ix -= 1;
    if (pressed('right')) ix += 1;
    if (pressed('up')) iy -= 1;
    if (pressed('down')) iy += 1;
    const movingNow = ix !== 0 || iy !== 0;
    const ilen = Math.hypot(ix, iy) || 1;
    const draggedObject = [...objData.values()].find((o) => o.pulledBy === myUserId);
    const dragging = !!draggedObject;
    const moveSpeed = MAX_SPEED * (dragging ? CFG.DRAG_SPEED_MULTIPLIER : 1);
    const tvx = movingNow ? (ix / ilen) * moveSpeed : 0;
    const tvy = movingNow ? (iy / ilen) * moveSpeed : 0;
    const accelK = 1 - Math.exp(-18 * dt);
    me.sim.vx += (tvx - me.sim.vx) * accelK;
    me.sim.vy += (tvy - me.sim.vy) * accelK;

    const nx = me.sim.x + me.sim.vx * dt;
    const ny = me.sim.y + me.sim.vy * dt;
    if (!hitsWall(nx, me.sim.y, R)) me.sim.x = Phaser.Math.Clamp(nx, R, map.width - R);
    else me.sim.vx = 0;
    if (!hitsWall(me.sim.x, ny, R)) me.sim.y = Phaser.Math.Clamp(ny, R, map.height - R);
    else me.sim.vy = 0;

    /* --- 2. реконсиляция с сервером: мягкое подтягивание вместо телепортов --- */
    if (me.data && Number.isFinite(me.data.x)) {
      const ex = me.data.x - me.sim.x;
      const ey = me.data.y - me.sim.y;
      const d = Math.hypot(ex, ey);
      if (d > 160) {
        me.sim.x = me.data.x; me.sim.y = me.data.y;
        me.rx = me.data.x; me.ry = me.data.y;
      } else if (d > 0.5) {
        const pullK = 1 - Math.exp(-5 * dt);
        me.sim.x += ex * pullK;
        me.sim.y += ey * pullK;
      }
    }

    /* --- 3. рендер-позиция: двойное сглаживание (sim → rx) --- */
    const renderK = 1 - Math.exp(-22 * dt);
    me.rx += (me.sim.x - me.rx) * renderK;
    me.ry += (me.sim.y - me.ry) * renderK;
    me.container.x = me.rx;
    me.container.y = me.ry;
    me.mvx = me.sim.vx; me.mvy = me.sim.vy; // моя скорость — для «хвоста» буксира

    /* --- взгляд: движение — приоритет, клик — поворот на месте --- */
    const speed = Math.hypot(me.sim.vx, me.sim.vy);
    if (movingNow) {
      me.faceTarget = Math.atan2(iy, ix);
    } else if (clickFace && performance.now() < clickFace.until) {
      me.faceTarget = clickFace.angle;
    }
    GameCharacter.setFaceAngle(me.container, me.faceTarget);
    // взгляд уезжает на сервер: с move при движении, отдельным кадром на месте
    if (movingNow && time - lastMoveSent >= 1000 / CFG.MOVE_SEND_HZ) {
      lastMoveSent = time;
      GameNet.send({
        type: 'move',
        x: Phaser.Math.Clamp(me.sim.x + (ix / ilen) * 48, 1, map.width - 1),
        y: Phaser.Math.Clamp(me.sim.y + (iy / ilen) * 48, 1, map.height - 1),
        face: me.faceTarget,
      });
      lastFaceSent = me.faceTarget;
    } else if (Math.abs(me.faceTarget - lastFaceSent) > 0.05 && time - lastFaceSentAt >= 100) {
      lastFaceSent = me.faceTarget;
      lastFaceSentAt = time;
      GameNet.send({ type: 'face', face: me.faceTarget });
    }

    GameCharacter.tick(me.container, dt, speed > 20);

    /* --- 4. дистанционные игроки: интерполяция + скорость для буксиров --- */
    for (const [uid, rec] of players) {
      if (uid === myUserId) continue;
      const c = rec.container;
      const ox = c.x, oy = c.y;
      const dx = rec.data.x - c.x;
      const dy = rec.data.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d > 300) { c.x = rec.data.x; c.y = rec.data.y; } // телепорт — сразу
      else if (d > 0.5) {
        const k = 1 - Math.exp(-12 * dt);
        c.x += dx * k;
        c.y += dy * k;
      }
      rec.mvx = rec.mvx * 0.8 + ((c.x - ox) / dt) * 0.2;
      rec.mvy = rec.mvy * 0.8 + ((c.y - oy) / dt) * 0.2;
      GameCharacter.tick(c, dt, d > 3);
    }

    /* --- 5. предметы: в руках у держащего, на буксире — за тащащим --- */
    for (const [id, sp] of objSprites) {
      const o = objData.get(id);
      if (!o) continue;
      if (o.heldBy != null) {
        const holder = players.get(o.heldBy);
        if (!holder) continue;
        sp.setData('dragRender', null);
        if (o.hand === 'both') {
          const item = GameItems.def(o.def_key);
          const gripDistance = item.holdDistance != null ? item.holdDistance : GameCharacter.BODY_R + 16;
          const fp = GameCharacter.frontPoint(holder.container, gripDistance);
          sp.setOrigin(item.holdOriginX != null ? item.holdOriginX : 0.5, 0.5);
          sp.setPosition(fp.x, fp.y);
          sp.setRotation(fp.angle + (item.holdRotationOffset || 0));
        } else {
          sp.setOrigin(0.5, 0.5);
          const hp = GameCharacter.handPoint(holder.container, o.hand);
          sp.setPosition(hp.x, hp.y);
          sp.setRotation(hp.angle);
        }
        sp.setDepth(12);
      } else if (o.pulledBy != null) {
        const puller = players.get(o.pulledBy);
        if (!puller) continue;
        sp.setOrigin(0.5, 0.5);
        const radius = GameItems.def(o.def_key).radius;
        const drag = dragDirection(o, puller);
        const distance = GameCharacter.BODY_R + radius + 12;
        const targetX = puller.container.x + drag.x * distance;
        const targetY = puller.container.y + drag.y * distance;
        const targetAngle = Math.atan2(drag.y, drag.x);
        let render = sp.getData('dragRender');
        if (!render) {
          render = { angle: targetAngle };
          sp.setData('dragRender', render);
        }
        const follow = 1 - Math.exp(-12 * dt);
        sp.x += (targetX - sp.x) * follow;
        sp.y += (targetY - sp.y) * follow;
        render.angle = smoothAngle(render.angle, targetAngle, follow);
        sp.setRotation(render.angle);
        sp.setDepth(12);
      } else {
        sp.setOrigin(0.5, 0.5);
        sp.setData('dragRender', null);
        // лежит/летит: полёт сглаживаем (сервер даёт 10 Гц)
        if (o.vx || o.vy) {
          const k = 1 - Math.exp(-14 * dt);
          sp.x += (o.x - sp.x) * k;
          sp.y += (o.y - sp.y) * k;
        } else {
          sp.x = o.x;
          sp.y = o.y;
        }
        sp.setRotation(0);
        sp.setDepth(5);
      }
    }
    for (const [userId, player] of players) {
      const dragged = [...objData.values()].find((o) => o.pulledBy === userId);
      const drag = dragged ? dragDirection(dragged, player) : { x: 0, y: 0 };
      GameCharacter.setDragging(
        player.container,
        dragged ? GameItems.def(dragged.def_key).radius : 0,
        drag.x,
        drag.y
      );
    }

    updateActionContext();
    updateHud();
    GameChat.updatePositions(GameWorld);
  }

  return { start, stop, isStarted, getPlayerScreenPos };
})();
