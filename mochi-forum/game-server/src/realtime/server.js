/**
 * Realtime-слой игры: WebSocket-сервер на том же порту (путь /ws).
 * Правила: первый кадр обязательно auth (токен форума), до него ничего не
 * принимается (таймаут 10 с → close 4401); heartbeat 30 с; проверка Origin;
 * перепроверка банов раз в 5 минут; graceful shutdown с {type:'closing'}.
 * Токен в URL не передаётся — только первым кадром.
 */
const { WebSocketServer } = require('ws');
const { verifyToken } = require('../middleware/auth');
const { getProfile } = require('../utils/profile-cache');
const { getRoom, allRooms } = require('./room');

const AUTH_TIMEOUT_MS = 10 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const BAN_RECHECK_MS = 5 * 60 * 1000;
const MAX_FRAME_BYTES = 16 * 1024;

let wss = null;
let heartbeatTimer = null;
let banTimer = null;
let closing = false;

const sendTo = (ws, frame) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(frame));
};

/** Проверка Origin при upgrade (свой домен; в dev — localhost) */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // не-браузерные клиенты (тесты, сервисы)
  try {
    const o = new URL(origin);
    const host = req.headers.host || '';
    if (o.host === host) return true;
    // dev: страница с :3000, WS на :3001 — разрешаем localhost вне production
    if (process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(o.hostname)) return true;
  } catch { /* кривой Origin */ }
  return false;
}

/** Первый кадр: {type:'auth', token} */
async function handleAuth(ws, msg) {
  clearTimeout(ws.authTimer);
  ws.authTimer = null;
  const token = typeof msg.token === 'string' ? msg.token : '';
  try {
    const payload = verifyToken(token);
    const profile = await getProfile(payload.id, token);
    if (profile.is_banned) {
      sendTo(ws, { type: 'error', message: 'Аккаунт заблокирован' });
      ws.close(4401, 'banned');
      return;
    }
    ws.authed = true;
    ws.user = { id: profile.id, username: profile.username, avatar: profile.avatar || null };
    ws.token = token;
    sendTo(ws, { type: 'auth_ok', user: ws.user });
  } catch (e) {
    sendTo(ws, { type: 'error', message: e.message || 'Ошибка авторизации' });
    ws.close(4401, 'auth failed');
  }
}

/** Диспетчер сообщений после авторизации */
function handleMessage(ws, msg) {
  const room = ws.room;
  const player = room ? room.players.get(ws.user.id) : null;

  switch (msg.type) {
    case 'join': {
      if (room) {
        sendTo(ws, { type: 'error', message: 'Вы уже в локации' });
        return;
      }
      getRoom(msg.location).then(
        (target) => {
          if (!target) sendTo(ws, { type: 'error', message: 'Локация не найдена' });
          else target.addPlayer(ws, ws.user);
        },
        () => sendTo(ws, { type: 'error', message: 'Не удалось войти в локацию' })
      );
      return;
    }
    case 'move':
      if (player) room.setMoveTarget(player, msg);
      return;
    case 'face':
      if (player) room.setFace(player, msg.face);
      return;
    case 'chat':
      if (player) room.chat(player, msg.text);
      return;
    case 'interact':
      if (player) room.interact(player, msg);
      return;
    case 'use_exit':
      if (player) room.useExit(player, msg.exitId);
      return;
    default:
      sendTo(ws, { type: 'error', message: 'Неизвестный тип сообщения' });
  }
}

function setup(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch { /* оставим '/' */ }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.authed = false;
    ws.user = null;
    ws.token = null;
    ws.room = null;
    ws.on('pong', () => { ws.isAlive = true; });

    // до auth-кадра ничего не принимается; 10 с на авторизацию
    ws.authTimer = setTimeout(() => {
      if (!ws.authed) ws.close(4401, 'auth timeout');
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw) => {
      if (closing) return;
      if (raw.length > MAX_FRAME_BYTES) return; // гигантские кадры молча игнорируем
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return sendTo(ws, { type: 'error', message: 'Некорректный JSON' });
      }
      if (!msg || typeof msg !== 'object') return;
      if (!ws.authed) {
        if (msg.type === 'auth') handleAuth(ws, msg);
        else ws.close(4401, 'auth required');
        return;
      }
      try {
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[ws] handler:', e.message);
        sendTo(ws, { type: 'error', message: 'Внутренняя ошибка сервера' });
      }
    });

    ws.on('close', () => {
      clearTimeout(ws.authTimer);
      ws.authTimer = null;
      if (ws.room) ws.room.removePlayer(ws);
    });
    ws.on('error', () => { /* закрытие обработает 'close' */ });
  });

  // heartbeat ~30 с: мёртвые соединения закрываются
  heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  // периодическая перепроверка банов активных сессий (~5 минут)
  banTimer = setInterval(async () => {
    for (const ws of wss.clients) {
      if (!ws.authed || !ws.token) continue;
      try {
        const profile = await getProfile(ws.user.id, ws.token, { force: true });
        if (profile.is_banned) {
          sendTo(ws, { type: 'error', message: 'Аккаунт заблокирован' });
          ws.close(4401, 'banned');
        }
      } catch { /* форум недоступен — активные сессии живут на кэше */ }
    }
  }, BAN_RECHECK_MS);

  console.log('[ws] realtime-слой готов: /ws');
}

/** Graceful shutdown: closing всем → flush объектов → закрыть WS/HTTP */
async function shutdown(httpServer) {
  if (closing) return;
  closing = true;
  clearInterval(heartbeatTimer);
  clearInterval(banTimer);
  try {
    for (const room of allRooms()) await room.flushObjects();
  } catch (e) {
    console.error('[shutdown] flush:', e.message);
  }
  if (wss) {
    for (const ws of wss.clients) sendTo(ws, { type: 'closing' });
    wss.close();
  }
  if (httpServer) httpServer.close();
}

module.exports = { setup, shutdown };

