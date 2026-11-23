/**
 * Персонаж-«кругляшка» (по референсу): круглое тело с фото пользователя внутри,
 * две капли-руки, ПРИКЛЕЕННЫЕ к телу снизу-по бокам и висящие наружу;
 * поворачиваются вместе со взглядом. Глаз нет — вместо них «изображение
 * в шарике» (аватар) смещается в сторону взгляда. Ник — над персонажем.
 * Все текстуры — на 2× канве (без «битых пикселей»).
 */
window.GameCharacter = (() => {
  const BODY_R = 22;       // радиус тела (= PLAYER_RADIUS сервера)
  const HAND_LEN = 11;
  const HAND_W = 5;
  const AVA_SCALE = 2;     // аватар рисуется на 2× канве
  const FACE_SHIFT = 6;    // сдвиг «изображения в шарике» к взгляду (px)

  function colorOf(userId) {
    const palette = [0xff5c8a, 0x7c5cff, 0x3ecf8e, 0x38bdf8, 0xfb923c, 0xa78bfa];
    return palette[userId % palette.length];
  }

  /** Small outlined oval hands, partially tucked under the avatar rim. */
  function ensureHandTexture(scene) {
    if (scene.textures.exists('hand_tex')) return;
    const w = HAND_LEN + 4;
    const h = HAND_W * 2 + 4;
    const S = 2;
    const tex = scene.textures.createCanvas('hand_tex', w * S, h * S);
    const ctx = tex.getContext();
    ctx.scale(S, S);
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, HAND_LEN / 2, HAND_W, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1a2030';
    ctx.stroke();
    tex.refresh();
  }

  /** Перерисовать аватар в круге тела со смещением (клип по кругу) */
  function drawAvatar(c, sx, sy) {
    const tex = c.getData('avaCanvas');
    const img = c.getData('avaImg');
    if (!tex || !img || !img.complete || !img.naturalWidth) return;
    const size = BODY_R * 2 * AVA_SCALE;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (BODY_R - 1.5) * AVA_SCALE, 0, Math.PI * 2);
    ctx.clip();
    // запас 1.18× — чтобы при смещении не открывались края
    const s = Math.max(size / img.naturalWidth, size / img.naturalHeight) * 1.18;
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, size / 2 - w / 2 + sx * AVA_SCALE, size / 2 - h / 2 + sy * AVA_SCALE, w, h);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (BODY_R - 1.5) * AVA_SCALE, 0, Math.PI * 2);
    ctx.lineWidth = AVA_SCALE;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
    tex.refresh();
  }

  /** Создать контейнер персонажа. player.avatar — абсолютный URL фото (или null). */
  function create(scene, player) {
    ensureHandTexture(scene);
    const c = scene.add.container(player.x, player.y);
    c.depth = 10;

    // руки — ПЕРВЫМИ в контейнере: рисуются позади тела (приклеены к «шарику»)
    const armL = scene.add.image(0, 0, 'hand_tex');
    const armR = scene.add.image(0, 0, 'hand_tex');
    armL.setOrigin(0.5, 0.5).setTint(colorOf(player.userId)).setAlpha(0.92);
    armR.setOrigin(0.5, 0.5).setTint(colorOf(player.userId)).setAlpha(0.92);
    c.add(armL);
    c.add(armR);

    // тело
    const body = scene.add.circle(0, 0, BODY_R, colorOf(player.userId), 1);
    body.setStrokeStyle(2, 0xffffff, 0.65);
    c.add(body);

    // ободок (для игроков без фото; с фото — добавится поверх аватара)
    const rim = scene.add.circle(0, 0, BODY_R - 1);
    rim.setStrokeStyle(2, 0xffffff, 0.45);
    c.add(rim);

    // аватар: canvas-текстура, перерисовывается при сдвиге «изображения в шарике»
    const texKey = `ava_${player.userId}`;
    if (player.avatar) {
      if (scene.textures.exists(texKey)) scene.textures.remove(texKey); // реконнект — перегенерируем
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!scene.scene || !scene.textures || !c.list.includes(body)) return;
        const size = BODY_R * 2 * AVA_SCALE;
        const canvasTex = scene.textures.createCanvas(texKey, size, size);
        c.setData('avaCanvas', canvasTex);
        c.setData('avaImg', img);
        drawAvatar(c, 0, 0);
        const av = scene.add.image(0, 0, texKey);
        av.setDisplaySize(BODY_R * 2, BODY_R * 2);
        c.add(av); // поверх тела
        const rimTop = scene.add.circle(0, 0, BODY_R - 1);
        rimTop.setStrokeStyle(2, 0xffffff, 0.5);
        c.add(rimTop); // ободок поверх аватара
      };
      img.onerror = () => { /* остаётся цветной шарик */ };
      img.src = player.avatar;
    }

    // ник над персонажем
    const name = scene.add.text(0, -(BODY_R + 16), player.username, {
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '13px',
      color: '#fff',
      stroke: '#00000090',
      strokeThickness: 3,
    }).setOrigin(0.5);
    c.add(name);

    c.setData('armL', armL);
    c.setData('armR', armR);
    c.setData('body', body);
    c.setData('faceCur', Math.PI / 2);   // текущий угол взгляда (вниз)
    c.setData('faceTarget', Math.PI / 2);
    c.setData('walkPhase', 0);
    c.setData('shift', { x: 0, y: 0 });
    c.setData('dragState', { radius: 0, x: 0, y: 0 });

    applyHands(c, Math.PI / 2, false, 0);
    return c;
  }

  /** Small separated ovals sit at the sides; while dragging, both reach for the object. */
  function applyHands(c, face, moving, phase) {
    const armL = c.getData('armL');
    const armR = c.getData('armR');
    if (!armL || !armR) return;
    const drag = c.getData('dragState') || { radius: 0, x: 0, y: 0 };
    const dragRadius = drag.radius;
    if (dragRadius > 0) {
      const dragAngle = Math.atan2(drag.y, drag.x);
      const targetDistance = BODY_R + dragRadius + 12;
      const targetX = drag.x * targetDistance;
      const targetY = drag.y * targetDistance;
      const spread = Math.min(16, dragRadius * 0.45);
      for (const [arm, sign] of [[armL, -1], [armR, 1]]) {
        const shoulderAngle = dragAngle + sign * 0.9;
        const sx = Math.cos(shoulderAngle) * (BODY_R * 0.68);
        const sy = Math.sin(shoulderAngle) * (BODY_R * 0.68);
        const tx = targetX - drag.x * (dragRadius * 0.75);
        const ty = targetY - drag.y * (dragRadius * 0.75);
        const endX = tx - drag.y * spread * sign;
        const endY = ty + drag.x * spread * sign;
        const angle = Math.atan2(endY - sy, endX - sx);
        const reach = Math.hypot(endX - sx, endY - sy);
        arm.setPosition(sx, sy);
        arm.setOrigin(0, 0.5);
        arm.setRotation(angle);
        arm.setScale(Math.max(0.8, reach / (HAND_LEN + 4)), 1);
      }
      return;
    }
    const place = (arm, sign) => {
      const ha = face + sign * 1.05;
      arm.setPosition(Math.cos(ha) * (BODY_R * 0.86), Math.sin(ha) * (BODY_R * 0.86));
      arm.setOrigin(0.5, 0.5);
      let rot = ha;
      if (moving) rot += Math.sin(phase + (sign === 1 ? 0 : Math.PI)) * 0.05;
      arm.setRotation(rot).setScale(1);
    };
    place(armL, -1);
    place(armR, 1);
  }

  function setDragging(c, radius = 0, x = 0, y = 0) {
    if (c) c.setData('dragState', { radius, x, y });
  }

  /** Задать целевое направление взгляда (рад) — сглаживается в tick() */
  function setFaceAngle(c, angle) {
    if (!c || !Number.isFinite(angle)) return;
    c.setData('faceTarget', Math.atan2(Math.sin(angle), Math.cos(angle)));
  }

  /** Кадр персонажа: сглаживание взгляда, шаг ручек, сдвиг «изображения в шарике» */
  function tick(c, dt, moving) {
    if (!c) return;
    dt = Math.min(dt, 0.05);
    const cur = c.getData('faceCur') != null ? c.getData('faceCur') : Math.PI / 2;
    const target = c.getData('faceTarget') != null ? c.getData('faceTarget') : cur;
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const next = cur + diff * (1 - Math.exp(-14 * dt));
    c.setData('faceCur', next);

    // шаг-анимация ручек (плавное покачивание, фазы в противоход)
    const phase = (c.getData('walkPhase') || 0) + (moving ? dt * 13 : 0);
    c.setData('walkPhase', phase);
    applyHands(c, next, moving, phase);

    // «изображение в шарике» смещается в сторону взгляда
    const sx = Math.cos(next) * FACE_SHIFT;
    const sy = Math.sin(next) * FACE_SHIFT;
    const prev = c.getData('shift') || { x: 0, y: 0 };
    if (Math.abs(prev.x - sx) > 0.6 || Math.abs(prev.y - sy) > 0.6) {
      c.setData('shift', { x: sx, y: sy });
      drawAvatar(c, sx, sy);
    }
  }

  /** Подсветить активную руку (SS13): активная — ярче */
  function setActiveHand(c, hand) {
    const armL = c.getData('armL');
    const armR = c.getData('armR');
    if (!armL || !armR) return;
    armL.setAlpha(hand === 'left' ? 1 : 0.7);
    armR.setAlpha(hand === 'right' ? 1 : 0.7);
  }

  /** Точка «хватки» руки (для предметов в руках) */
  function handPoint(c, hand) {
    const face = c.getData('faceCur') != null ? c.getData('faceCur') : Math.PI / 2;
    const ha = face + (hand === 'left' ? -1.05 : 1.05);
    const d = BODY_R + 12;
    return { x: c.x + Math.cos(ha) * d, y: c.y + Math.sin(ha) * d, angle: ha };
  }

  /** Точка перед персонажем по взгляду (для двуручных предметов) */
  function frontPoint(c, dist = BODY_R + 16) {
    const face = c.getData('faceCur') != null ? c.getData('faceCur') : Math.PI / 2;
    return { x: c.x + Math.cos(face) * dist, y: c.y + Math.sin(face) * dist, angle: face };
  }

  return {
    create, setFaceAngle, tick, setActiveHand, setDragging, handPoint, frontPoint,
    BODY_R, HAND_LEN, colorOf,
  };
})();
