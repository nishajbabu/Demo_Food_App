// Delivery rider side: go online, see delivery offers, accept, pick up, deliver with OTP.
import { Router } from 'express';
import { config } from '../config.js';
import { many, one, query } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, conflict } from '../middleware/errors.js';
import { ids, parse, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';
import { haversineKm } from '../lib/geo.js';
import { notify } from '../lib/sms.js';
import { todayIST } from '../lib/time.js';
import { listOrders, loadOrder, moveOrder } from '../services/orders.js';

const router = Router();
router.use(requireAuth, requireRole('rider'));

const ACTIVE = ['accepted', 'ready', 'picked_up'];

async function riderSummary(riderId) {
  const status = await one('SELECT online, vehicle_type, vehicle_no, lat, lng FROM partner_status WHERE user_id = $1', [riderId]);
  const today = await one(
    `SELECT COUNT(*)::int AS deliveries
       FROM orders WHERE rider_id = $1 AND status = 'delivered'
        AND (delivered_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
    [riderId, todayIST()],
  );
  const cash = await one(
    `SELECT (SELECT COALESCE(SUM(cash_collected_paise), 0) FROM orders WHERE rider_id = $1 AND status = 'delivered')
          - (SELECT COALESCE(SUM(amount_paise), 0) FROM cash_settlements WHERE rider_id = $1) AS cash_in_hand_paise`,
    [riderId],
  );
  return {
    online: status?.online || false,
    vehicleType: status?.vehicle_type || 'bike',
    vehicleNo: status?.vehicle_no || null,
    deliveriesToday: today.deliveries,
    earnedTodayPaise: today.deliveries * config.money.riderPayPerDeliveryPaise,
    cashInHandPaise: Number(cash.cash_in_hand_paise),
  };
}

router.get('/me', async (req, res) => {
  res.json(await riderSummary(req.user.id));
});

// Go online/offline, and send the latest location (the app sends it every minute while online).
router.patch('/status', async (req, res) => {
  const b = parse(
    z.object({ online: z.boolean().optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }),
    req.body,
  );
  await query(
    `INSERT INTO partner_status (user_id, online, lat, lng, vehicle_type, updated_at)
     VALUES ($1, COALESCE($2, FALSE), $3, $4, 'bike', now())
     ON CONFLICT (user_id) DO UPDATE SET
       online = COALESCE($2, partner_status.online),
       lat = COALESCE($3, partner_status.lat),
       lng = COALESCE($4, partner_status.lng),
       updated_at = now()`,
    [req.user.id, b.online ?? null, b.lat ?? null, b.lng ?? null],
  );
  res.json(await riderSummary(req.user.id));
});

// My current deliveries + new offers in my cluster (nearest shop first).
router.get('/tasks', async (req, res) => {
  const summary = await riderSummary(req.user.id);
  const active = await listOrders('o.rider_id = $1 AND o.status = ANY($2)', [req.user.id, ACTIVE], { includePickupCode: true });
  // The customer's OTP stays hidden; the rider asks for it at the door.
  let offers = [];
  if (summary.online && active.length < config.rules.maxActiveOrdersPerRider) {
    offers = await listOrders(
      `o.rider_id IS NULL AND o.status IN ('accepted', 'ready')
       AND o.village_id IN (SELECT id FROM villages WHERE cluster =
             (SELECT cluster FROM villages WHERE id = (SELECT village_id FROM users WHERE id = $1)))`,
      [req.user.id],
      { limit: 20 },
    );
    const me = await one('SELECT lat, lng FROM partner_status WHERE user_id = $1', [req.user.id]);
    offers = offers
      .map((o) => ({ ...o, distanceKm: haversineKm(me, { lat: o.merchantLat, lng: o.merchantLng }) }))
      .sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99))
      .map((o) => ({ ...o, earningPaise: config.money.riderPayPerDeliveryPaise }));
  }
  res.json({ ...summary, active, offers });
});

// First rider to accept gets the order.
router.post('/orders/:id/accept', async (req, res) => {
  const busy = await one("SELECT COUNT(*)::int AS n FROM orders WHERE rider_id = $1 AND status = ANY($2)", [req.user.id, ACTIVE]);
  if (busy.n >= config.rules.maxActiveOrdersPerRider) throw conflict('Finish your current deliveries first');
  const order = await one(
    `UPDATE orders SET rider_id = $2 WHERE id = $1 AND rider_id IS NULL AND status IN ('accepted', 'ready') RETURNING *`,
    [ids(req), req.user.id],
  );
  if (!order) throw conflict('Another rider already took this order');
  await query("INSERT INTO order_events (order_id, status, actor_id, note) VALUES ($1, $2, $3, 'Rider assigned')", [
    order.id,
    order.status,
    req.user.id,
  ]);
  notify(order.customer_id, `${req.user.name || 'A rider'} will deliver your order GG-${order.id}`);
  res.json(await loadOrder(order.id, { includePickupCode: true }));
});

router.post('/orders/:id/picked-up', async (req, res) => {
  const order = await moveOrder({
    orderId: ids(req),
    from: ['ready'],
    to: 'picked_up',
    actorId: req.user.id,
    guard: { column: 'rider_id', value: req.user.id },
  });
  notify(order.customer_id, `Your order GG-${order.id} is on the way`);
  res.json(await loadOrder(order.id, { includePickupCode: true }));
});

// Deliver: the customer's 4-digit OTP is required. For cash orders, record the cash taken.
router.post('/orders/:id/delivered', async (req, res) => {
  const b = parse(z.object({ otp: z.string().trim().regex(/^\d{4}$/, 'Ask the customer for the 4-digit code') }), req.body);
  const id = ids(req);
  const current = await one('SELECT * FROM orders WHERE id = $1 AND rider_id = $2', [id, req.user.id]);
  if (!current) throw badRequest('This is not your delivery');
  if (current.delivery_otp !== b.otp) throw badRequest('Wrong code. Ask the customer to check the app.');
  const isCash = current.payment_method === 'cod';
  const order = await moveOrder({
    orderId: id,
    from: ['picked_up'],
    to: 'delivered',
    actorId: req.user.id,
    extraSet: isCash ? { cash_collected_paise: current.total_paise, payment_status: 'paid' } : {},
    guard: { column: 'rider_id', value: req.user.id },
  });
  notify(order.customer_id, `Order GG-${order.id} delivered. Thank you!`);
  res.json({ ...(await loadOrder(order.id)), ...(await riderSummary(req.user.id)) });
});

// Delivery history for a day: ?date=2026-11-20
router.get('/history', async (req, res) => {
  const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
  const rows = await many(
    `SELECT o.id, o.total_paise, o.cash_collected_paise, o.delivered_at, m.name AS merchant_name, v.name AS village_name
       FROM orders o JOIN merchants m ON m.id = o.merchant_id JOIN villages v ON v.id = o.village_id
      WHERE o.rider_id = $1 AND o.status = 'delivered'
        AND (o.delivered_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
      ORDER BY o.delivered_at DESC`,
    [req.user.id, q.date || todayIST()],
  );
  res.json(camel(rows.map((r) => ({ ...r, code: `GG-${r.id}`, earningPaise: config.money.riderPayPerDeliveryPaise }))));
});

export default router;
