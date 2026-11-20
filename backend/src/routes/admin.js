// Operations team: dashboard, orders, shops, riders/drivers, cash, subscriptions, rides,
// support tickets and settings. Used by the admin & support web console.
import { Router } from 'express';
import { many, one, query, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, notFound } from '../middleware/errors.js';
import { ids, isoDate, parse, phone, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';
import { getServices, setServices } from '../lib/settings.js';
import { notify } from '../lib/sms.js';
import { todayIST } from '../lib/time.js';
import { listOrders, loadOrder, moveOrder } from '../services/orders.js';
import { ensureDeliveriesForDate } from '../services/subscriptions.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'support'));
const adminOnly = requireRole('admin');

// ---------- Dashboard ----------
router.get('/stats', async (req, res) => {
  const date = todayIST();
  const orders = await many(
    `SELECT service,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
            COUNT(*) FILTER (WHERE status IN ('placed', 'accepted', 'ready', 'picked_up'))::int AS in_progress,
            COALESCE(SUM(total_paise) FILTER (WHERE status = 'delivered'), 0)::int AS gmv_paise
       FROM orders WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date GROUP BY service`,
    [date],
  );
  const milk = await one(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
       FROM subscription_deliveries WHERE delivery_date = $1`,
    [date],
  );
  const rides = await one(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM rides WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`,
    [date],
  );
  const shareSeats = await one(
    `SELECT COALESCE(SUM(b.seats), 0)::int AS seats FROM share_bookings b JOIN share_trips t ON t.id = b.trip_id
      WHERE b.status = 'booked' AND (t.departs_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`,
    [date],
  );
  const partners = await many(
    `SELECT u.role, COUNT(*)::int AS online FROM partner_status ps JOIN users u ON u.id = ps.user_id
      WHERE ps.online AND u.is_active GROUP BY u.role`,
  );
  const tickets = await one("SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE priority = 'high')::int AS urgent FROM tickets WHERE status = 'open'");
  const delayed = await one(
    "SELECT COUNT(*)::int AS n FROM orders WHERE status IN ('placed', 'accepted', 'ready', 'picked_up') AND created_at < now() - interval '45 minutes'",
  );
  const pendingMerchants = await one("SELECT COUNT(*)::int AS n FROM merchants WHERE status = 'pending'");
  res.json(
    camel({
      date,
      orders,
      milk,
      rides: { ...rides, share_seats: shareSeats.seats },
      partners_online: Object.fromEntries(partners.map((p) => [p.role, p.online])),
      tickets,
      delayed_orders: delayed.n,
      pending_merchants: pendingMerchants.n,
    }),
  );
});

// ---------- Orders ----------
router.get('/orders', async (req, res) => {
  const q = parse(
    z.object({
      status: z.enum(['active', 'delivered', 'cancelled', 'all']).default('active'),
      service: z.enum(['food', 'grocery']).optional(),
    }),
    req.query,
  );
  const statusSql = {
    active: "o.status IN ('placed', 'accepted', 'ready', 'picked_up')",
    delivered: "o.status = 'delivered'",
    cancelled: "o.status IN ('cancelled', 'rejected')",
    all: 'TRUE',
  }[q.status];
  res.json(await listOrders(`${statusSql} AND ($1::text IS NULL OR o.service = $1)`, [q.service ?? null], { limit: 100 }));
});

router.get('/orders/:id', async (req, res) => {
  const order = await loadOrder(ids(req), { includePickupCode: true });
  if (!order) throw notFound('Order not found');
  order.refunds = camel(await many('SELECT * FROM refunds WHERE order_id = $1 ORDER BY id', [order.id]));
  res.json(order);
});

// Give an order to a specific rider (when nobody accepts, or to re-assign).
router.post('/orders/:id/assign', async (req, res) => {
  const b = parse(z.object({ riderId: z.coerce.number().int().positive() }), req.body);
  const rider = await one("SELECT id, name FROM users WHERE id = $1 AND role = 'rider' AND is_active", [b.riderId]);
  if (!rider) throw notFound('Rider not found');
  const order = await one(
    "UPDATE orders SET rider_id = $2 WHERE id = $1 AND status IN ('placed', 'accepted', 'ready') RETURNING *",
    [ids(req), rider.id],
  );
  if (!order) throw conflict('This order can no longer be assigned');
  await query('INSERT INTO order_events (order_id, status, actor_id, note) VALUES ($1, $2, $3, $4)', [
    order.id,
    order.status,
    req.user.id,
    `Assigned to ${rider.name} by support`,
  ]);
  notify(rider.id, `Support assigned order GG-${order.id} to you`);
  res.json(await loadOrder(order.id, { includePickupCode: true }));
});

router.post('/orders/:id/cancel', async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  const order = await moveOrder({
    orderId: ids(req),
    from: ['placed', 'accepted', 'ready', 'picked_up'],
    to: 'cancelled',
    actorId: req.user.id,
    note: b.reason,
    extraSet: { cancel_reason: b.reason },
  });
  notify(order.customer_id, `Order GG-${order.id} was cancelled: ${b.reason}`);
  res.json(await loadOrder(order.id));
});

