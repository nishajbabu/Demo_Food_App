// Razorpay calls this URL when a payment link is paid.
// Set it in the Razorpay dashboard: https://<your-server>/payments/razorpay/webhook
// with the event "payment_link.paid" and the same secret as RAZORPAY_WEBHOOK_SECRET.
import { tx } from '../db.js';
import { verifyWebhookSignature } from '../lib/payments.js';
import { notify } from '../lib/sms.js';

export async function razorpayWebhook(req, res) {
  const raw = req.body; // a Buffer, because this route reads the raw body
  if (!verifyWebhookSignature(raw, req.headers['x-razorpay-signature'])) {
    return res.status(400).json({ error: 'Bad signature' });
  }
  const event = JSON.parse(raw.toString('utf8'));
  if (event.event === 'payment_link.paid') {
    const linkId = event.payload?.payment_link?.entity?.id;
    if (linkId) {
      const notifyOwner = await tx(async (db) => {
        const payment = await db.one("UPDATE payments SET status = 'paid' WHERE provider_ref = $1 AND status <> 'paid' RETURNING *", [linkId]);
        if (!payment) return null;
        const order = await db.one(
          `UPDATE orders
              SET payment_status = 'paid',
                  status = CASE WHEN status = 'awaiting_payment' THEN 'placed' ELSE status END
            WHERE id = $1
            RETURNING id, status, merchant_id`,
          [payment.order_id],
        );
        if (order?.status === 'placed') {
          await db.query("INSERT INTO order_events (order_id, status, note) VALUES ($1, 'placed', 'UPI payment received')", [order.id]);
          const m = await db.one('SELECT owner_id FROM merchants WHERE id = $1', [order.merchant_id]);
          return { ownerId: m?.owner_id, orderId: order.id };
        }
        return null;
      });
      if (notifyOwner?.ownerId) notify(notifyOwner.ownerId, `New paid order GG-${notifyOwner.orderId}`);
    }
  }
  res.json({ ok: true });
}