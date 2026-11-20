// Shop side: incoming orders, menu/stock, and the dairy's daily delivery sheet.
import { Router } from 'express';
import { many, one, query } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../middleware/errors.js';
import { ids, isoDate, month as monthSchema, parse, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';
import { notify } from '../lib/sms.js';
import { monthRange, thisMonth, todayIST } from '../lib/time.js';
import { listOrders, loadOrder, moveOrder } from '../services/orders.js';
import { ensureDeliveriesForDate } from '../services/subscriptions.js';

const router = Router();
router.use(requireAuth, requireRole('merchant'));

// Every request here works on the logged-in owner's shop.
router.use(async (req, res, next) => {
  const merchant = await one('SELECT * FROM merchants WHERE owner_id = $1 ORDER BY id LIMIT 1', [req.user.id]);
  if (!merchant) throw notFound('No shop is linked to this number yet. Please contact the GaonGo team.');
  if (merchant.status === 'suspended') throw forbidden('This shop is suspended. Please contact the GaonGo team.');
  req.merchant = merchant;
  next();
});

router.get('/me', async (req, res) => {
  const stats = await one(
    `SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'rejected'))::int AS orders_today,
            COALESCE(SUM(items_total_paise) FILTER (WHERE status = 'delivered'), 0)::int AS sales_today_paise
       FROM orders
      WHERE merchant_id = $1 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
    [req.merchant.id, todayIST()],
  );
  res.json(camel({ ...req.merchant, ...stats }));
});

router.patch('/me', async (req, res) => {
  const body = parse(z.object({ isOpen: z.boolean().optional(), description: z.string().max(300).optional() }), req.body);
  const m = await one(
    'UPDATE merchants SET is_open = COALESCE($2, is_open), description = COALESCE($3, description) WHERE id = $1 RETURNING *',
    [req.merchant.id, body.isOpen ?? null, body.description ?? null],
  );
  res.json(camel(m));
});

// ?view=active (default) or history
router.get('/orders', async (req, res) => {
  const q = parse(z.object({ view: z.enum(['active', 'history']).default('active') }), req.query);
  const statuses = q.view === 'active' ? ['placed', 'accepted', 'ready', 'picked_up'] : ['delivered', 'cancelled', 'rejected'];
  res.json(await listOrders('o.merchant_id = $1 AND o.status = ANY($2)', [req.merchant.id, statuses], { includePickupCode: true }));
});

const orderAction = (from, to, after) => async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().max(200).optional() }), req.body);
  const order = await moveOrder({
    orderId: ids(req),
    from,
    to,
    actorId: req.user.id,
    note: body.reason,
    extraSet: to === 'rejected' ? { cancel_reason: body.reason || 'Shop could not take the order' } : {},
    guard: { column: 'merchant_id', value: req.merchant.id },
  });
  if (after) await after(order);
  res.json(await loadOrder(order.id, { includePickupCode: true }));
};

router.post(
  '/orders/:id/accept',
  orderAction(['placed'], 'accepted', (o) => notify(o.customer_id, `Your order GG-${o.id} was accepted`)),
);
router.post(
  '/orders/:id/reject',
  orderAction(['placed'], 'rejected', (o) => notify(o.customer_id, `Sorry, the shop could not take order GG-${o.id}`)),
);
router.post(
  '/orders/:id/ready',
  orderAction(['accepted'], 'ready', (o) => o.rider_id && notify(o.rider_id, `Order GG-${o.id} is packed and ready`)),
);

// ---------- Products (menu / stock) ----------
router.get('/products', async (req, res) => {
  res.json(camel(await many('SELECT * FROM products WHERE merchant_id = $1 ORDER BY sort_order, name', [req.merchant.id])));
});

const productFields = z.object({
  name: z.string().trim().min(1).max(80),
  nameHi: z.string().trim().max(80).optional(),
  nameTa: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
  unit: z.string().trim().min(1).max(30).default('piece'),
  category: z.string().trim().max(40).optional(),
  pricePaise: z.coerce.number().int().min(0).max(10_000_00),
  isVeg: z.boolean().optional(),
  isSubscribable: z.boolean().default(false),
  inStock: z.boolean().default(true),
});

router.post('/products', async (req, res) => {
  const b = parse(productFields, req.body);
  const p = await one(
    `INSERT INTO products (merchant_id, name, name_hi, name_ta, description, unit, category, price_paise, is_veg, is_subscribable, in_stock)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [req.merchant.id, b.name, b.nameHi ?? null, b.nameTa ?? null, b.description ?? null, b.unit, b.category ?? null, b.pricePaise, b.isVeg ?? null, b.isSubscribable, b.inStock],
  );
  res.status(201).json(camel(p));
});

router.patch('/products/:id', async (req, res) => {
  const b = parse(productFields.partial(), req.body);
  const map = {
    name: 'name',
    nameHi: 'name_hi',
    nameTa: 'name_ta',
    description: 'description',
    unit: 'unit',
    category: 'category',
    pricePaise: 'price_paise',
    isVeg: 'is_veg',
    isSubscribable: 'is_subscribable',
    inStock: 'in_stock',
  };
  const sets = [];
  const params = [ids(req), req.merchant.id];
  for (const [key, col] of Object.entries(map)) {
    if (b[key] !== undefined) {
      params.push(b[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw badRequest('Nothing to change');
  const p = await one(`UPDATE products SET ${sets.join(', ')} WHERE id = $1 AND merchant_id = $2 RETURNING *`, params);
  if (!p) throw notFound('Product not found');
  res.json(camel(p));
});

// ---------- Dairy: subscriptions ----------

// The delivery sheet for one day (default today): who gets what, grouped by village.
router.get('/subscriptions/sheet', async (req, res) => {
  const q = parse(z.object({ date: isoDate.optional() }), req.query);
  const date = q.date || todayIST();
  await ensureDeliveriesForDate(date, { merchantId: req.merchant.id });
  const rows = await many(
    `SELECT d.id, d.delivery_date, d.qty, d.amount_paise, d.status, s.slot, s.address_text,
            p.name AS product_name, p.unit, u.name AS customer_name, u.phone AS customer_phone, v.name AS village_name
       FROM subscription_deliveries d
       JOIN subscriptions s ON s.id = d.subscription_id
       JOIN products p ON p.id = s.product_id
       JOIN users u ON u.id = s.customer_id
       LEFT JOIN villages v ON v.id = u.village_id
      WHERE s.merchant_id = $1 AND d.delivery_date = $2
      ORDER BY s.slot, v.name, s.address_text`,
    [req.merchant.id, date],
  );
  const totals = {};
  for (const r of rows) {
    const key = `${r.product_name} (${r.unit})`;
    totals[key] = (totals[key] || 0) + r.qty;
  }
  const paused = await one(
    "SELECT COUNT(*)::int AS n FROM subscriptions WHERE merchant_id = $1 AND status = 'paused'",
    [req.merchant.id],
  );
  res.json(
    camel({
      date,
      deliveries: rows,
      totals: Object.entries(totals).map(([product, qty]) => ({ product, qty })),
      homes: new Set(rows.map((r) => r.customer_phone)).size,
      paused: paused.n,
      done: rows.filter((r) => r.status !== 'scheduled').length,
    }),
  );
});

// Tick a home as delivered (or missed).
router.post('/subscription-deliveries/:id', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['delivered', 'missed', 'scheduled']) }), req.body);
  const d = await one(
    `UPDATE subscription_deliveries d
        SET status = $3::text, delivered_at = CASE WHEN $3::text = 'delivered' THEN now() ELSE NULL END
       FROM subscriptions s
      WHERE d.id = $1 AND s.id = d.subscription_id AND s.merchant_id = $2
      RETURNING d.*`,
    [ids(req), req.merchant.id, b.status],
  );
  if (!d) throw notFound('Delivery not found');
  res.json(camel(d));
});

