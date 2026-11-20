// Pieces shared by the shop, rider and driver screens.
import { useEffect, useRef } from 'react';
import { Alert, Linking, Platform, Pressable, Text, Vibration, View } from 'react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { api } from './api';
import { useAuth, useT } from './state';
import { colors } from './ui';

// Top band with the name, a language switch, help and logout.
export function Header({ title, subtitle, right, dark = true }) {
  const { lang, setLang, logout } = useAuth();
  const t = useT();
  const fg = dark ? colors.white : colors.ink;
  return (
    <View style={{ backgroundColor: dark ? '#1F2933' : colors.green, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#C9D1CC', fontSize: 13, fontWeight: '600' }}>{subtitle}</Text>
          <Text style={{ color: fg, fontSize: 23, fontWeight: '900' }} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {right}
      </View>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Text style={{ color: '#E2EFE6', fontWeight: '700' }} onPress={() => setLang({ en: 'ta', ta: 'hi', hi: 'en' }[lang] || 'en')}>
          {t('language')}
        </Text>
        <Text style={{ color: '#E2EFE6', fontWeight: '700' }} onPress={() => router.push('/help')}>
          {t('help')}
        </Text>
        <Text
          style={{ color: '#E2EFE6', fontWeight: '700' }}
          onPress={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          {t('logout')}
        </Text>
      </View>
    </View>
  );
}

// Big on/off switch used for "shop open" and "I'm online".
export function Toggle({ on, onPress, onLabel, offLabel }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 14, paddingRight: 6, borderRadius: 23, backgroundColor: on ? colors.marigold : colors.white }}
    >
      <Text style={{ fontWeight: '800', fontSize: 15, color: colors.ink }}>{on ? onLabel : offLabel}</Text>
      <View style={{ width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: on ? colors.green : '#B8BFBA', alignItems: on ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.white }} />
      </View>
    </Pressable>
  );
}

export const call = (phone) => phone && Linking.openURL(`tel:${phone}`);
export const openMap = (place) => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`);

// Buzz and pop up when something new arrives (new order, new ride request).
export function useNewItemAlert(ids, message) {
  const seen = useRef(null);
  useEffect(() => {
    if (!ids) return;
    if (seen.current) {
      const fresh = ids.filter((id) => !seen.current.has(id));
      if (fresh.length) {
        if (Platform.OS !== 'web') Vibration.vibrate([0, 600, 300, 600, 300, 600]);
        Alert.alert('GaonGo', message);
      }
    }
    seen.current = new Set(ids);
  }, [ids, message]);
}

// While online, send our location every minute so nearby work comes first.
export function useLocationUpdates(online, statusPath) {
  useEffect(() => {
    if (!online || Platform.OS === 'web') return undefined;
    let stopped = false;
    async function send() {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted' || stopped) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await api(statusPath, { method: 'PATCH', body: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      } catch {
        // no GPS fix right now; try again next minute
      }
    }
    send();
    const t = setInterval(send, 60_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [online, statusPath]);
}