// Record a refund to be paid back by UPI or cash.
router.post('/orders/:id/refund', async (req, res) => {
  const b = parse(z.object({ amountPaise: z.coerce.number().int().positive(), reason: z.string().trim().min(3).max(200) }), req.body);
  const order = await one('SELECT * FROM orders WHERE id = $1', [ids(req)]);
  if (!order) throw notFound('Order not found');
  const already = await one('SELECT COALESCE(SUM(amount_paise), 0)::int AS n FROM refunds WHERE order_id = $1', [order.id]);
  if (already.n + b.amountPaise > order.total_paise) throw badRequest('Refund is more than the order total');
  const refund = await one('INSERT INTO refunds (order_id, amount_paise, reason, created_by) VALUES ($1, $2, $3, $4) RETURNING *', [
    order.id,
    b.amountPaise,
    b.reason,
    req.user.id,
  ]);
  res.status(201).json(camel(refund));
});

router.get('/refunds', async (req, res) => {
  res.json(
    camel(
      await many(
        `SELECT r.*, u.name AS customer_name, u.phone AS customer_phone FROM refunds r
           JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = o.customer_id
          ORDER BY r.status, r.created_at DESC LIMIT 100`,
      ),
    ),
  );
});

router.post('/refunds/:id/done', async (req, res) => {
  const r = await one("UPDATE refunds SET status = 'done' WHERE id = $1 RETURNING *", [ids(req)]);
  if (!r) throw notFound('Refund not found');
  res.json(camel(r));
});

// ---------- Shops ----------
router.get('/merchants', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['pending', 'approved', 'suspended']).optional() }), req.query);
  res.json(
    camel(
      await many(
        `SELECT m.*, u.name AS owner_name, u.phone AS owner_phone, v.name AS village_name,
                (SELECT COUNT(*)::int FROM products p WHERE p.merchant_id = m.id) AS product_count
           FROM merchants m JOIN users u ON u.id = m.owner_id JOIN villages v ON v.id = m.village_id
          WHERE ($1::text IS NULL OR m.status = $1)
          ORDER BY CASE m.status WHEN 'pending' THEN 0 ELSE 1 END, m.name`,
        [q.status ?? null],
      ),
    ),
  );
});

