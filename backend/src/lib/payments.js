// Online UPI payments through Razorpay Payment Links.
// How it works: we ask Razorpay for a payment link, the app opens it, the customer pays
// with any UPI app, and Razorpay calls our webhook to say "paid".
// Check the request fields against Razorpay's current API docs before going live.
import crypto from 'node:crypto';
import { config } from '../config.js';

export const upiEnabled = () => Boolean(config.razorpay.keyId && config.razorpay.keySecret);

export async function createPaymentLink({ amountPaise, referenceId, description, customerPhone, customerName }) {
  const { keyId, keySecret } = config.razorpay;
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      reference_id: referenceId,
      description,
      customer: { name: customerName || 'GaonGo customer', contact: `+91${customerPhone}` },
      notify: { sms: true },
      reminder_enable: false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay error ${res.status}: ${data?.error?.description || 'unknown'}`);
  return { id: data.id, url: data.short_url };
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
