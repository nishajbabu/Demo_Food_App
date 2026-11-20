// Partner app memory: who is logged in (shop, rider or driver), language, and a data-loading hook.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, loadServerUrl, setOnUnauthorized, setToken, store } from './api';
import { registerPushToken, unregisterPushToken } from './push';

const AuthContext = createContext(null);

export function AppProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [lang, setLangState] = useState('en');
  const [config, setConfig] = useState(null);

  const logout = useCallback(async () => {
    await unregisterPushToken();
    setToken(null);
    setUser(null);
    await store.del('token');
  }, []);

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
          setUser((await api('/auth/me')).user);
          registerPushToken();
        } catch (e) {
          if (e.status === 401) await logout();
        }
      }
      api('/config').then(setConfig).catch(() => {});
      setReady(true);
    })();
  }, [logout]);

  const value = useMemo(
    () => ({
      ready,
      user,
      config,
      lang,
      setLang(l) {
        setLangState(l);
        store.set('lang', l);
      },
      logout,
      async loginWithToken(token, u) {
        setToken(token);
        await store.set('token', token);
        setUser(u);
        registerPushToken();
        api('/config').then(setConfig).catch(() => {});
      },
    }),
    [ready, user, config, lang, logout],
  );

  return <AuthContext.Provider value={value}>{ready ? children : <Splash />}</AuthContext.Provider>;
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

// Load data for a screen; reload on focus and every pollMs (live updates).
export function useData(path, { pollMs = 0, enabled = true, onData } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    try {
      const d = await api(path);
      setData(d);
      setError(null);
      onData?.(d);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

// Partner-app words in English, Tamil and Hindi.
const WORDS = {
  en: {
    online: 'Online',
    offline: 'Offline',
    open: 'Open',
    closed: 'Closed',
    accept: 'Accept',
    reject: 'Reject',
    ready: 'Food / items ready',
    newOrder: 'NEW ORDER',
    inProgress: 'In progress',
    history: 'History',
    products: 'Items & stock',
    sheet: 'Milk delivery sheet',
    pickedUp: 'Picked up',
    delivered: 'Mark delivered',
    navigate: 'Navigate',
    call: 'Call',
    logout: 'Log out',
    help: 'Help',
    language: 'EN ▾',
  },
  ta: {
    online: 'ஆன்லைன்',
    offline: 'ஆஃப்லைன்',
    open: 'திறந்துள்ளது',
    closed: 'மூடியுள்ளது',
    accept: 'ஏற்றுக்கொள்',
    reject: 'நிராகரி',
    ready: 'பொருட்கள் தயார்',
    newOrder: 'புதிய ஆர்டர்',
    inProgress: 'நடப்பில் உள்ளவை',
    history: 'பழைய ஆர்டர்கள்',
    products: 'பொருட்கள் & இருப்பு',
    sheet: 'பால் டெலிவரி பட்டியல்',
    pickedUp: 'எடுத்துவிட்டேன்',
    delivered: 'டெலிவரி ஆனது',
    navigate: 'வழி காட்டு',
    call: 'அழை',
    logout: 'வெளியேறு',
    help: 'உதவி',
    language: 'தமிழ் ▾',
  },
  hi: {
    online: 'ऑनलाइन',
    offline: 'ऑफ़लाइन',
    open: 'खुला',
    closed: 'बंद',
    accept: 'स्वीकार करें',
    reject: 'मना करें',
    ready: 'सामान तैयार है',
    newOrder: 'नया ऑर्डर',
    inProgress: 'चल रहे ऑर्डर',
    history: 'पुराने ऑर्डर',
    products: 'सामान और स्टॉक',
    sheet: 'दूध डिलीवरी सूची',
    pickedUp: 'सामान ले लिया',
    delivered: 'डिलीवर हो गया',
    navigate: 'रास्ता देखें',
    call: 'कॉल करें',
    logout: 'लॉग आउट',
    help: 'मदद',
    language: 'हिंदी ▾',
  },
};

export function useT() {
  const { lang } = useAuth();
  return (k) => WORDS[lang]?.[k] ?? WORDS.en[k] ?? k;
}
