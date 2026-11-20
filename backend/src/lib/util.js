// Small helpers used everywhere.
import crypto from 'node:crypto';

// Database columns are snake_case (created_at); the apps use camelCase (createdAt).
const toCamelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function camel(value) {
  if (Array.isArray(value)) return value.map(camel);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[toCamelKey(k)] = camel(v);
    return out;
  }
  return value;
}

export const randomDigits = (n) => crypto.randomInt(0, 10 ** n).toString().padStart(n, '0');

export const rupees = (paise) => `Rs ${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;
