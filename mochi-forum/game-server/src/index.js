require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const healthRoutes = require('./routes/health');
const { ApiError } = require('./utils/helpers');

const app = express();
const PORT = +(process.env.PORT || 3001);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// REST игрового сервера
app.use('/api/health', healthRoutes);
app.use('/api/me', require('./routes/me'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/locations', require('./routes/chat')); // GET /api/locations/:slug/chat

// 404 для API
app.use('/api', (req, res) => res.status(404).json({ error: 'Метод не найден' }));

// единый обработчик ошибок
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

// HTTP-сервер; WebSocket-слой подключается на этот же порт (путь /ws)
const server = http.createServer(app);
const realtime = require('./realtime/server');
realtime.setup(server);

server.listen(PORT, () => {
  console.log(`🎮 Игровой сервер «Хаб» запущен: http://localhost:${PORT}`);
});

// Graceful shutdown (SIGTERM/SIGINT): closing всем → flush в БД → закрыть WS/HTTP → exit
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[shutdown] останавливаю игровой сервер...');
  await realtime.shutdown(server);
  const { pool } = require('./config/db');
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown); // Windows: эмуляция SIGTERM
// Диагностика: не даем процессу молча умирать от необработанных ошибок
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && (e.stack || e.message));
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && (e.reason ? (e.reason.stack || e.reason.message) : e));
});
// Тест-хук: авто-shutdown через N мс (интеграционные тесты graceful shutdown)
if (process.env.TEST_AUTO_SHUTDOWN_MS) {
  setTimeout(() => shutdown(), +process.env.TEST_AUTO_SHUTDOWN_MS);
}


module.exports = { app, server };