// Sign up a new shop (creates the owner's login too).
router.post('/merchants', adminOnly, async (req, res) => {
  const b = parse(
    z.object({
      ownerPhone: phone,
      ownerName: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(80),
      type: z.enum(['food', 'grocery', 'dairy']),
      villageId: z.coerce.number().int().positive(),
      landmark: z.string().trim().max(200).optional(),
      fssaiNo: z.string().trim().max(30).optional(),
      gstNo: z.string().trim().max(30).optional(),
    }),
    req.body,
  );
  const merchant = await tx(async (db) => {
    let owner = await db.one('SELECT * FROM users WHERE phone = $1', [b.ownerPhone]);
    if (owner && owner.role !== 'merchant') throw conflict(`This number is already registered as a ${owner.role}`);
    if (!owner) {
      owner = await db.one("INSERT INTO users (phone, name, role, village_id) VALUES ($1, $2, 'merchant', $3) RETURNING *", [
        b.ownerPhone,
        b.ownerName,
        b.villageId,
      ]);
    }
    return db.one(
      `INSERT INTO merchants (owner_id, name, type, village_id, landmark, fssai_no, gst_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [owner.id, b.name, b.type, b.villageId, b.landmark ?? null, b.fssaiNo ?? null, b.gstNo ?? null],
    );
  });
  res.status(201).json(camel(merchant));
});

router.patch('/merchants/:id', adminOnly, async (req, res) => {
  const b = parse(
    z.object({
      status: z.enum(['pending', 'approved', 'suspended']).optional(),
      isOpen: z.boolean().optional(),
      commissionPct: z.coerce.number().min(0).max(50).optional(),
    }),
    req.body,
  );
  const current = await one('SELECT * FROM merchants WHERE id = $1', [ids(req)]);
  if (!current) throw notFound('Shop not found');
  // FSSAI requires food platforms to list only FSSAI-registered food businesses.
  if (b.status === 'approved' && current.type === 'food' && !current.fssai_no) {
    throw badRequest('Food shops need an FSSAI number before approval');
  }
  const m = await one(
    `UPDATE merchants SET status = COALESCE($2, status), is_open = COALESCE($3, is_open), commission_pct = COALESCE($4, commission_pct)
      WHERE id = $1 RETURNING *`,
    [current.id, b.status ?? null, b.isOpen ?? null, b.commissionPct ?? null],
  );
  if (b.status === 'approved' && current.status !== 'approved') notify(m.owner_id, `${m.name} is now live on GaonGo`);
  res.json(camel(m));
});

// Export a shop's current products (used by Export CSV in Admin).
router.get('/merchants/:id/products', async (req, res) => {
  const merchant = await one('SELECT id FROM merchants WHERE id = $1', [ids(req)]);
  if (!merchant) throw notFound('Shop not found');
  res.json(camel(await many('SELECT * FROM products WHERE merchant_id = $1 ORDER BY sort_order, name', [merchant.id])));
});

// Bulk import / update products for a shop from CSV/spreadsheet.
router.post('/merchants/:id/products/import', adminOnly, async (req, res) => {
  const merchantId = ids(req);
  const b = parse(
    z.object({
      items: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(80),
            nameTa: z.string().trim().max(80).optional(),
            nameHi: z.string().trim().max(80).optional(),
            unit: z.string().trim().min(1).max(30).default('piece'),
            category: z.string().trim().max(40).optional(),
            pricePaise: z.coerce.number().int().min(0).max(10_000_00),
            isVeg: z.boolean().optional(),
            isSubscribable: z.boolean().default(false),
          }),
        )
        .min(1, 'Add at least one item')
        .max(500, 'Import up to 500 items at a time'),
    }),
    req.body,
  );
  const merchant = await one('SELECT id FROM merchants WHERE id = $1', [merchantId]);
  if (!merchant) throw notFound('Shop not found');

  let inserted = 0;
  let updated = 0;
  await tx(async (db) => {
    for (const [idx, item] of b.items.entries()) {
      const existing = await db.one(
        'SELECT id FROM products WHERE merchant_id = $1 AND LOWER(name) = LOWER($2) AND LOWER(unit) = LOWER($3) LIMIT 1',
        [merchant.id, item.name, item.unit],
      );
      if (existing) {
        await db.query(
          `UPDATE products
              SET name_ta = COALESCE($2, name_ta),
                  name_hi = COALESCE($3, name_hi),
                  category = COALESCE($4, category),
                  price_paise = $5,
                  is_veg = COALESCE($6, is_veg),
                  is_subscribable = $7
            WHERE id = $1`,
          [existing.id, item.nameTa || null, item.nameHi || null, item.category || null, item.pricePaise, item.isVeg ?? null, item.isSubscribable],
        );
        updated += 1;
      } else {
        await db.query(
          `INSERT INTO products (merchant_id, name, name_ta, name_hi, unit, category, price_paise, is_veg, is_subscribable, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            merchant.id,
            item.name,
            item.nameTa || null,
            item.nameHi || null,
            item.unit,
            item.category || null,
            item.pricePaise,
            item.isVeg ?? null,
            item.isSubscribable,
            idx + 1,
          ],
        );
        inserted += 1;
      }
    }
  });
  res.status(201).json({ imported: b.items.length, inserted, updated });
});

