// Shop home: open/closed switch, today's numbers, new orders to accept, orders in progress.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { call, Header, Toggle, useNewItemAlert } from '../../src/common';
import { useData, useT } from '../../src/state';
import { Button, Card, colors, Empty, ErrorBox, Loading, money, Muted, Pill, Screen } from '../../src/ui';

const STATUS = { placed: 'New', accepted: 'Packing', ready: 'Ready · waiting for rider', picked_up: 'Rider picked up', delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Rejected' };

export default function MerchantHome() {
  const t = useT();
  const [view, setView] = useState('active');
  const me = useData('/merchant/me', { pollMs: 30000 });
  const orders = useData(`/merchant/orders?view=${view}`, { pollMs: 5000 });
  const [busy, setBusy] = useState(null);
  const shop = me.data;

  const newIds = view === 'active' && orders.data ? orders.data.filter((o) => o.status === 'placed').map((o) => o.id) : null;
  useNewItemAlert(newIds, 'New order! Please accept it quickly.');

  async function act(order, action) {
    setBusy(order.id);
    try {
      await api(`/merchant/orders/${order.id}/${action}`, { method: 'POST', body: action === 'reject' ? { reason: 'Items not available' } : {} });
      await orders.reload();
      await me.reload();
    } catch (e) {
      Alert.alert('Could not update', e.message);
      orders.reload();
    } finally {
      setBusy(null);
    }
  }

  async function toggleOpen() {
    try {
      me.setData(await api('/merchant/me', { method: 'PATCH', body: { isOpen: !shop.isOpen } }));
      me.reload();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1F2933' }} edges={['top']}>
      <Header
        title={shop?.name || 'Your shop'}
        subtitle="GaonGo Partner · Shop"
        right={shop ? <Toggle on={shop.isOpen} onPress={toggleOpen} onLabel={t('open')} offLabel={t('closed')} /> : null}
      />
      <Screen style={{ backgroundColor: colors.bg }}>
        {shop ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat label="Orders today" value={String(shop.ordersToday)} />
            <Stat label="Sales today" value={money(shop.salesTodayPaise)} />
            <Stat label="Status" value={shop.status} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={t('inProgress')} selected={view === 'active'} onPress={() => setView('active')} />
          <Pill label={t('history')} selected={view === 'history'} onPress={() => setView('history')} />
          <Pill label={t('products')} onPress={() => router.push('/merchant/products')} />
          {shop?.type === 'dairy' || shop?.type === 'grocery' ? <Pill label={t('sheet')} onPress={() => router.push('/merchant/sheet')} /> : null}
        </View>

        <ErrorBox error={me.error || orders.error} onRetry={orders.reload} />
        {orders.loading ? <Loading /> : null}
        {!orders.loading && !(orders.data || []).length ? <Empty text={view === 'active' ? 'No orders right now.' : 'No past orders.'} /> : null}

        {(orders.data || []).map((o) => (
          <Card key={o.id} style={{ borderWidth: o.status === 'placed' ? 2 : 1, borderColor: o.status === 'placed' ? colors.marigold : colors.line }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '900', fontSize: 15 }}>
                {o.status === 'placed' ? `${t('newOrder')} · ` : ''}
                {o.code}
              </Text>
              <Text style={{ fontWeight: '700', color: colors.muted }}>{STATUS[o.status]}</Text>
            </View>
            {o.items.map((i, idx) => (
              <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 16 }}>
                  <Text style={{ fontWeight: '800' }}>{i.qty} ×</Text> {i.name} {i.unit ? `(${i.unit})` : ''}
                </Text>
                <Text style={{ fontSize: 16 }}>{money(i.pricePaise * i.qty)}</Text>
              </View>
            ))}
            {o.note ? <Text style={{ color: colors.brown, fontWeight: '700' }}>Note: {o.note}</Text> : null}
            <Muted>
              {o.customerName || 'Customer'} · {o.villageName} · {o.addressText}
            </Muted>
            <Text style={{ fontWeight: '800' }}>
              {o.paymentMethod === 'cod' ? 'Cash on delivery' : `UPI (${o.paymentStatus})`} · {money(o.itemsTotalPaise)}
            </Text>
            {o.riderName && ['accepted', 'ready'].includes(o.status) ? (
              <Muted>
                Rider {o.riderName} · hand over only when he says code {o.pickupCode}
              </Muted>
            ) : null}

            {o.status === 'placed' ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title={t('reject')} kind="danger" style={{ flex: 1 }} loading={busy === o.id} onPress={() => act(o, 'reject')} />
                <Button title={t('accept')} style={{ flex: 2 }} loading={busy === o.id} onPress={() => act(o, 'accept')} />
              </View>
            ) : null}
            {o.status === 'accepted' ? <Button title={t('ready')} loading={busy === o.id} onPress={() => act(o, 'ready')} /> : null}
            {o.customerPhone && view === 'active' ? <Button title={`${t('call')} customer`} kind="outline" onPress={() => call(o.customerPhone)} /> : null}
          </Card>
        ))}
      </Screen>
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderRadius: 12, padding: 10 }}>
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '900' }}>{value}</Text>
    </View>
  );
}
