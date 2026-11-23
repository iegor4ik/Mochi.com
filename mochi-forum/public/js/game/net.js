/**
 * WS-клиент игры «Хаб»: подключение, auth-кадр (токен форума, НЕ в URL),
 * автопереподключение с очередью исходящих кадров, обработка closing.
 */
window.GameNet = (() => {
  const CFG = window.GAME_CONFIG;

  let ws = null;
  let authed = false;
  let closing = false; // сервер объявил closing — не переподключаемся
  let reconnectT = null;
  let attempts = 0;
  const queue = [];   // кадры, отправленные до открытия/авторизации
  const handlers = {}; // type → [fn(frame)]

  const TOKEN_KEY = 'mochi_token';

  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
  }

  function emit(frame) {
    const list = handlers[frame.type];
    if (list) for (const fn of list) {
      try { fn(frame); } catch (e) { console.error('[net] handler:', e); }
    }
  }

  function connect() {
    if (closing) return;
    clearTimeout(reconnectT);
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      emit({ type: '_no_token' });
      return;
    }
    try {
      ws = new WebSocket(CFG.GAME_WS_URL);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      // первый кадр — строго auth (токен не передаём в URL)
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (ev) => {
      let frame;
      try { frame = JSON.parse(ev.data); } catch { return; }
      if (frame.type === 'auth_ok') {
        authed = true;
        attempts = 0;
        // после авторизации уводим накопленную очередь
        while (queue.length) ws.send(JSON.stringify(queue.shift()));
      }
      if (frame.type === 'closing') {
        closing = true;
      }
      emit(frame);
    };

    ws.onclose = (ev) => {
      authed = false;
      if (ev.code === 4401) {
        emit({ type: '_auth_failed' }); // неверный/просроченный токен
        return;
      }
      scheduleReconnect();
    };

    ws.onerror = () => { /* закроется через onclose */ };
  }

  function scheduleReconnect() {
    if (closing) return;
    attempts += 1;
    const delay = Math.min(8000, 800 * attempts);
    reconnectT = setTimeout(connect, delay);
  }

  /** Отправка кадра (или постановка в очередь до открытия) */
  function send(obj) {
    if (ws && ws.readyState === 1) {
      if (!authed && obj.type !== 'auth') {
        queue.push(obj); // до auth_ok кадры копим
        return;
      }
      ws.send(JSON.stringify(obj));
    } else if (!closing) {
      queue.push(obj);
    }
  }

  /** Разорвать соединение (уход со страницы игры) */
  function close() {
    closing = true;
    clearTimeout(reconnectT);
    if (ws) try { ws.close(); } catch { /* уже закрыт */ }
  }

  /** Сбросить флаг closing (после перехода между hash-маршрутами внутри игры) */
  function revive() {
    closing = false;
  }

  return { connect, send, on, close, revive, get connected() { return authed; } };
})();