// ---------- Riders and drivers ----------
router.get('/partners', async (req, res) => {
  const q = parse(z.object({ role: z.enum(['rider', 'driver']).optional() }), req.query);
  res.json(
    camel(
      await many(
        `SELECT u.id, u.name, u.phone, u.role, u.is_active, v.name AS village_name,
                ps.online, ps.vehicle_type, ps.vehicle_no, ps.updated_at AS last_seen,
                CASE WHEN u.role = 'rider' THEN
                  (SELECT COALESCE(SUM(cash_collected_paise), 0) FROM orders WHERE rider_id = u.id AND status = 'delivered')
                  - (SELECT COALESCE(SUM(amount_paise), 0) FROM cash_settlements WHERE rider_id = u.id)
                END AS cash_in_hand_paise
           FROM users u LEFT JOIN partner_status ps ON ps.user_id = u.id LEFT JOIN villages v ON v.id = u.village_id
          WHERE u.role IN ('rider', 'driver') AND ($1::text IS NULL OR u.role = $1)
          ORDER BY ps.online DESC NULLS LAST, u.name`,
        [q.role ?? null],
      ),
    ),
  );
});

router.post('/partners', adminOnly, async (req, res) => {
  const b = parse(
    z.object({
      phone,
      name: z.string().trim().min(1).max(80),
      role: z.enum(['rider', 'driver', 'support']),
      villageId: z.coerce.number().int().positive(),
      vehicleType: z.enum(['bike', 'auto', 'erick', 'cab']).optional(),
      vehicleNo: z.string().trim().max(20).optional(),
    }),
    req.body,
  );
  const user = await tx(async (db) => {
    const existing = await db.one('SELECT id FROM users WHERE phone = $1', [b.phone]);
    if (existing) throw conflict('This number is already registered');
    const u = await db.one('INSERT INTO users (phone, name, role, village_id) VALUES ($1, $2, $3, $4) RETURNING *', [
      b.phone,
      b.name,
      b.role,
      b.villageId,
    ]);
    if (b.role !== 'support') {
      await db.query('INSERT INTO partner_status (user_id, vehicle_type, vehicle_no) VALUES ($1, $2, $3)', [
        u.id,
        b.vehicleType || (b.role === 'rider' ? 'bike' : 'auto'),
        b.vehicleNo ?? null,
      ]);
    }
    return u;
  });
  res.status(201).json(camel(user));
});

router.patch('/users/:id', adminOnly, async (req, res) => {
  const b = parse(z.object({ isActive: z.boolean() }), req.body);
  const u = await one('UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, name, phone, role, is_active', [ids(req), b.isActive]);
  if (!u) throw notFound('User not found');
  if (!b.isActive) await query('UPDATE partner_status SET online = FALSE WHERE user_id = $1', [u.id]);
  res.json(camel(u));
});

// Find anyone by phone number (support calls).
router.get('/users', async (req, res) => {
  const q = parse(z.object({ phone: z.string().trim().min(4).max(10) }), req.query);
  res.json(camel(await many("SELECT id, name, phone, role, is_active FROM users WHERE phone LIKE '%' || $1 || '%' LIMIT 20", [q.phone])));
});

