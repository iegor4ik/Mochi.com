/**
 * Управление жизненным циклом загруженных файлов.
 * releaseUpload(url) — удаляет файл с диска, ТОЛЬКО если в БД не осталось
 * ни одной ссылки на него (файл мог быть скопирован в сообщение, описание
 * чатса или HTML поста — тогда он сохраняется).
 */
const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const SAFE_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const URL_RE = /\/uploads\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+/g;


/** Собрать все /uploads/... URL из произвольной строки/JSONB */
function extractUploadUrls(str) {
  if (!str) return [];
  const out = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(String(str))) !== null) out.push(m[0]);
  return out;
}

/** Сколько раз URL используется в БД (по всем «слотам») */
async function countRefs(url) {
  const { rows } = await query(
    `SELECT (
       (SELECT COUNT(*) FROM users WHERE avatar_url = $1) +
       (SELECT COUNT(*) FROM gchats WHERE photo = $1
          OR description->>'html' LIKE '%' || $1 || '%'
          OR desc_bg->>'url' = $1 OR head_bg->>'url' = $1
          OR theme->>'bgImage' = $1
          OR (theme->'fonts')::text LIKE '%' || $1 || '%') +
       (SELECT COUNT(*) FROM messages WHERE image_url = $1) +
       (SELECT COUNT(*) FROM gchat_messages WHERE image_url = $1 AND deleted = false) +
       (SELECT COUNT(*) FROM user_posts WHERE cover_image = $1
          OR content->>'html' LIKE '%' || $1 || '%'
          OR (content->'fonts')::text LIKE '%' || $1 || '%') +
       (SELECT COUNT(*) FROM topics WHERE image_url = $1) +
       (SELECT COUNT(*) FROM posts WHERE image_url = $1)
     ) AS n`,
    [url]
  );
  return rows[0].n || 0;
}

/** Удалить файл с диска, если он больше нигде не используется */
async function releaseUpload(url) {
  try {
    if (!url || typeof url !== 'string' || !SAFE_RE.test(url)) return false;
    const p = path.join(UPLOADS_ROOT, path.basename(url));
    if (!fs.existsSync(p)) return false;
    const n = await countRefs(url);
    if (n > 0) return false; // файл используется где-то ещё — сохраняем
    fs.unlinkSync(p);
    return true;
  } catch (e) {
    console.error('[uploads] release error:', e.message);
    return false;
  }
}

/** Удалить список файлов (каждый — с проверкой ссылок) */
async function releaseMany(urls) {
  let n = 0;
  for (const u of urls || []) if (await releaseUpload(u)) n++;
  return n;
}

module.exports = { UPLOADS_ROOT, extractUploadUrls, releaseUpload, releaseMany };
