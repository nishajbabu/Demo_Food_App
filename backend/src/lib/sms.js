// Sending SMS (login codes) and push notifications.
//
// SMS_PROVIDER=console  -> prints the message in the server window (development only).
// SMS_PROVIDER=http     -> sends JSON to SMS_HTTP_URL. Most Indian SMS providers accept a
//                          JSON POST; change the body below to match the one you choose.
//                          Remember: Indian SMS needs a DLT-registered sender ID and template.
import { config } from '../config.js';
import { many, query } from '../db.js';

export async function sendSms(phone, message) {
  const { provider, httpUrl, httpToken, senderId } = config.sms;
  if (provider === 'console') {
    if (config.env !== 'test') console.log(`\n[SMS to ${phone}] ${message}\n`);
    return;
  }
  if (provider === 'http') {
    const res = await fetch(httpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${httpToken}` },
      body: JSON.stringify({ to: `+91${phone}`, message, sender: senderId }),
    });
    if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
    return;
  }
  throw new Error(`Unknown SMS_PROVIDER "${provider}"`);
}

// Alerts to shops, riders, drivers and customers via Expo's free Push API.
export async function notify(userId, message, title = 'GaonGo') {
  if (config.env === 'test') return;
  console.log(`[notify user ${userId}] ${message}`);
  try {
    const rows = await many('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
    if (!rows.length) return;
    const messages = rows.map((r) => ({
      to: r.token,
      title,
      body: message,
      sound: 'default',
      priority: 'high',
      channelId: 'orders',
    }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    const json = await res.json().catch(() => null);
    const tickets = json?.data || [];
    for (let i = 0; i < tickets.length; i += 1) {
      if (tickets[i]?.details?.error === 'DeviceNotRegistered') {
        await query('DELETE FROM push_tokens WHERE token = $1', [rows[i].token]);
      }
    }
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
}