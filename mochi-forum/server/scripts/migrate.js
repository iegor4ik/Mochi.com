/**
 * Мигратор: применяет SQL-файлы из db/migrations в порядке имён.
 * Применённые файлы фиксируются в schema_migrations и пропускаются при повторном запуске.
 */
const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('../src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function ensureJournal() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function run() {
  await ensureJournal();
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`Применяю миграцию ${file} ... `);
    try {
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      });
      console.log('OK');
      count++;
    } catch (e) {
      console.log('ОШИБКА');
      console.error(e.message);
      process.exitCode = 1;
      break;
    }
  }
  if (count === 0) console.log('Миграции актуальны — новых нет.');
  await pool.end();
}

run().catch((e) => {
  console.error('[migrate] fatal:', e.message);
  process.exit(1);
});