const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const uploadRoot = path.isAbsolute(UPLOAD_DIR)
  ? UPLOAD_DIR
  : path.join(__dirname, '..', '..', UPLOAD_DIR);

fs.mkdirSync(uploadRoot, { recursive: true });

const MAX_MB = +(process.env.MAX_UPLOAD_MB || 5);
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.bin').toLowerCase().slice(0, 8);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const imageUpload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Допустимы только изображения: JPEG, PNG, GIF, WebP'));
    }
    cb(null, true);
  },
});

/* ---------- Пользовательские шрифты (ttf/otf/woff/woff2) ---------- */
const fontsRoot = path.join(uploadRoot, 'fonts');
fs.mkdirSync(fontsRoot, { recursive: true });

const MAX_FONT_MB = +(process.env.MAX_FONT_MB || 10);
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);

const fontStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, fontsRoot),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.ttf').toLowerCase().slice(0, 6);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const fontUpload = multer({
  storage: fontStorage,
  limits: { fileSize: MAX_FONT_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!FONT_EXT.has(ext)) {
      return cb(new Error('Допустимы только шрифты: TTF, OTF, WOFF, WOFF2'));
    }
    cb(null, true);
  },
});

module.exports = { imageUpload, fontUpload, uploadRoot, fontsRoot };