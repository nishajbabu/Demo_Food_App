// Creates (or promotes) an admin user on any database, e.g. your real production server.
//   npm run admin:create -- 9876543210 "Your Name"
import { createPool } from '../src/db.js';

const [phone, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ') || 'Admin';
if (!/^[6-9]\d{9}$/.test(phone || '')) {
  console.error('Usage: npm run admin:create -- 9876543210 "Your Name"');
  process.exit(1);
}
const pool = createPool();
const { rows } = await pool.query(
  `INSERT INTO users (phone, name, role) VALUES ($1, $2, 'admin')
   ON CONFLICT (phone) DO UPDATE SET role = 'admin', name = COALESCE(users.name, EXCLUDED.name)
   RETURNING id, phone, name, role`,
  [phone, name],
);
console.log('Admin ready:', rows[0]);
await pool.end();
