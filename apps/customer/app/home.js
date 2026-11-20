// Home: one app, many services.
import { useContext, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LangContext, useT } from '../src/i18n';
import { useAuth, useConfig, useData } from '../src/state';
import { CartBar } from '../src/components';
import { colors, H1, Muted, Screen } from '../src/ui';

const TILES = [
  { key: 'food', service: 'food', bg: colors.orangeTint, fg: colors.orange, href: '/shops?type=food', sub: 'foodSub', mark: 'Food' },
  { key: 'grocery', service: 'grocery', bg: colors.greenTint, fg: colors.green, href: '/shops?type=grocery', sub: 'grocerySub', mark: 'Ration' },
  { key: 'milk', service: 'milk', bg: colors.blueTint, fg: colors.blue, href: '/subscriptions', sub: 'milkSub', mark: 'Milk' },
  { key: 'ride', service: 'rides', bg: colors.marigoldTint, fg: colors.brown, href: '/ride', sub: 'rideSub', mark: 'Ride' },
];

export default function Home() {
  const { user } = useAuth();
  const { config } = useConfig();
  const { lang, setLang } = useContext(LangContext);
  const t = useT();
  const [q, setQ] = useState('');
  const services = config?.services || {};
  const subs = useData('/subscriptions/mine', { enabled: Boolean(services.milk) });
  const tomorrow = (subs.data || []).find((s) => s.status === 'active' && s.days?.[0]?.delivery && !s.days?.[0]?.skipped);
  const support = config?.support || {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <Screen>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Pressable onPress={() => router.push('/profile')} accessibilityRole="button" style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>{t('deliverTo')} ▾</Text>
            <Text style={{ fontSize: 16, fontWeight: '800' }} numberOfLines={1}>
              {user?.landmark}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setLang({ en: 'ta', ta: 'hi', hi: 'en' }[lang] || 'en')}
            style={{ height: 44, minWidth: 68, borderRadius: 22, borderWidth: 1.5, borderColor: colors.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}
            accessibilityLabel="Switch language"
          >
            <Text style={{ color: colors.green, fontWeight: '800', fontSize: 15 }}>
              {{ en: 'EN ▾', ta: 'தமிழ் ▾', hi: 'हिं ▾' }[lang] || 'EN ▾'}
            </Text>
          </Pressable>
        </View>

        <View>
          <H1>
            {t('hello')}
            {user?.name ? `, ${user.name}` : ''}!
          </H1>
          <Muted style={{ fontSize: 16 }}>{t('whatToday')}</Muted>
        </View>

        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('search')}
          placeholderTextColor="#7A817C"
          returnKeyType="search"
          onSubmitEditing={() => q.trim().length >= 2 && router.push({ pathname: '/search', params: { q: q.trim() } })}
          style={{ height: 52, borderWidth: 1.5, borderColor: '#D9E3DC', borderRadius: 14, paddingHorizontal: 14, fontSize: 16 }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {TILES.map((tile) => {
            const on = services[tile.service];
            return (
              <Pressable
                key={tile.key}
                disabled={!on}
                onPress={() => router.push(tile.href)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  width: '47.5%',
                  minHeight: 150,
                  borderRadius: 18,
                  padding: 14,
                  backgroundColor: tile.bg,
                  justifyContent: 'space-between',
                  opacity: on ? (pressed ? 0.8 : 1) : 0.45,
                })}
              >
                <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: tile.fg, fontWeight: '900', fontSize: 12 }}>{tile.mark}</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{t(tile.key)}</Text>
                  <Text style={{ fontSize: 13, color: '#4A514C' }}>{on ? t(tile.sub) : t('soon')}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {tomorrow ? (
          <Pressable onPress={() => router.push('/subscriptions')} style={{ borderWidth: 1.5, borderColor: '#D9E3DC', borderRadius: 16, padding: 14 }}>
            <Muted>{t('tomorrow')}</Muted>
            <Text style={{ fontSize: 16, fontWeight: '700' }}>
              {tomorrow.productName} · {tomorrow.qty} {tomorrow.unit} · {tomorrow.slot === 'morning' ? '6–7 AM' : '5–6 PM'}
            </Text>
          </Pressable>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[
            ['orders', '/orders'],
            ['help', '/help'],
            ['profile', '/profile'],
          ].map(([key, href]) => (
            <Pressable key={key} onPress={() => router.push(href)} style={{ flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.green }}>{t(key)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 14, gap: 6 }}>
          <Text style={{ fontWeight: '600' }}>{t('noHome')}</Text>
          {support.whatsapp ? (
            <Text style={{ color: colors.green, fontWeight: '800' }} onPress={() => Linking.openURL(`https://wa.me/91${support.whatsapp}`)}>
              WhatsApp {support.whatsapp}
            </Text>
          ) : null}
          {support.phone ? (
            <Text style={{ color: colors.green, fontWeight: '800' }} onPress={() => Linking.openURL(`tel:${support.phone}`)}>
              Call {support.phone}
            </Text>
          ) : null}
        </View>
      </Screen>
      <CartBar />
    </SafeAreaView>
  );
}
