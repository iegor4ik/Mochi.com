/**
 * Предметы: описания (категория/двуручность/радиус/размер) и canvas-текстуры
 * для новых видов. ball/box/stone рисуются из PNG-манифеста (assets.js),
 * остальные генерируются кодом на 2× канве — без «битых пикселей».
 * Предметы рисуются «лежащими вправо» (rot = направление взгляда).
 */
window.GameItems = (() => {
  const DEFS = {
    ball:        { cat: 'item', twoHanded: false, radius: 13, w: 34, h: 34, name: 'Мяч' },
    box:         { cat: 'item', twoHanded: false, radius: 16, w: 40, h: 36, name: 'Коробка' },
    stone:       { cat: 'item', twoHanded: false, radius: 13, w: 34, h: 30, name: 'Камень' },
    wrench:      { cat: 'item', twoHanded: false, radius: 14, w: 42, h: 22, name: 'Гаечный ключ' },
    screwdriver: { cat: 'item', twoHanded: false, radius: 12, w: 36, h: 16, name: 'Отвёртка' },
    crowbar:     { cat: 'item', twoHanded: true,  radius: 18, w: 66, h: 20, name: 'Лом' },
    sledge:      { cat: 'item', twoHanded: true,  radius: 18, w: 66, h: 24, holdOriginX: 0.28, holdDistance: 28, name: 'Кувалда' },
    crate:       { cat: 'pull', twoHanded: false, radius: 30, w: 60, h: 52, name: 'Большой ящик' },
    barrel:      { cat: 'pull', twoHanded: false, radius: 24, w: 44, h: 58, name: 'Бочка' },
  };

  const def = (k) => DEFS[k] || { cat: 'item', twoHanded: false, radius: 14, w: 32, h: 32, name: k };
  const OUT = '#1a2030'; // цвет контура (как у персонажей)

  /** Скруглённый прямоугольник (на случай отсутствия ctx.roundRect) */
  function rr(ctx, x, y, w, h, r) {
    const r2 = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r2, y);
    ctx.arcTo(x + w, y, x + w, y + h, r2);
    ctx.arcTo(x + w, y + h, x, y + h, r2);
    ctx.arcTo(x, y + h, x, y, r2);
    ctx.arcTo(x, y, x + w, y, r2);
    ctx.closePath();
  }

  const DRAW = {
    wrench(ctx, w, h) {
      const hy = h / 2;
      rr(ctx, w * 0.32, hy - 3.5, w * 0.62, 7, 3.5);
      ctx.fillStyle = '#a8b1bb'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.beginPath();
      ctx.arc(w * 0.2, hy, 7, -1.1, 4.6);
      ctx.lineWidth = 5.5; ctx.strokeStyle = '#a8b1bb'; ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
    },
    screwdriver(ctx, w, h) {
      const hy = h / 2;
      rr(ctx, 2, hy - 5, w * 0.32, 10, 3);
      ctx.fillStyle = '#d1495b'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
      rr(ctx, 2 + w * 0.32, hy - 2.2, w * 0.52, 4.4, 1.5);
      ctx.fillStyle = '#aab2bd'; ctx.fill(); ctx.stroke();
      rr(ctx, w - 7, hy - 1.6, 5, 3.2, 1);
      ctx.fillStyle = '#7d8794'; ctx.fill(); ctx.stroke();
    },
    crowbar(ctx, w, h) {
      const hy = h / 2;
      rr(ctx, w * 0.08, hy - 3.5, w * 0.84, 7, 3.5);
      ctx.fillStyle = '#d9572b'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
      rr(ctx, 2, hy - 9, 9, 7, 3);
      ctx.fillStyle = '#d9572b'; ctx.fill(); ctx.stroke();
      rr(ctx, w - 11, hy + 2, 9, 7, 3);
      ctx.fillStyle = '#d9572b'; ctx.fill(); ctx.stroke();
    },
    sledge(ctx, w, h) {
      const hy = h / 2;
      rr(ctx, w * 0.22, hy - 3, w * 0.74, 6, 3);
      ctx.fillStyle = '#b08a5a'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
      rr(ctx, 2, hy - 9, 12, 18, 3);
      ctx.fillStyle = '#8a93a8'; ctx.fill(); ctx.stroke();
    },
    crate(ctx, w, h) {
      rr(ctx, 2, 2, w - 4, h - 4, 4);
      ctx.fillStyle = '#b98a4e'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.lineWidth = 5; ctx.strokeStyle = '#a2793f';
      ctx.beginPath();
      ctx.moveTo(7, 7); ctx.lineTo(w - 7, h - 7);
      ctx.moveTo(w - 7, 7); ctx.lineTo(7, h - 7);
      ctx.stroke();
      ctx.lineWidth = 1.6; ctx.strokeStyle = OUT;
      ctx.strokeRect(7, 7, w - 14, h - 14);
    },
    barrel(ctx, w, h) {
      rr(ctx, 3, 3, w - 6, h - 6, 7);
      ctx.fillStyle = '#6c7c94'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.fillStyle = '#55637a';
      ctx.fillRect(5, h * 0.28, w - 10, 5);
      ctx.fillRect(5, h * 0.6, w - 10, 5);
      ctx.lineWidth = 1.4; ctx.strokeStyle = OUT;
      ctx.strokeRect(5, h * 0.28, w - 10, 5);
      ctx.strokeRect(5, h * 0.6, w - 10, 5);
    },
  };

  /** Сгенерировать canvas-текстуры item_* (манифестные виды не трогаем). */
  function ensureTextures(scene) {
    const S = 2;
    for (const [kind, d] of Object.entries(DEFS)) {
      const key = 'item_' + kind;
      if (scene.textures.exists(key)) continue;
      const cw = (d.w + 4) * S, ch = (d.h + 4) * S;
      const tex = scene.textures.createCanvas(key, cw, ch);
      const ctx = tex.getContext();
      ctx.scale(S, S);
      ctx.translate(2, 2);
      (DRAW[kind] || DRAW.crate)(ctx, d.w, d.h);
      tex.refresh();
    }
  }

  /** Ключ текстуры: манифест в приоритете (ball/box/stone — PNG), иначе item_* */
  function texKey(kind) {
    if (window.GAME_ASSETS && window.GAME_ASSETS[kind] && window.GAME_ASSETS[kind].src) return kind;
    return 'item_' + kind;
  }

  return { DEFS, def, ensureTextures, texKey };
})();
