require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { pool } = require('./config/db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const categoryRoutes = require('./routes/categories');
const topicRoutes = require('./routes/topics');
const postRoutes = require('./routes/posts');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const reportRoutes = require('./routes/reports');
const searchRoutes = require('./routes/search');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const userPostRoutes = require('./routes/user-posts');
const feedRoutes = require('./routes/feed');
const gchatRoutes = require('./routes/gchats');
const internalRoutes = require('./routes/internal'); // внутренний эндпоинт для игрового сервера
const { uploadRoot } = require('./middleware/upload');
const { ApiError } = require('./utils/helpers');

const app = express();
const PORT = +(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// статика: фронтенд и загруженные файлы
app.use('/uploads', express.static(uploadRoot, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/user-posts', userPostRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/gchats', gchatRoutes);
app.use('/api/internal', internalRoutes);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'M-o-chi.com', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 404 для API
app.use('/api', (req, res) => res.status(404).json({ error: 'Метод не найден' }));

// единый обработчик ошибок
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  // ошибки multer
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Файл слишком большой (макс. 5 МБ)' });
  }
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

// SPA fallback — отдаём index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🍡 M-o-chi.com запущен: http://localhost:${PORT}`);
});