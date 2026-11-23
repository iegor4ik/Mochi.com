const express = require('express');
const { query } = require('../config/db');
const { asyncH } = require('../utils/helpers');

const router = express.Router();

/** GET /api/health — «пульс» игрового сервиса (+ состояние БД игры) */
router.get('/', asyncH(async (req, res) => {
  let db = 'ok';
  try {
    await query('SELECT 1');
  } catch {
    db = 'down'; // сервис жив, но БД недоступна — контейнер всё равно отвечает
  }
  res.json({ ok: true, service: 'M-o-chi game hub', db, time: new Date().toISOString() });
}));

module.exports = router;
