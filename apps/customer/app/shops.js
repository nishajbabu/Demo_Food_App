// List of shops for one service (food, or daily needs = grocery + dairy).
import { Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useT } from '../src/i18n';
import { useData } from '../src/state';
import { CartBar } from '../src/components';
import { Card, colors, Empty, ErrorBox, Loading, Muted, Screen } from '../src/ui';

export default function Shops() {
  const { type } = useLocalSearchParams();
  const t = useT();
  const { data, error, loading, reload } = useData('/merchants');
  const wanted = type === 'food' ? ['food'] : ['grocery', 'dairy'];
  const shops = (data || []).filter((m) => wanted.includes(m.type));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: type === 'food' ? t('food') : t('grocery') }} />
      <Screen>
        {loading ? <Loading /> : null}
        <ErrorBox error={error} onRetry={reload} />
        {!loading && !shops.length ? <Empty text="No shops in your area yet." /> : null}
        {shops.map((m) => (
          <Card key={m.id} onPress={() => router.push(`/shop/${m.id}`)} style={{ opacity: m.isOpen ? 1 : 0.6 }}>
            <Text style={{ fontSize: 17, fontWeight: '800' }}>{m.name}</Text>
            {m.description ? <Muted>{m.description}</Muted> : null}
            <Muted>
              {m.villageName}
              {m.landmark ? ` · ${m.landmark}` : ''}
            </Muted>
            <Text style={{ fontWeight: '700', color: m.isOpen ? colors.green : colors.red }}>
              {m.isOpen ? `${m.productCount} items` : t('closed')}
            </Text>
          </Card>
        ))}
      </Screen>
      <CartBar />
    </View>
  );
}
