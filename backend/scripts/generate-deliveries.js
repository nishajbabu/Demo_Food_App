// Prepares today's and tomorrow's milk delivery rows. The server already does this every hour;
// you can also run it from a scheduled job ("cron") on your hosting:  npm run deliveries:generate
import { pool } from '../src/db.js';
import { addDays, todayIST } from '../src/lib/time.js';
import { ensureDeliveriesForDate } from '../src/services/subscriptions.js';

const today = todayIST();
const a = await ensureDeliveriesForDate(today);
const b = await ensureDeliveriesForDate(addDays(today, 1));
console.log(`Created ${a} delivery rows for ${today} and ${b} for ${addDays(today, 1)}.`);
await pool.end();
