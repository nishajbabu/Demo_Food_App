// Customer side of milk / curd / sabzi-basket subscriptions.
import { Router } from 'express';
import { many, one, query, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../middleware/errors.js';
import { ids, isoDate, month as monthSchema, parse, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';
import { requireService } from '../lib/settings.js';
import { addDays, monthRange, thisMonth, todayIST } from '../lib/time.js';
import { calendar, clearScheduled, earliestChangeDate } from '../services/subscriptions.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

// What can be subscribed to near me, and the earliest start date.
router.get('/products', async (req, res) => {
  const rows = await many(
    `SELECT p.id, p.name, p.name_hi, p.name_ta, p.unit, p.price_paise, p.description, m.id AS merchant_id, m.name AS merchant_name
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id
       JOIN villages v ON v.id = m.village_id
      WHERE p.is_subscribable AND p.in_stock AND m.status = 'approved'
        AND ($1::int IS NULL OR v.cluster = (SELECT cluster FROM villages WHERE id = $1))
      ORDER BY m.name, p.sort_order, p.name`,
    [req.user.village_id ?? null],
  );
  res.json({ products: camel(rows), earliestStartDate: earliestChangeDate() });
});

async function subscriptionView(sub) {
  const skips = await many('SELECT skip_date FROM subscription_skips WHERE subscription_id = $1 AND skip_date >= $2', [sub.id, todayIST()]);
  const [from, to] = monthRange(thisMonth());
  const bill = await one(
    `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE status = 'delivered'), 0)::int AS delivered_paise,
            COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_count
       FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date BETWEEN $2 AND $3`,
    [sub.id, from, to],
  );
  return camel({
    ...sub,
    days: calendar(sub, new Set(skips.map((s) => s.skip_date)), addDays(todayIST(), 1), 7),
    this_month: bill,
    earliest_change_date: earliestChangeDate(),
  });
}

async function loadMine(userId, id) {
  const sub = await one(
    `SELECT s.*, p.name AS product_name, p.name_hi AS product_name_hi, p.name_ta AS product_name_ta, p.unit, p.price_paise, m.name AS merchant_name
       FROM subscriptions s JOIN products p ON p.id = s.product_id JOIN merchants m ON m.id = s.merchant_id
      WHERE s.id = $1 AND s.customer_id = $2`,
    [id, userId],
  );
  if (!sub) throw notFound('Subscription not found');
  return sub;
}

router.get('/mine', async (req, res) => {
  const subs = await many(
    `SELECT s.*, p.name AS product_name, p.name_hi AS product_name_hi, p.name_ta AS product_name_ta, p.unit, p.price_paise, m.name AS merchant_name
       FROM subscriptions s JOIN products p ON p.id = s.product_id JOIN merchants m ON m.id = s.merchant_id
      WHERE s.customer_id = $1 AND s.status <> 'cancelled' ORDER BY s.created_at DESC`,
    [req.user.id],
  );
  res.json(await Promise.all(subs.map(subscriptionView)));
});

router.post('/', async (req, res) => {
  await requireService('milk');
  const b = parse(
    z.object({
      productId: z.coerce.number().int().positive(),
      qty: z.coerce.number().positive().max(20),
      frequency: z.enum(['daily', 'alternate', 'weekly']).default('daily'),
      slot: z.enum(['morning', 'evening']).default('morning'),
      startDate: isoDate.optional(),
      addressText: z.string().trim().max(300).optional(),
    }),
    req.body,
  );
  const product = await one(
    `SELECT p.*, m.status AS merchant_status FROM products p JOIN merchants m ON m.id = p.merchant_id WHERE p.id = $1`,
    [b.productId],
  );
  if (!product || !product.is_subscribable || product.merchant_status !== 'approved') throw notFound('This product cannot be subscribed to');
  const earliest = earliestChangeDate();
  const startDate = b.startDate || earliest;
  if (startDate < earliest) throw badRequest(`The earliest start date is ${earliest}`);
  const address = b.addressText || req.user.landmark;
  if (!address) throw badRequest('Please add a landmark so the milkman can find you');
  const sub = await one(
    `INSERT INTO subscriptions (customer_id, merchant_id, product_id, qty, frequency, slot, start_date, address_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [req.user.id, product.merchant_id, product.id, b.qty, b.frequency, b.slot, startDate, address],
  );
  res.status(201).json(await subscriptionView(await loadMine(req.user.id, sub.id)));
});

// Skip (or un-skip) one day: { date: "2026-11-23", skip: true }
router.post('/:id/skip', async (req, res) => {
  const b = parse(z.object({ date: isoDate, skip: z.boolean().default(true) }), req.body);
  const sub = await loadMine(req.user.id, ids(req));
  const earliest = earliestChangeDate();
  if (b.date < earliest) throw badRequest(`Changes for ${b.date} are closed. The earliest you can change is ${earliest}.`);
  if (b.skip) {
    await tx(async (db) => {
      await db.query('INSERT INTO subscription_skips (subscription_id, skip_date) VALUES ($1, $2) ON CONFLICT DO NOTHING', [sub.id, b.date]);
      await db.query("DELETE FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2 AND status = 'scheduled'", [sub.id, b.date]);
    });
  } else {
    await query('DELETE FROM subscription_skips WHERE subscription_id = $1 AND skip_date = $2', [sub.id, b.date]);
  }
  res.json(await subscriptionView(sub));
});

// Change quantity / slot, or pause / resume / cancel.
router.patch('/:id', async (req, res) => {
  const b = parse(
    z.object({
      qty: z.coerce.number().positive().max(20).optional(),
      slot: z.enum(['morning', 'evening']).optional(),
      status: z.enum(['active', 'paused', 'cancelled']).optional(),
    }),
    req.body,
  );
  const sub = await loadMine(req.user.id, ids(req));
  const earliest = earliestChangeDate();
  await query(
    'UPDATE subscriptions SET qty = COALESCE($2, qty), slot = COALESCE($3, slot), status = COALESCE($4, status) WHERE id = $1',
    [sub.id, b.qty ?? null, b.slot ?? null, b.status ?? null],
  );
  // Future rows that are not delivered yet follow the change.
  if (b.status && b.status !== 'active') await clearScheduled(sub.id, earliest);
  if (b.qty) {
    await query(
      `UPDATE subscription_deliveries SET qty = $2, amount_paise = ROUND(unit_price_paise * $2)
        WHERE subscription_id = $1 AND delivery_date >= $3 AND status = 'scheduled'`,
      [sub.id, b.qty, earliest],
    );
  }
  res.json(await subscriptionView(await loadMine(req.user.id, sub.id)));
});

// The bill for a month: every delivery and the total. ?month=2026-11
router.get('/:id/bill', async (req, res) => {
  const q = parse(z.object({ month: monthSchema.optional() }), req.query);
  const sub = await loadMine(req.user.id, ids(req));
  const month = q.month || thisMonth();
  const [from, to] = monthRange(month);
  const rows = await many(
    `SELECT delivery_date, qty, amount_paise, status FROM subscription_deliveries
      WHERE subscription_id = $1 AND delivery_date BETWEEN $2 AND $3 ORDER BY delivery_date`,
    [sub.id, from, to],
  );
  const paid = await one(
    'SELECT COALESCE(SUM(amount_paise), 0)::int AS paid FROM subscription_payments WHERE customer_id = $1 AND merchant_id = $2 AND month = $3',
    [req.user.id, sub.merchant_id, month],
  );
  const total = rows.filter((r) => r.status === 'delivered').reduce((s, r) => s + r.amount_paise, 0);
  res.json(camel({ month, deliveries: rows, total_paise: total, paid_paise: paid.paid }));
});

export default router;
