// Database connection. Every query in the app goes through these helpers.
import pg from 'pg';
import { config } from './config.js';

// Return numbers and dates in friendly formats.
pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT ids -> number
pg.types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC (e.g. 1.5 litres) -> number
pg.types.setTypeParser(1082, (v) => v); // DATE -> "2026-11-21" (no timezone surprises)

export function createPool(connectionString = config.databaseUrl) {
  return new pg.Pool({
    connectionString,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}

export let pool = createPool();

// Used by tests to point the app at the test database.
export async function usePool(newPool) {
  const old = pool;
  pool = newPool;
  if (old && old !== newPool) await old.end().catch(() => {});
}

export const query = (text, params) => pool.query(text, params);
export const many = async (text, params) => (await pool.query(text, params)).rows;
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

// Run several queries as one all-or-nothing unit (a "transaction").
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const helpers = {
      query: (t, p) => client.query(t, p),
      many: async (t, p) => (await client.query(t, p)).rows,
      one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    };
    const result = await fn(helpers);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
