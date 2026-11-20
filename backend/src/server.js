// Starts the API server.  Development: npm run dev   Production: npm start
import os from 'node:os';
import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db.js';
import { notify } from './lib/sms.js';
import { addDays, todayIST } from './lib/time.js';
import { expireStaleOrders } from './services/orders.js';
import { ensureDeliveriesForDate } from './services/subscriptions.js';

const app = createApp();

app.listen(config.port, '0.0.0.0', async () => {
  console.log(`\nGaonGo API running on port ${config.port}`);
  // Phones can't reach "localhost" on your laptop; they need the laptop's Wi-Fi address.
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  console.log(`  On this laptop:   http://localhost:${config.port}`);
  for (const a of addrs) console.log(`  For phone apps:   http://${a}:${config.port}`);
  if (config.otp.devMode) console.log('  OTP dev mode is ON: login codes are printed here.\n');

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('\nCannot reach the database. Check DATABASE_URL in .env and that the database is running.');
    console.error(`  ${err.message}\n`);
  }
});

// Once an hour, prepare today's and tomorrow's milk delivery rows (safe to repeat).
async function prepareDeliveries() {
  try {
    await ensureDeliveriesForDate(todayIST());
    await ensureDeliveriesForDate(addDays(todayIST(), 1));
  } catch (err) {
    console.error('Could not prepare subscription deliveries:', err.message);
  }
}
setTimeout(prepareDeliveries, 5_000);
setInterval(prepareDeliveries, 60 * 60 * 1000);

// Every 2 minutes, clean up unpaid or shop-ignored orders so none hang forever.
setInterval(async () => {
  try {
    const { unaccepted } = await expireStaleOrders();
    for (const o of unaccepted) notify(o.customer_id, `Sorry, order GG-${o.id} timed out as the shop was busy.`);
  } catch (err) {
    console.error('Could not expire stale orders:', err.message);
  }
}, 2 * 60 * 1000);