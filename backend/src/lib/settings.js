// Runtime switches stored in the database (changed from the admin console, no app update needed).
import { one, query } from '../db.js';
import { forbidden } from '../middleware/errors.js';

export const DEFAULT_SERVICES = { grocery: true, milk: true, food: false, rides: false };

export async function getServices() {
  const row = await one("SELECT value FROM settings WHERE key = 'services'");
  return { ...DEFAULT_SERVICES, ...(row?.value || {}) };
}

export async function setServices(patch) {
  const next = { ...(await getServices()), ...patch };
  await query(
    `INSERT INTO settings (key, value) VALUES ('services', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(next)],
  );
  return next;
}

export async function requireService(name) {
  const services = await getServices();
  if (!services[name]) throw forbidden(`${name[0].toUpperCase() + name.slice(1)} is not available in your area yet`);
}