// Month-end dues per home: delivered amount minus payments received. ?month=2026-11
router.get('/subscriptions/dues', async (req, res) => {
  const q = parse(z.object({ month: monthSchema.optional() }), req.query);
  const month = q.month || thisMonth();
  const [from, to] = monthRange(month);
  const rows = await many(
    `WITH billed AS (
        SELECT s.customer_id, SUM(d.amount_paise)::int AS billed_paise
          FROM subscription_deliveries d JOIN subscriptions s ON s.id = d.subscription_id
         WHERE s.merchant_id = $1 AND d.status = 'delivered' AND d.delivery_date BETWEEN $2 AND $3
         GROUP BY s.customer_id),
     paid AS (
        SELECT customer_id, SUM(amount_paise)::int AS paid_paise
          FROM subscription_payments WHERE merchant_id = $1 AND month = $4 GROUP BY customer_id)
     SELECT u.id AS customer_id, u.name AS customer_name, u.phone AS customer_phone,
            b.billed_paise, COALESCE(p.paid_paise, 0) AS paid_paise,
            b.billed_paise - COALESCE(p.paid_paise, 0) AS due_paise
       FROM billed b JOIN users u ON u.id = b.customer_id LEFT JOIN paid p ON p.customer_id = b.customer_id
      ORDER BY due_paise DESC`,
    [req.merchant.id, from, to, month],
  );
  res.json(camel({ month, homes: rows, totalDuePaise: rows.reduce((s, r) => s + Math.max(0, r.due_paise), 0) }));
});

// Record a month-end payment (cash to the milkman, or UPI received).
router.post('/subscriptions/payments', async (req, res) => {
  const b = parse(
    z.object({
      customerId: z.coerce.number().int().positive(),
      month: monthSchema,
      amountPaise: z.coerce.number().int().positive(),
      method: z.enum(['cash', 'upi']),
    }),
    req.body,
  );
  const has = await one('SELECT 1 FROM subscriptions WHERE merchant_id = $1 AND customer_id = $2 LIMIT 1', [req.merchant.id, b.customerId]);
  if (!has) throw notFound('This customer has no subscription with your shop');
  const row = await one(
    'INSERT INTO subscription_payments (customer_id, merchant_id, month, amount_paise, method, recorded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [b.customerId, req.merchant.id, b.month, b.amountPaise, b.method, req.user.id],
  );
  res.status(201).json(camel(row));
});

export default router;
