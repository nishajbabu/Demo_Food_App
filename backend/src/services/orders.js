// Shared order logic: status changes, loading an order with its details.
import { many, one, tx } from '../db.js';
import { conflict, notFound } from '../middleware/errors.js';
import { camel } from '../lib/util.js';

const TIMESTAMP_FOR = {
  accepted: 'accepted_at',
  ready: 'ready_at',
  picked_up: 'picked_up_at',
  delivered: 'delivered_at',
};

/**
 * Move an order from one of the allowed statuses to a new one, safely.
 * If someone else changed it first (e.g. two riders tapping Accept), nothing happens
 * and we return a clear error.
 *
 * extraSet: more columns to update, e.g. { rider_id: 7 }
 * guard:    extra condition, e.g. { column: 'merchant_id', value: 3 }
 */
export async function moveOrder({ orderId, from, to, actorId, note, extraSet = {}, guard }) {
  return tx(async (db) => {
    const sets = ['status = $2'];
    const params = [orderId, to, from];
    if (TIMESTAMP_FOR[to]) sets.push(`${TIMESTAMP_FOR[to]} = now()`);
    for (const [col, val] of Object.entries(extraSet)) {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
    let where = 'id = $1 AND status = ANY($3)';
    if (guard) {
      params.push(guard.value);
      where += ` AND ${guard.column} = $${params.length}`;
    }
    const order = await db.one(`UPDATE orders SET ${sets.join(', ')} WHERE ${where} RETURNING *`, params);
    if (!order) {
      const exists = await db.one('SELECT status FROM orders WHERE id = $1', [orderId]);
      if (!exists) throw notFound('Order not found');
      throw conflict(`This order is already "${exists.status.replace('_', ' ')}"`);
    }
    await db.query('INSERT INTO order_events (order_id, status, actor_id, note) VALUES ($1, $2, $3, $4)', [
      orderId,
      to,
      actorId,
      note || null,
    ]);
    return order;
  });
}

// Everything a screen needs about one order.
export async function loadOrder(orderId, { includeOtp = false, includePickupCode = false } = {}) {
  const order = await one(
    `SELECT o.*, m.name AS merchant_name, m.landmark AS merchant_landmark, mu.phone AS merchant_phone,
            c.name AS customer_name, c.phone AS customer_phone,
            r.name AS rider_name, r.phone AS rider_phone, v.name AS village_name
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       JOIN users mu ON mu.id = m.owner_id
       JOIN users c ON c.id = o.customer_id
       JOIN villages v ON v.id = o.village_id
       LEFT JOIN users r ON r.id = o.rider_id
      WHERE o.id = $1`,
    [orderId],
  );
  if (!order) return null;
  order.items = await many('SELECT id, product_id, name, unit, price_paise, qty FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  order.events = await many('SELECT status, note, created_at FROM order_events WHERE order_id = $1 ORDER BY id', [orderId]);
  if (!includeOtp) delete order.delivery_otp;
  if (!includePickupCode) delete order.pickup_code;
  order.code = `GG-${order.id}`;
  return camel(order);
}

// A short list view with items attached (for merchant and rider screens).
export async function listOrders(whereSql, params, { limit = 50, includePickupCode = false } = {}) {
  const rows = await many(
    `SELECT o.*, m.name AS merchant_name, m.landmark AS merchant_landmark, mu.phone AS merchant_phone,
            m.lat AS merchant_lat, m.lng AS merchant_lng,
            c.name AS customer_name, c.phone AS customer_phone, r.name AS rider_name, r.phone AS rider_phone,
            v.name AS village_name
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       JOIN users mu ON mu.id = m.owner_id
       JOIN users c ON c.id = o.customer_id
       JOIN villages v ON v.id = o.village_id
       LEFT JOIN users r ON r.id = o.rider_id
      WHERE ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT ${Number(limit)}`,
    params,
  );
  if (!rows.length) return [];
  const items = await many(
    'SELECT order_id, name, unit, price_paise, qty FROM order_items WHERE order_id = ANY($1) ORDER BY id',
    [rows.map((r) => r.id)],
  );
  return rows.map((o) => {
    delete o.delivery_otp;
    if (!includePickupCode) delete o.pickup_code;
    return camel({ ...o, code: `GG-${o.id}`, items: items.filter((i) => i.order_id === o.id) });
  });
}

// Auto-close orders that stay unpaid (15 min) or ignored by a shop (20 min).
export async function expireStaleOrders() {
  const unpaid = await many(
    `UPDATE orders SET status = 'cancelled', cancel_reason = 'UPI payment not completed in time'
      WHERE status = 'awaiting_payment' AND created_at < now() - interval '15 minutes'
      RETURNING id, customer_id`,
  );
  for (const o of unpaid) {
    await one("INSERT INTO order_events (order_id, status, note) VALUES ($1, 'cancelled', 'Payment timed out') RETURNING id", [o.id]);
  }
  const unaccepted = await many(
    `UPDATE orders SET status = 'rejected', cancel_reason = 'Shop did not respond in time'
      WHERE status = 'placed' AND created_at < now() - interval '20 minutes'
      RETURNING id, customer_id`,
  );
  for (const o of unaccepted) {
    await one("INSERT INTO order_events (order_id, status, note) VALUES ($1, 'rejected', 'Timed out waiting for shop') RETURNING id", [o.id]);
  }
  return { unpaid, unaccepted };
}