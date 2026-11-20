// Creates all tables from db/schema.sql.
//   npm run db:migrate          -> create anything missing (safe, keeps data)
//   npm run db:reset            -> DELETE EVERYTHING and start fresh (refuses in production)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { createPool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = fs.readFileSync(path.join(here, '..', 'db', 'schema.sql'), 'utf8');

export async function migrate({ url = config.databaseUrl, reset = false } = {}) {
  const pool = createPool(url);
  try {
    if (reset) {
      if (config.isProduction) throw new Error('Refusing to reset a production database');
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await pool.query(schema);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reset = process.argv.includes('--reset');
  migrate({ reset })
    .then(() => console.log(reset ? 'Database wiped and tables created.' : 'Tables are up to date.'))
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}