// Rider hands over collected cash at the end of the day.
router.post('/cash/:id/settle', async (req, res) => {
  const b = parse(z.object({ amountPaise: z.coerce.number().int().positive() }), req.body);
  const rider = await one("SELECT id FROM users WHERE id = $1 AND role = 'rider'", [ids(req)]);
  if (!rider) throw notFound('Rider not found');
  const row = await one('INSERT INTO cash_settlements (rider_id, amount_paise, settled_by) VALUES ($1, $2, $3) RETURNING *', [
    rider.id,
    b.amountPaise,
    req.user.id,
  ]);
  res.status(201).json(camel(row));
});

// ---------- Subscriptions ----------
router.get('/subscriptions', async (req, res) => {
  const q = parse(z.object({ date: isoDate.optional() }), req.query);
  const date = q.date || todayIST();
  await ensureDeliveriesForDate(date);
  res.json(
    camel({
      date,
      byMerchant: await many(
        `SELECT m.id AS merchant_id, m.name AS merchant_name,
                COUNT(*)::int AS deliveries,
                COUNT(*) FILTER (WHERE d.status = 'delivered')::int AS delivered,
                COUNT(*) FILTER (WHERE d.status = 'missed')::int AS missed,
                COALESCE(SUM(d.qty), 0) AS qty
           FROM subscription_deliveries d JOIN subscriptions s ON s.id = d.subscription_id JOIN merchants m ON m.id = s.merchant_id
          WHERE d.delivery_date = $1 GROUP BY m.id, m.name ORDER BY m.name`,
        [date],
      ),
      activeSubscriptions: (await one("SELECT COUNT(*)::int AS n FROM subscriptions WHERE status = 'active'")).n,
    }),
  );
});

// ---------- Rides ----------
router.get('/rides', async (req, res) => {
  res.json(
    camel(
      await many(
        `SELECT r.id, r.status, r.vehicle_type, r.fare_paise, r.distance_km, r.created_at,
                pp.name AS pickup_name, dp.name AS drop_name, c.name AS customer_name, c.phone AS customer_phone,
                d.name AS driver_name, d.phone AS driver_phone
           FROM rides r JOIN places pp ON pp.id = r.pickup_place_id JOIN places dp ON dp.id = r.drop_place_id
           JOIN users c ON c.id = r.customer_id LEFT JOIN users d ON d.id = r.driver_id
          ORDER BY r.created_at DESC LIMIT 100`,
      ),
    ),
  );
});

// ---------- Support tickets ----------
router.get('/tickets', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['open', 'resolved', 'all']).default('open') }), req.query);
  res.json(
    camel(
      await many(
        `SELECT t.*, u.name AS user_name, u.phone AS user_phone, u.role AS user_role,
                (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message
           FROM tickets t JOIN users u ON u.id = t.created_by
          WHERE ($1::text = 'all' OR t.status = $1::text)
          ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.created_at`,
        [q.status],
      ),
    ),
  );
});

router.get('/tickets/:id', async (req, res) => {
  const t = await one(
    `SELECT t.*, u.name AS user_name, u.phone AS user_phone, u.role AS user_role, u.landmark AS user_landmark, v.name AS user_village
       FROM tickets t JOIN users u ON u.id = t.created_by LEFT JOIN villages v ON v.id = u.village_id WHERE t.id = $1`,
    [ids(req)],
  );
  if (!t) throw notFound('Ticket not found');
  t.messages = await many(
    `SELECT m.id, m.body, m.is_staff, m.created_at, u.name AS author_name
       FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = $1 ORDER BY m.id`,
    [t.id],
  );
  const out = camel(t);
  if (t.order_id) out.order = await loadOrder(t.order_id, { includePickupCode: true });
  if (t.ride_id) {
    out.ride = camel(
      await one(
        `SELECT r.*, pp.name AS pickup_name, dp.name AS drop_name, d.name AS driver_name, d.phone AS driver_phone
           FROM rides r JOIN places pp ON pp.id = r.pickup_place_id JOIN places dp ON dp.id = r.drop_place_id
           LEFT JOIN users d ON d.id = r.driver_id WHERE r.id = $1`,
        [t.ride_id],
      ),
    );
  }
  out.history = camel(
    await many('SELECT id, subject, status, created_at FROM tickets WHERE created_by = $1 AND id <> $2 ORDER BY id DESC LIMIT 5', [
      t.created_by,
      t.id,
    ]),
  );
  res.json(out);
});

