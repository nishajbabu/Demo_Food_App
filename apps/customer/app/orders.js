// My orders.
import { Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useT } from '../src/i18n';
import { useData } from '../src/state';
import { STATUS_TEXT } from '../src/components';
import { Card, colors, Empty, ErrorBox, Loading, money, Muted, Screen } from '../src/ui';

export default function Orders() {
  const t = useT();
  const { data, error, loading, reload } = useData('/orders/mine', { pollMs: 15000 });
  return (
    <Screen>
      <Stack.Screen options={{ title: t('orders') }} />
      {loading ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {!loading && !(data || []).length ? <Empty text="No orders yet." /> : null}
      {(data || []).map((o) => (
        <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{o.merchantName}</Text>
            <Text style={{ fontWeight: '800' }}>{money(o.totalPaise)}</Text>
          </View>
          <Muted>
            {o.code} · {o.itemCount} {t('items')} · {new Date(o.createdAt).toLocaleString()}
          </Muted>
          <Text style={{ fontWeight: '700', color: ['cancelled', 'rejected'].includes(o.status) ? colors.red : colors.green }}>
            {STATUS_TEXT[o.status] || o.status}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
