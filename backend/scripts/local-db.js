// Runs a real PostgreSQL database on your laptop with no installation.
// Keep this window open while you work. Press Ctrl+C to stop it. Data is kept in ./.localdb
//
// If this does not work on your computer, use a free cloud database instead
// (Neon or Supabase) and put its connection string in DATABASE_URL in .env.
import fs from 'node:fs';
import path from 'node:path';

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch {
  console.error('The local database package is not installed. Run "npm install" first,');
  console.error('or use a free cloud database (see README) and skip this step.');
  process.exit(1);
}

const dir = path.resolve('.localdb');
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'gaongo',
  port: 5433,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
  console.log('First run: creating the local database files...');
  await pg.initialise();
}
await pg.start();
for (const name of ['gaongo', 'gaongo_test']) {
  try {
    await pg.createDatabase(name);
  } catch {
    // already exists
  }
}

console.log('\nLocal PostgreSQL is running on port 5433.');
console.log('  App database:  postgres://postgres:gaongo@localhost:5433/gaongo');
console.log('  Test database: postgres://postgres:gaongo@localhost:5433/gaongo_test');
console.log('Keep this window open. Press Ctrl+C to stop.\n');

const stop = async () => {
  console.log('\nStopping the database...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30); // keep running