// Browsing: villages, shops, products, search. Used by the customer app.
import { Router } from 'express';
import { many, one } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../middleware/errors.js';
import { ids, parse, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';
import { getServices } from '../lib/settings.js';
import { config } from '../config.js';
import { upiEnabled } from '../lib/payments.js';

const router = Router();

// Public: app settings the apps need before login.
router.get('/config', async (req, res) => {
  res.json({
    services: await getServices(),
    support: config.support,
    payments: { upi: upiEnabled() },
    money: {
      deliveryFeePaise: config.money.deliveryFeePaise,
      freeDeliveryAbovePaise: config.money.freeDeliveryAbovePaise,
    },
  });
});

// Public: villages to choose from at sign-up.
router.get('/villages', async (req, res) => {
  res.json(camel(await many('SELECT id, name, cluster, district FROM villages WHERE is_active ORDER BY cluster, name')));
});

// The cluster the customer lives in (shops and riders are shown per cluster).
async function clusterOf(user) {
  if (!user.village_id) return null;
  const v = await one('SELECT cluster FROM villages WHERE id = $1', [user.village_id]);
  return v?.cluster || null;
}

// Shops near the customer. ?type=food|grocery|dairy
router.get('/merchants', requireAuth, async (req, res) => {
  const q = parse(z.object({ type: z.enum(['food', 'grocery', 'dairy']).optional() }), req.query);
  const cluster = await clusterOf(req.user);
  const rows = await many(
    `SELECT m.id, m.name, m.type, m.landmark, m.description, m.is_open, v.name AS village_name,
            (SELECT COUNT(*)::int FROM products p WHERE p.merchant_id = m.id AND p.in_stock) AS product_count
       FROM merchants m JOIN villages v ON v.id = m.village_id
      WHERE m.status = 'approved'
        AND ($1::text IS NULL OR m.type = $1)
        AND ($2::text IS NULL OR v.cluster = $2)
      ORDER BY m.is_open DESC, m.name`,
    [q.type ?? null, cluster],
  );
  res.json(camel(rows));
});

// One shop and everything it sells.
router.get('/merchants/:id', requireAuth, async (req, res) => {
  const id = ids(req);
  const merchant = await one(
    `SELECT m.id, m.name, m.type, m.landmark, m.description, m.is_open, v.name AS village_name
       FROM merchants m JOIN villages v ON v.id = m.village_id
      WHERE m.id = $1 AND m.status = 'approved'`,
    [id],
  );
  if (!merchant) throw notFound('Shop not found');
  merchant.products = await many(
    `SELECT id, name, name_hi, name_ta, description, unit, category, price_paise, is_veg, is_subscribable, in_stock
       FROM products WHERE merchant_id = $1 ORDER BY sort_order, name`,
    [id],
  );
  res.json(camel(merchant));
});

// Search products across shops in the customer's cluster: ?q=atta
router.get('/search', requireAuth, async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(2).max(50) }), req.query);
  const cluster = await clusterOf(req.user);
  const rows = await many(
    `SELECT p.id, p.name, p.name_hi, p.name_ta, p.unit, p.price_paise, p.is_veg, p.in_stock,
            m.id AS merchant_id, m.name AS merchant_name, m.type AS merchant_type, m.is_open
       FROM products p
       JOIN merchants m ON m.id = p.merchant_id
       JOIN villages v ON v.id = m.village_id
      WHERE m.status = 'approved'
        AND (p.name ILIKE '%' || $1 || '%' OR p.name_hi ILIKE '%' || $1 || '%' OR p.name_ta ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR v.cluster = $2)
      ORDER BY p.in_stock DESC, m.is_open DESC, p.price_paise
      LIMIT 40`,
    [q.q, cluster],
  );
  res.json(camel(rows));
});

// Pickup / drop spots for rides, in the customer's cluster.
router.get('/places', requireAuth, async (req, res) => {
  const cluster = await clusterOf(req.user);
  const rows = await many(
    `SELECT p.id, p.name, p.lat, p.lng, v.name AS village_name
       FROM places p JOIN villages v ON v.id = p.village_id
      WHERE ($1::text IS NULL OR v.cluster = $1)
      ORDER BY v.name, p.name`,
    [cluster],
  );
  res.json(camel(rows));
});

export default router;
