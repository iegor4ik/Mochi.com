require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: +(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'mochi',
        password: process.env.PGPASSWORD || 'mochi_secret',
        database: process.env.PGDATABASE || 'mochi',
      }
);

pool.on('error', (err) => console.error('[db] unexpected error:', err.message));

/** Выполнить параметризованный запрос */
async function query(text, params) {
  return pool.query(text, params);
}

/** Выполнить несколько запросов в транзакции */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };