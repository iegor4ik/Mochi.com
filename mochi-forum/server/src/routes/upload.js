const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { imageUpload, fontUpload } = require('../middleware/upload');

const router = express.Router();

/** POST /api/upload — загрузка изображения (аватар/пост/чат) */
router.post('/', requireAuth, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

/** POST /api/upload/font — загрузка пользовательского шрифта (TTF/OTF/WOFF/WOFF2) */
router.post('/font', requireAuth, fontUpload.single('font'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
  // имя семейства шрифта — из оригинального имени файла (без расширения)
  const base = require('path').basename(req.file.originalname, require('path').extname(req.file.originalname));
  const family = base.replace(/[^\wа-яА-ЯёЁ \-]/g, '').trim().slice(0, 48) || 'Custom Font';
  res.status(201).json({
    url: `/uploads/fonts/${req.file.filename}`,
    name: family,
  });
});

module.exports = router;