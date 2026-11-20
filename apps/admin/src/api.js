// Talks to the GaonGo backend from the browser.
// Server address: VITE_API_URL (set in .env or on Vercel/Netlify), else http://localhost:4000.
const DEFAULT = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const getServer = () => localStorage.getItem('serverUrl') || DEFAULT;
export const setServer = (url) => (url ? localStorage.setItem('serverUrl', url.replace(/\/$/, '')) : localStorage.removeItem('serverUrl'));

let onUnauthorized = () => {};
export const setOnUnauthorized = (fn) => {
  onUnauthorized = fn;
};

export async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('adminToken');
  let res;
  try {
    res = await fetch(getServer() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${getServer()}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function money(paise) {
  if (paise == null) return '–';
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export const time = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
