/**
 * МАНИФЕСТ СПРАЙТОВ игры «Хаб» — единственный источник картинок (ТЗ §9).
 * Сцена (world.js) не знает путей: всё идёт через GameAssets.*.
 *
 * «Почва» для будущей вставки фото/редактирования спрайтов: чтобы заменить
 * PNG или вставить фото в спрайт — меняется только этот манифест/загрузчик,
 * код сцены не трогается. Аватар игрока — dynamic (приходит из профиля).
 */
window.GAME_ASSETS = {
  floor:  { src: 'js/game/assets/floor.png', size: 64 },
  wall:   { src: 'js/game/assets/wall.png' },
  door:   { src: 'js/game/assets/door.png' },
  ball:   { src: 'js/game/assets/ball.png' },
  box:    { src: 'js/game/assets/box.png' },
  stone:  { src: 'js/game/assets/stone.png' },
  avatar: { dynamic: true }, // фото игрока приходит из профиля (§8)
};

/** Адаптер загрузки: ключ манифеста → текстура Phaser (или Graphics-плейсхолдер) */
window.GameAssets = (() => {
  const MANIFEST = window.GAME_ASSETS;

  // плейсхолдеры-цвета, если PNG нет (те же ключи манифеста, см. ТЗ §9)
  const FALLBACK = {
    floor: 0x2c3550,
    wall: 0x4a5578,
    door: 0xffb84d,
    ball: 0xff5c8a,
    box: 0xc9a26b,
    stone: 0x8a93a8,
  };

  /** Зарегистрировать все текстуры в Phaser loader/генераторе */
  function loadAll(scene) {
    for (const [key, def] of Object.entries(MANIFEST)) {
      if (def.dynamic) continue; // аватар рисуется динамически (character.js)
      // грузим PNG; при ошибке — Graphics-плейсхолдер с тем же ключом
      scene.load.image(key, def.src);
    }
    scene.load.once('loaderror', (fileObj) => {
      const key = fileObj.key;
      const color = FALLBACK[key] || 0x888888;
      const size = (MANIFEST[key] && MANIFEST[key].size) || 64;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(color, 1);
      g.fillRect(0, 0, size, size);
      g.lineStyle(2, 0x000000, 0.25);
      g.strokeRect(0, 0, size, size);
      g.generateTexture(key, size, size);
      g.destroy();
    });
  }

  return { loadAll };
})();
