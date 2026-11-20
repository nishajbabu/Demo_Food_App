// Customer side of food and grocery orders.
import { Router } from 'express';
import { config } from '../config.js';
import { many, one, query, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { ids, parse, z } from '../lib/validate.js';
import { camel, randomDigits } from '../lib/util.js';
import { requireService } from '../lib/settings.js';
import { notify } from '../lib/sms.js';
import { createPaymentLink, upiEnabled } from '../lib/payments.js';
import { loadOrder, moveOrder } from '../services/orders.js';

const router = Router();
router.use(requireAuth, requireRole('customer'));

const newOrder = z.object({
  merchantId: z.coerce.number().int().positive(),
  items: z
    .array(z.object({ productId: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(1).max(50) }))
    .min(1, 'Your cart is empty')
    .max(50),
  paymentMethod: z.enum(['cod', 'upi']).default('cod'),
  addressText: z.string().trim().max(300).optional(),
  villageId: z.coerce.number().int().positive().optional(),
  note: z.string().trim().max(300).optional(),
});

// Place an order.
router.post('/', async (req, res) => {
  const body = parse(newOrder, req.body);
  const merchant = await one('SELECT * FROM merchants WHERE id = $1', [body.merchantId]);
  if (!merchant || merchant.status !== 'approved') throw notFound('Shop not found');
  if (!merchant.is_open) throw conflict(`${merchant.name} is closed right now`);
  const service = merchant.type === 'food' ? 'food' : 'grocery';
  await requireService(service);
  if (body.paymentMethod === 'upi' && !upiEnabled()) throw badRequest('Online payment is not available yet. Please choose cash on delivery.');

  const villageId = body.villageId || req.user.village_id;
  const addressText = body.addressText || req.user.landmark;
  if (!villageId) throw badRequest('Please choose your village first');
  if (!addressText) throw badRequest('Please add a landmark so the rider can find you');

  // Merge repeated products and load real prices from the database (never trust prices from the app).
  const qtyById = new Map();
  for (const it of body.items) qtyById.set(it.productId, (qtyById.get(it.productId) || 0) + it.qty);
  const products = await many('SELECT * FROM products WHERE id = ANY($1) AND merchant_id = $2', [[...qtyById.keys()], merchant.id]);
  if (products.length !== qtyById.size) throw badRequest('Some items are not sold by this shop');
  const outOfStock = products.filter((p) => !p.in_stock);
  if (outOfStock.length) throw conflict(`Out of stock: ${outOfStock.map((p) => p.name).join(', ')}`);

  const itemsTotal = products.reduce((sum, p) => sum + p.price_paise * qtyById.get(p.id), 0);
  const deliveryFee = itemsTotal >= config.money.freeDeliveryAbovePaise ? 0 : config.money.deliveryFeePaise;
  const initialStatus = body.paymentMethod === 'upi' ? 'awaiting_payment' : 'placed';

  const orderId = await tx(async (db) => {
    const order = await db.one(
      `INSERT INTO orders (customer_id, merchant_id, village_id, service, status, address_text, note,
                           items_total_paise, delivery_fee_paise, total_paise, payment_method, delivery_otp, pickup_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        req.user.id,
        merchant.id,
        villageId,
        service,
        initialStatus,
        addressText,
        body.note || null,
        itemsTotal,
        deliveryFee,
        itemsTotal + deliveryFee,
        body.paymentMethod,
        randomDigits(4),
        randomDigits(2),
      ],
    );
    for (const p of products) {
      await db.query('INSERT INTO order_items (order_id, product_id, name, unit, price_paise, qty) VALUES ($1, $2, $3, $4, $5, $6)', [
        order.id,
        p.id,
        p.name,
        p.unit,
        p.price_paise,
        qtyById.get(p.id),
      ]);
    }
    await db.query('INSERT INTO order_events (order_id, status, actor_id) VALUES ($1, $2, $3)', [order.id, initialStatus, req.user.id]);
    return order.id;
  });

  if (initialStatus === 'placed') notify(merchant.owner_id, `New order GG-${orderId}`);
  res.status(201).json(await loadOrder(orderId, { includeOtp: true }));
});

// My recent orders.
router.get('/mine', async (req, res) => {
  const rows = await many(
    `SELECT o.id, o.status, o.service, o.total_paise, o.payment_method, o.payment_status, o.created_at,
            m.name AS merchant_name,
            (SELECT COUNT(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o JOIN merchants m ON m.id = o.merchant_id
      WHERE o.customer_id = $1
      ORDER BY o.created_at DESC LIMIT 30`,
    [req.user.id],
  );
  res.json(camel(rows.map((r) => ({ ...r, code: `GG-${r.id}` }))));
});

// One order, with the delivery OTP (only the customer sees it).
router.get('/:id', async (req, res) => {
  const order = await loadOrder(ids(req), { includeOtp: true });
  if (!order || order.customerId !== req.user.id) throw notFound('Order not found');
  if (order.riderId && ['delivered', 'cancelled', 'rejected'].includes(order.status)) delete order.riderPhone;
  res.json(order);
});

// Cancel before the shop has packed it.
router.post('/:id/cancel', async (req, res) => {
  const id = ids(req);
  const body = parse(z.object({ reason: z.string().trim().max(200).optional() }), req.body);
  const order = await moveOrder({
    orderId: id,
    from: ['awaiting_payment', 'placed', 'accepted'],
    to: 'cancelled',
    actorId: req.user.id,
    note: body.reason || 'Cancelled by customer',
    extraSet: { cancel_reason: body.reason || 'Cancelled by customer' },
    guard: { column: 'customer_id', value: req.user.id },
  });
  if (order.payment_status === 'paid') {
    await query("INSERT INTO refunds (order_id, amount_paise, reason, created_by) VALUES ($1, $2, 'Customer cancelled', $3)", [
      id,
      order.total_paise,
      req.user.id,
    ]);
  }
  res.json(await loadOrder(id, { includeOtp: true }));
});

// Pay online: returns a UPI payment link to open.
router.post('/:id/pay', async (req, res) => {
  if (!upiEnabled()) throw badRequest('Online payment is not set up yet');
  const order = await one('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [ids(req), req.user.id]);
  if (!order) throw notFound('Order not found');
  if (order.payment_status === 'paid') throw conflict('This order is already paid');
  if (['cancelled', 'rejected'].includes(order.status)) throw forbidden('This order was cancelled');
  const link = await createPaymentLink({
    amountPaise: order.total_paise,
    referenceId: `GG-${order.id}-${Date.now()}`,
    description: `GaonGo order GG-${order.id}`,
    customerPhone: req.user.phone,
    customerName: req.user.name,
  });
  await query("INSERT INTO payments (order_id, provider, provider_ref, amount_paise) VALUES ($1, 'razorpay', $2, $3)", [
    order.id,
    link.id,
    order.total_paise,
  ]);
  res.json({ url: link.url });
});

export default router;