router.post('/tickets/:id/messages', async (req, res) => {
  const b = parse(z.object({ message: z.string().trim().min(1).max(2000) }), req.body);
  const t = await one('SELECT id, created_by FROM tickets WHERE id = $1', [ids(req)]);
  if (!t) throw notFound('Ticket not found');
  await query('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body) VALUES ($1, $2, TRUE, $3)', [t.id, req.user.id, b.message]);
  notify(t.created_by, `GaonGo support replied to your ticket #${t.id}`);
  res.status(201).json({ ok: true });
});

router.post('/tickets/:id/resolve', async (req, res) => {
  const t = await one("UPDATE tickets SET status = 'resolved', resolved_at = now() WHERE id = $1 RETURNING *", [ids(req)]);
  if (!t) throw notFound('Ticket not found');
  res.json(camel(t));
});

router.post('/tickets/:id/reopen', async (req, res) => {
  const t = await one("UPDATE tickets SET status = 'open', resolved_at = NULL WHERE id = $1 RETURNING *", [ids(req)]);
  if (!t) throw notFound('Ticket not found');
  res.json(camel(t));
});

// Log a complaint that came by phone call or WhatsApp.
router.post('/tickets', async (req, res) => {
  const b = parse(
    z.object({
      phone,
      subject: z.string().trim().min(3).max(120),
      category: z.enum(['order', 'subscription', 'ride', 'payment', 'partner', 'safety', 'other']).default('other'),
      channel: z.enum(['phone', 'whatsapp', 'app']).default('phone'),
      priority: z.enum(['low', 'medium', 'high']).default('medium'),
      orderId: z.coerce.number().int().positive().optional(),
      message: z.string().trim().min(1).max(2000),
    }),
    req.body,
  );
  const ticket = await tx(async (db) => {
    let user = await db.one('SELECT id FROM users WHERE phone = $1', [b.phone]);
    if (!user) user = await db.one("INSERT INTO users (phone, role) VALUES ($1, 'customer') RETURNING id", [b.phone]);
    const t = await db.one(
      `INSERT INTO tickets (created_by, subject, category, order_id, priority, channel)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.id, b.subject, b.category, b.orderId ?? null, b.priority, b.channel],
    );
    await db.query('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body) VALUES ($1, $2, TRUE, $3)', [
      t.id,
      req.user.id,
      `[${b.channel}] ${b.message}`,
    ]);
    return t;
  });
  res.status(201).json(camel(ticket));
});

// ---------- Settings and places ----------
router.get('/settings', async (req, res) => res.json({ services: await getServices() }));

router.patch('/settings', adminOnly, async (req, res) => {
  const b = parse(
    z.object({ services: z.object({ grocery: z.boolean(), milk: z.boolean(), food: z.boolean(), rides: z.boolean() }).partial() }),
    req.body,
  );
  res.json({ services: await setServices(b.services) });
});

router.get('/villages', async (req, res) => {
  res.json(camel(await many('SELECT * FROM villages ORDER BY cluster, name')));
});

router.post('/villages', adminOnly, async (req, res) => {
  const b = parse(
    z.object({
      name: z.string().trim().min(1).max(80),
      cluster: z.string().trim().min(1).max(80),
      district: z.string().trim().max(80).optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
    }),
    req.body,
  );
  const v = await one('INSERT INTO villages (name, cluster, district, lat, lng) VALUES ($1, $2, $3, $4, $5) RETURNING *', [
    b.name,
    b.cluster,
    b.district ?? null,
    b.lat ?? null,
    b.lng ?? null,
  ]);
  res.status(201).json(camel(v));
});

export default router;
