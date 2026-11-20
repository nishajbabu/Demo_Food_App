// Login with phone number + one-time code (OTP). No passwords.
import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { badRequest, forbidden, HttpError } from '../middleware/errors.js';
import { parse, phone, z } from '../lib/validate.js';
import { camel, randomDigits } from '../lib/util.js';
import { sendSms } from '../lib/sms.js';

const router = Router();

const hashOtp = (p, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${p}:${code}`).digest('hex');

// Which roles may log in to which app.
const APP_ROLES = {
  customer: ['customer'],
  partner: ['merchant', 'rider', 'driver'],
  admin: ['admin', 'support'],
};

export function publicUser(u) {
  return camel({
    id: u.id,
    phone: u.phone,
    name: u.name,
    role: u.role,
    village_id: u.village_id,
    landmark: u.landmark,
    language: u.language,
  });
}

// Step 1: the app sends the phone number, we SMS a code.
router.post('/request-otp', async (req, res) => {
  const body = parse(z.object({ phone }), req.body);
  const last = await one('SELECT created_at FROM otp_codes WHERE phone = $1', [body.phone]);
  if (last && Date.now() - new Date(last.created_at).getTime() < config.otp.resendSeconds * 1000) {
    throw new HttpError(429, `Please wait ${config.otp.resendSeconds} seconds before asking for a new code`);
  }
  const code = randomDigits(config.otp.digits);
  await query(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, created_at)
     VALUES ($1, $2, now() + make_interval(mins => $3), 0, now())
     ON CONFLICT (phone) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
    [body.phone, hashOtp(body.phone, code), config.otp.ttlMinutes],
  );
  await sendSms(body.phone, `${code} is your GaonGo login code. Valid for ${config.otp.ttlMinutes} minutes. Do not share it.`);
  // In development the code is also returned so you can test without a real SMS.
  res.json({ ok: true, ...(config.otp.devMode ? { devOtp: code } : {}) });
});

// Step 2: the app sends the code back; we return a login token.
router.post('/verify-otp', async (req, res) => {
  const body = parse(
    z.object({
      phone,
      otp: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS'),
      app: z.enum(['customer', 'partner', 'admin']).default('customer'),
      name: z.string().trim().min(1).max(80).optional(),
    }),
    req.body,
  );

  const row = await one('SELECT * FROM otp_codes WHERE phone = $1', [body.phone]);
  if (!row || new Date(row.expires_at) < new Date()) throw badRequest('This code has expired. Ask for a new one.');
  if (row.attempts >= config.otp.maxAttempts) throw new HttpError(429, 'Too many wrong tries. Ask for a new code.');
  if (row.code_hash !== hashOtp(body.phone, body.otp)) {
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1', [body.phone]);
    throw badRequest('Wrong code. Please check the SMS.');
  }
  await query('DELETE FROM otp_codes WHERE phone = $1', [body.phone]);

  let user = await one('SELECT * FROM users WHERE phone = $1', [body.phone]);
  if (!user) {
    // New numbers become customers. Shops, riders, drivers and staff are added by the admin team.
    if (body.app !== 'customer') throw forbidden('This number is not registered as a GaonGo partner. Please contact the GaonGo team.');
    user = await one("INSERT INTO users (phone, name, role) VALUES ($1, $2, 'customer') RETURNING *", [body.phone, body.name || null]);
  }
  if (!user.is_active) throw forbidden('This account is blocked. Please call GaonGo support.');
  if (!APP_ROLES[body.app].includes(user.role)) {
    const where = APP_ROLES.partner.includes(user.role) ? 'the GaonGo Partner app' : user.role === 'customer' ? 'the GaonGo customer app' : 'the admin console';
    throw forbidden(`This number is registered for ${where}.`);
  }
  res.json({ token: signToken(user), user: publicUser(user), isNew: !user.name });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Customers set their name, village and landmark after the first login.
router.patch('/me', requireAuth, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      villageId: z.coerce.number().int().positive().optional(),
      landmark: z.string().trim().max(200).optional(),
      language: z.enum(['en', 'hi', 'ta']).optional(),
    }),
    req.body,
  );
  const user = await one(
    `UPDATE users SET
       name = COALESCE($2, name),
       village_id = COALESCE($3, village_id),
       landmark = COALESCE($4, landmark),
       language = COALESCE($5, language)
     WHERE id = $1 RETURNING *`,
    [req.user.id, body.name ?? null, body.villageId ?? null, body.landmark ?? null, body.language ?? null],
  );
  res.json({ user: publicUser(user) });
});

router.post('/push-token', requireAuth, async (req, res) => {
  const body = parse(z.object({ token: z.string().trim().min(10).max(300) }), req.body);
  await query(
    `INSERT INTO push_tokens (token, user_id, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()`,
    [body.token, req.user.id],
  );
  res.json({ ok: true });
});

router.delete('/push-token', requireAuth, async (req, res) => {
  const body = parse(z.object({ token: z.string().trim().min(10).max(300) }), req.body);
  await query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [body.token, req.user.id]);
  res.json({ ok: true });
});

export default router;
