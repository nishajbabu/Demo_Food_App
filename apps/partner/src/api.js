// Talks to the GaonGo backend. Every screen uses api('/path', { method, body }).
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Where is the server?
// 1. EXPO_PUBLIC_API_URL from the .env file or the build profile (production: https://api.yourdomain.in)
// 2. While testing with Expo Go, the laptop running "npx expo start" (same Wi-Fi), port 4000
// 3. A server address typed on the login screen (Developer settings) overrides both.
function defaultUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

let baseUrl = defaultUrl();
let token = null;
let onUnauthorized = () => {};

const store = {
  get: (k) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  set: (k, v) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  del: (k) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k)),
};
export { store };

export async function loadServerUrl() {
  const saved = await store.get('serverUrl');
  if (saved) baseUrl = saved;
  return baseUrl;
}
export async function setServerUrl(url) {
  const clean = url.trim().replace(/\/$/, '');
  if (clean) {
    baseUrl = clean;
    await store.set('serverUrl', clean);
  } else {
    baseUrl = defaultUrl();
    await store.del('serverUrl');
  }
  return baseUrl;
}
export const getServerUrl = () => baseUrl;
export const setToken = (t) => {
  token = t;
};
export const setOnUnauthorized = (fn) => {
  onUnauthorized = fn;
};

export async function api(path, { method = 'GET', body, timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new Error('Cannot reach GaonGo. Check your internet and try again.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
