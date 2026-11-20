// Checks that what the apps send is in the right shape before we touch the database.
import { z } from 'zod';
import { badRequest } from '../middleware/errors.js';

export { z };

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    const first = details[0];
    throw badRequest(first ? `${first.field ? first.field + ': ' : ''}${first.message}` : 'Invalid input', details);
  }
  return result.data;
}

export const idParam = z.coerce.number().int().positive();
export const phone = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');
export const month = z.string().regex(/^\d{4}-\d{2}$/, 'Use the month format YYYY-MM');
export const paise = z.coerce.number().int().min(0);

export const ids = (req) => parse(z.object({ id: idParam }), req.params).id;
