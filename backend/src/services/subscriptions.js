// Subscription rules: which days a delivery happens, the dairy's daily sheet, and the monthly bill.
import { config } from '../config.js';
import { many, query } from '../db.js';
import { addDays, daysBetween, hourIST, todayIST, weekday } from '../lib/time.js';

// Customers can change tomorrow's delivery until 9 PM tonight; after that, the day after.
export function earliestChangeDate() {
  return hourIST() >= config.rules.subscriptionCutoffHour ? addDays(todayIST(), 2) : addDays(todayIST(), 1);
}

export function isDeliveryDay(sub, date) {
  if (date < sub.start_date) return false;
  if (sub.frequency === 'daily') return true;
  if (sub.frequency === 'alternate') return daysBetween(sub.start_date, date) % 2 === 0;
  if (sub.frequency === 'weekly') return weekday(date) === weekday(sub.start_date);
  return false;
}

// Next N days for the customer's calendar: is it a delivery day, and did they skip it?
export function calendar(sub, skippedDates, from, days = 7) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    const delivery = sub.status === 'active' && isDeliveryDay(sub, date);
    out.push({ date, delivery, skipped: delivery && skippedDates.has(date) });
  }
  return out;
}

/**
 * Make sure the delivery rows exist for a date (today or a few days ahead).
 * Safe to call many times: rows that exist are left alone.
 * Called when a dairy opens its sheet, and by the daily job (npm run deliveries:generate).
 */
export async function ensureDeliveriesForDate(date, { merchantId = null } = {}) {
  const today = todayIST();
  if (date < today || date > addDays(today, 7)) return 0;
  const subs = await many(
    `SELECT s.*, p.price_paise
       FROM subscriptions s
       JOIN products p ON p.id = s.product_id
      WHERE s.status = 'active' AND s.start_date <= $1
        AND ($2::bigint IS NULL OR s.merchant_id = $2)
        AND NOT EXISTS (SELECT 1 FROM subscription_skips k WHERE k.subscription_id = s.id AND k.skip_date = $1)`,
    [date, merchantId],
  );
  let created = 0;
  for (const s of subs) {
    if (!isDeliveryDay(s, date)) continue;
    const r = await query(
      `INSERT INTO subscription_deliveries (subscription_id, delivery_date, qty, unit_price_paise, amount_paise)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (subscription_id, delivery_date) DO NOTHING`,
      [s.id, date, s.qty, s.price_paise, Math.round(s.price_paise * s.qty)],
    );
    created += r.rowCount;
  }
  return created;
}

// Remove not-yet-delivered rows from a date onwards (after a pause, cancel or skip).
export async function clearScheduled(subscriptionId, fromDate, onlyDate = null) {
  if (onlyDate) {
    await query("DELETE FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2 AND status = 'scheduled'", [
      subscriptionId,
      onlyDate,
    ]);
  } else {
    await query("DELETE FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date >= $2 AND status = 'scheduled'", [
      subscriptionId,
      fromDate,
    ]);
  }
}
