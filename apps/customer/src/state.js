// App-wide memory: who is logged in, the cart, the language and server settings.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, loadServerUrl, setOnUnauthorized, setToken, store } from './api';
import { LangContext } from './i18n';
import { registerPushToken, unregisterPushToken } from './push';

const AuthContext = createContext(null);
const CartContext = createContext(null);
const ConfigContext = createContext(null);

export function AppProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [lang, setLangState] = useState('en');
  const [config, setConfig] = useState(null);
  const [cart, setCart] = useState({ merchant: null, items: {} }); // items: { [productId]: { product, qty } }

  const logout = useCallback(async () => {
    await unregisterPushToken();
    setToken(null);
    setUser(null);
    setCart({ merchant: null, items: {} });
    await store.del('token');
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api('/config'));
    } catch {
      // keep the last config; screens show their own errors
    }
  }, []);

  // On app start: restore server address, language and login.
  useEffect(() => {
    setOnUnauthorized(logout);
    (async () => {
      await loadServerUrl();
      const savedLang = await store.get('lang');
      if (savedLang) setLangState(savedLang);
      const token = await store.get('token');
      if (token) {
        setToken(token);
        try {
          const me = await api('/auth/me');
          setUser(me.user);
          registerPushToken();
        } catch (e) {
          if (e.status === 401) await logout();
        }
      }
      await refreshConfig();
      setReady(true);
    })();
  }, [logout, refreshConfig]);

  const auth = useMemo(
    () => ({
      ready,
      user,
      setUser,
      logout,
      async loginWithToken(token, u) {
        setToken(token);
        await store.set('token', token);
        setUser(u);
        registerPushToken();
        await refreshConfig();
      },
    }),
    [ready, user, logout, refreshConfig],
  );

  const langValue = useMemo(
    () => ({
      lang,
      setLang: (l) => {
        setLangState(l);
        store.set('lang', l);
        if (user) api('/auth/me', { method: 'PATCH', body: { language: l } }).catch(() => {});
      },
    }),
    [lang, user],
  );

  const cartValue = useMemo(() => {
    const list = Object.values(cart.items).filter((i) => i.qty > 0);
    return {
      merchant: cart.merchant,
      items: cart.items,
      list,
      count: list.reduce((s, i) => s + i.qty, 0),
      totalPaise: list.reduce((s, i) => s + i.qty * i.product.pricePaise, 0),
      qtyOf: (productId) => cart.items[productId]?.qty || 0,
      // A cart holds items from one shop at a time (one rider, one pickup).
      add(merchant, product) {
        setCart((c) => {
          const sameShop = c.merchant?.id === merchant.id;
          const items = sameShop ? { ...c.items } : {};
          const qty = (items[product.id]?.qty || 0) + 1;
          items[product.id] = { product, qty };
          return { merchant, items };
        });
      },
      remove(product) {
        setCart((c) => {
          const items = { ...c.items };
          const qty = (items[product.id]?.qty || 0) - 1;
          if (qty <= 0) delete items[product.id];
          else items[product.id] = { product, qty };
          return { merchant: Object.keys(items).length ? c.merchant : null, items };
        });
      },
      clear: () => setCart({ merchant: null, items: {} }),
    };
  }, [cart]);

  return (
    <AuthContext.Provider value={auth}>
      <ConfigContext.Provider value={{ config, refreshConfig }}>
        <LangContext.Provider value={langValue}>
          <CartContext.Provider value={cartValue}>{ready ? children : <Splash />}</CartContext.Provider>
        </LangContext.Provider>
      </ConfigContext.Provider>
    </AuthContext.Provider>
  );
}

// Shown for a moment while the saved login is restored.
function Splash() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
      <ActivityIndicator size="large" color="#0E7A45" />
    </View>
  );
}

export const useAuth = () => useContext(AuthContext);
export const useCart = () => useContext(CartContext);
export const useConfig = () => useContext(ConfigContext);

/**
 * Load data for a screen, reload when the screen comes back into view,
 * and optionally every `pollMs` milliseconds (live status).
 */
export function useData(path, { pollMs = 0, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    try {
      const d = await api(path);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [path, enabled]);

  useFocusEffect(
    useCallback(() => {
      load();
      if (!pollMs) return undefined;
      const t = setInterval(load, pollMs);
      return () => clearInterval(t);
    }, [load, pollMs]),
  );

  return { data, error, loading, reload: load, setData };
}
