/* Конфиг игры «Хаб» (M-o-chi.com). В prod игра живёт на том же домене в /game/. */
window.GAME_CONFIG = (() => {
  // prod: nginx проксирует /game/* → game-server; dev: страница с :3000, API на :3001
  const isDev = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '3000';

  return {
    isDev,
    // REST игрового сервера (fetch с Bearer-токеном форума из localStorage.mochi_token)
    GAME_API_BASE: isDev ? 'http://localhost:3001' : '/game',
    // WebSocket игрового сервера
    GAME_WS_URL: isDev ? 'ws://localhost:3001/ws' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game/ws`,
    // префикс основного сайта для аватаров /uploads/... (в dev они на :3000)
    MAIN_ORIGIN: isDev ? 'http://localhost:3000' : '',
    // управление (клавиши вынесены сюда по ТЗ §7)
    KEYS: {
      up: ['W', 'UP'],
      down: ['S', 'DOWN'],
      left: ['A', 'LEFT'],
      right: ['D', 'RIGHT'],
      interact: ['E'],  // взять / использовать (с предметом в руках) / дверь
      put: ['Q'],       // положить (бросок — Ctrl+Q в сторону курсора)
    },
    // клиентские константы движения
    MOVE_SEND_HZ: 15,        // частота отправки move (10–15 Гц по ТЗ)
    MAX_SPEED: 220,          // px/s — совпадает с серверным лимитом (важно для предсказания)
    DRAG_SPEED_MULTIPLIER: 0.25,
    SCALE: 1,                // зум камеры
  };
})();
