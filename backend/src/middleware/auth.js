// Login tokens. After OTP login the app gets a token and sends it with every request:
//   Authorization: Bearer <token>
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { forbidden, unauthorized } from './errors.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, { expiresIn: '30d' });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your login has expired. Please log in again.');
  }
  // Load the user fresh each time, so blocking an account or changing a role works immediately.
  const user = await one('SELECT id, phone, name, role, village_id, landmark, language, is_active FROM users WHERE id = $1', [
    Number(payload.sub),
  ]);
  if (!user) throw unauthorized('Account not found. Please log in again.');
  if (!user.is_active) throw forbidden('This account is blocked. Please call GaonGo support.');
  req.user = user;
  next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role)) throw forbidden();
    next();
  };
