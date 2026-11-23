/**
 * Анализ и очистка неиспользуемых загрузок.
 *   node scripts/cleanup-uploads.js          — отчёт (dry-run)
 *   node scripts/cleanup-uploads.js --clean  — удалить файлы-сироты
 *
 * Учитываются ссылки на /uploads/... в: users.avatar_url, gchats (photo,
 * desc_bg, head_bg, theme, description html), messages, gchat_messages,
 * user_posts (cover_image + content html), topics.image_url, posts.image_url.
 * Папка uploads/fonts не трогается (шрифты подключаются в CSS по имени файла).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const UPLOADS = path.join(__dirname, '..', 'uploads');
const CLEAN = process.argv.includes('--clean');

const URL_RE = /\/uploads\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+/g;

function extractUrls(str) {
  if (!str) return [];
  const out = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(String(str))) !== null) out.push(m[0]);
  return out;
}

async function referencedUrls() {
  const set = new Set();
  const add = (rows, cols) => {
    for (const r of rows) for (const c of cols) for (const u of extractUrls(r[c])) set.add(u);
  };
  const q = (text) => pool.query(text);

  add((await q('SELECT avatar_url FROM users')).rows, ['avatar_url']);

  const chats = (await q('SELECT photo, description, desc_bg, head_bg, theme FROM gchats')).rows;
  for (const c of chats) {
    for (const u of extractUrls(c.photo)) set.add(u);
    for (const u of extractUrls(c.description && c.description.html)) set.add(u);
    for (const j of [c.desc_bg, c.head_bg, c.theme]) {
      if (j && j.url) set.add(j.url);
    }
  }

  add((await q('SELECT image_url FROM messages')).rows, ['image_url']);
  add((await q('SELECT image_url FROM gchat_messages')).rows, ['image_url']);
  add((await q('SELECT cover_image, content FROM user_posts')).rows, ['cover_image', 'content']);
  add((await q('SELECT image_url FROM topics')).rows, ['image_url']);
  add((await q('SELECT image_url FROM posts')).rows, ['image_url']);

  // шрифты: user_posts.content.fonts + gchats.theme.fonts
  const fontRows = await q("SELECT content->'fonts' AS fonts FROM user_posts WHERE content ? 'fonts'");
  for (const r of fontRows.rows) for (const f of r.fonts || []) set.add(f.url);
  const themeFonts = await q("SELECT theme->'fonts' AS fonts FROM gchats WHERE theme ? 'fonts'");
  for (const r of themeFonts.rows) for (const f of r.fonts || []) set.add(f.url);

  return set;
}

async function main() {
  const refs = await referencedUrls();
  console.log(`Referenced uploads in DB: ${refs.size}`);

  const files = fs.readdirSync(UPLOADS)
    .filter((f) => fs.statSync(path.join(UPLOADS, f)).isFile())
    .map((f) => '/uploads/' + f);

  const orphans = files.filter((u) => !refs.has(u));
  const missing = [...refs].filter((u) => !files.includes(u));

  console.log(`Files on disk: ${files.length}`);
  console.log(`Orphans (on disk, not referenced): ${orphans.length}`);
  if (missing.length) console.log(`Referenced but missing on disk: ${missing.length}\n  ` + missing.join('\n  '));

  if (!orphans.length) { console.log('Nothing to clean.'); await pool.end(); return; }

  let totalSize = 0;
  for (const u of orphans) {
    const p = path.join(UPLOADS, path.basename(u));
    try { totalSize += fs.statSync(p).size; } catch { /* файл мог исчезнуть */ }
  }
  console.log(`Orphans size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(orphans.slice(0, 20).join('\n') + (orphans.length > 20 ? `\n… и ещё ${orphans.length - 20}` : ''));

  if (CLEAN) {
    let deleted = 0;
    for (const u of orphans) {
      try { fs.unlinkSync(path.join(UPLOADS, path.basename(u))); deleted++; }
      catch (e) { console.error('skip', u, e.message); }
    }
    console.log(`Deleted: ${deleted} files`);
  } else {
    console.log('Dry-run. Запустите с --clean для удаления.');
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
