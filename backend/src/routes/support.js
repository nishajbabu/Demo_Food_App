// Help tickets raised from the customer app or partner app.
import { Router } from 'express';
import { many, one, query, tx } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { notFound } from '../middleware/errors.js';
import { ids, parse, z } from '../lib/validate.js';
import { camel } from '../lib/util.js';

const router = Router();
router.use(requireAuth);

const newTicket = z.object({
  subject: z.string().trim().min(3).max(120),
  category: z.enum(['order', 'subscription', 'ride', 'payment', 'partner', 'safety', 'other']).default('other'),
  orderId: z.coerce.number().int().positive().optional(),
  rideId: z.coerce.number().int().positive().optional(),
  message: z.string().trim().min(1).max(2000),
});

router.post('/tickets', async (req, res) => {
  const b = parse(newTicket, req.body);
  if (b.orderId) {
    const own = await one(
      'SELECT 1 FROM orders o LEFT JOIN merchants m ON m.id = o.merchant_id WHERE o.id = $1 AND (o.customer_id = $2 OR o.rider_id = $2 OR m.owner_id = $2)',
      [b.orderId, req.user.id],
    );
    if (!own) throw notFound('Order not found');
  }
  const ticket = await tx(async (db) => {
    const t = await db.one(
      `INSERT INTO tickets (created_by, subject, category, order_id, ride_id, priority)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.id, b.subject, b.category, b.orderId ?? null, b.rideId ?? null, b.category === 'safety' ? 'high' : 'medium'],
    );
    await db.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1, $2, $3)', [t.id, req.user.id, b.message]);
    return t;
  });
  res.status(201).json(camel(ticket));
});

router.get('/tickets/mine', async (req, res) => {
  res.json(camel(await many('SELECT * FROM tickets WHERE created_by = $1 ORDER BY created_at DESC LIMIT 30', [req.user.id])));
});

router.get('/tickets/:id', async (req, res) => {
  const t = await one('SELECT * FROM tickets WHERE id = $1 AND created_by = $2', [ids(req), req.user.id]);
  if (!t) throw notFound('Ticket not found');
  t.messages = await many('SELECT id, body, is_staff, created_at FROM ticket_messages WHERE ticket_id = $1 ORDER BY id', [t.id]);
  res.json(camel(t));
});

router.post('/tickets/:id/messages', async (req, res) => {
  const b = parse(z.object({ message: z.string().trim().min(1).max(2000) }), req.body);
  const t = await one('SELECT id FROM tickets WHERE id = $1 AND created_by = $2', [ids(req), req.user.id]);
  if (!t) throw notFound('Ticket not found');
  await query("INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1, $2, $3)", [t.id, req.user.id, b.message]);
  await query("UPDATE tickets SET status = 'open', resolved_at = NULL WHERE id = $1", [t.id]);
  res.status(201).json({ ok: true });
});

export default router;
