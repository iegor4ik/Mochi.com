const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { signToken, requireAuth } = require('../middleware/auth');
const { v, rateLimit } = require('../middleware/validate');
const { asyncH, bad, unauthorized, sanitizeTheme } = require('../utils/helpers');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, message: 'Слишком много попыток входа/регистрации. Подождите немного.' });

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    avatar_url: u.avatar_url,
    bio: u.bio,
    signature: u.signature,
    theme: u.theme || { mode: 'dark' },
    dm_policy: u.dm_policy || 'all',
    banned_until: u.banned_until,
    ban_reason: u.ban_reason,
    created_at: u.created_at,
  };
}

/** POST /api/auth/register */
router.post('/register', authLimiter, asyncH(async (req, res) => {
  const username = v.str(req.body.username, { label: 'Имя пользователя', min: 3, max: 24, pattern: /^[a-zA-Z0-9_]+$/ });
  const email = v.email(req.body.email);
  const password = v.str(req.body.password, { label: 'Пароль', min: 8, max: 128 });

  const dup = await query(
    'SELECT username, email FROM users WHERE lower(username)=$1 OR email=$2',
    [username.toLowerCase(), email]
  );
  if (dup.rows.length) {
    const d = dup.rows[0];
    throw bad(d.email === email ? 'Этот email уже зарегистрирован' : 'Это имя пользователя уже занято');
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1,$2,$3) RETURNING *`,
    [username, email, hash]
  );
  const user = rows[0];
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

/** POST /api/auth/login */
router.post('/login', authLimiter, asyncH(async (req, res) => {
  const login = v.str(req.body.login, { label: 'Логин', min: 3, max: 255 }).toLowerCase();
  const password = v.str(req.body.password, { label: 'Пароль', min: 1, max: 128 });

  const { rows } = await query(
    `SELECT *, CASE WHEN ban_reason IS NOT NULL AND (banned_until IS NULL OR banned_until > now())
                    THEN true ELSE false END AS is_banned
     FROM users WHERE lower(username)=$1 OR email=$1`,
    [login]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw unauthorized('Неверный логин или пароль');
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}));

/** GET /api/auth/me — текущий пользователь + счётчики */
router.get('/me', requireAuth, asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM notifications WHERE user_id=$1 AND read=false) AS unread_notifications,
       (SELECT COALESCE(SUM(x.c),0)::int FROM (
          SELECT COUNT(*)::int AS c FROM messages m
          JOIN conversations cv ON cv.id=m.conversation_id
          WHERE (cv.user1_id=$1 OR cv.user2_id=$1) AND m.sender_id<>$1 AND m.read_at IS NULL
        ) x) AS unread_messages`,
    [req.user.id]
  );
  res.json({ user: publicUser(req.user), ...rows[0] });
}));

module.exports = router;