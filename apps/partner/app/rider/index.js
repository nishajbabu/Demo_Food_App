// Delivery rider: go online, take delivery offers, pick up, deliver with the customer's OTP.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { call, Header, openMap, Toggle, useLocationUpdates, useNewItemAlert } from '../../src/common';
import { useData, useT } from '../../src/state';
import { Button, Card, colors, Empty, ErrorBox, Field, H2, Loading, money, Muted, Screen } from '../../src/ui';

export default function RiderHome() {
  const t = useT();
  const tasks = useData('/rider/tasks', { pollMs: 5000 });
  const [busy, setBusy] = useState(null);
  const [otp, setOtp] = useState({});
  const d = tasks.data;

  useLocationUpdates(Boolean(d?.online), '/rider/status');
  useNewItemAlert(d?.online ? (d.offers || []).map((o) => o.id) : null, 'New delivery near you!');

  async function post(path, body, id) {
    setBusy(id);
    try {
      await api(path, { method: 'POST', body });
      await tasks.reload();
    } catch (e) {
      Alert.alert('GaonGo', e.message);
      tasks.reload();
    } finally {
      setBusy(null);
    }
  }

  async function toggleOnline() {
    try {
      await api('/rider/status', { method: 'PATCH', body: { online: !d.online } });
      tasks.reload();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1F2933' }} edges={['top']}>
      <Header title="Delivery partner" subtitle="GaonGo Partner · Rider" right={d ? <Toggle on={d.online} onPress={toggleOnline} onLabel={t('online')} offLabel={t('offline')} /> : null} />
      <Screen style={{ backgroundColor: colors.bg }}>
        {tasks.loading ? <Loading /> : null}
        <ErrorBox error={tasks.error} onRetry={tasks.reload} />
        {d ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat label="Earned today" value={money(d.earnedTodayPaise)} />
            <Stat label="Deliveries" value={String(d.deliveriesToday)} />
            <Stat label="Cash with you" value={money(d.cashInHandPaise)} />
          </View>
        ) : null}

        {d && !d.online ? <Empty text="You are offline. Go online to get deliveries." /> : null}

        {(d?.active || []).map((o) => (
          <Card key={o.id} style={{ borderWidth: 2, borderColor: colors.green, gap: 10 }}>
            <Text style={{ fontWeight: '900', fontSize: 16 }}>
              {o.code} · {o.status === 'picked_up' ? 'Deliver now' : o.status === 'ready' ? 'Ready for pickup' : 'Shop is packing'}
            </Text>
            {o.status !== 'picked_up' ? (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>Pick up: {o.merchantName}</Text>
                <Muted>{o.merchantLandmark}</Muted>
                <Text>
                  Tell the shop pickup code <Text style={{ fontWeight: '900' }}>{o.pickupCode}</Text>
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title={t('navigate')} kind="outline" style={{ flex: 1 }} onPress={() => openMap(`${o.merchantName} ${o.villageName}`)} />
                  <Button title={`${t('call')} shop`} kind="outline" style={{ flex: 1 }} onPress={() => call(o.merchantPhone)} />
                </View>
                <Button title={t('pickedUp')} disabled={o.status !== 'ready'} loading={busy === o.id} onPress={() => post(`/rider/orders/${o.id}/picked-up`, {}, o.id)} />
                {o.status !== 'ready' ? <Muted>Wait until the shop marks it ready.</Muted> : null}
              </>
            ) : (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>Deliver to: {o.customerName || 'Customer'}</Text>
                <Muted>
                  {o.villageName} · {o.addressText}
                </Muted>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title={`${t('call')} customer`} kind="outline" style={{ flex: 1 }} onPress={() => call(o.customerPhone)} />
                  <Button title={t('navigate')} kind="outline" style={{ flex: 1 }} onPress={() => openMap(`${o.addressText} ${o.villageName}`)} />
                </View>
                {o.paymentMethod === 'cod' ? (
                  <Text style={{ backgroundColor: colors.marigoldTint, padding: 10, borderRadius: 10, fontWeight: '800' }}>
                    Collect {money(o.totalPaise)} cash (or show your UPI QR)
                  </Text>
                ) : (
                  <Text style={{ fontWeight: '700', color: colors.green }}>Paid online · collect nothing</Text>
                )}
                <Field label="Customer's 4-digit code" keyboardType="number-pad" maxLength={4} value={otp[o.id] || ''} onChangeText={(v) => setOtp({ ...otp, [o.id]: v })} />
                <Button
                  title={t('delivered')}
                  disabled={(otp[o.id] || '').length !== 4}
                  loading={busy === o.id}
                  onPress={() => post(`/rider/orders/${o.id}/delivered`, { otp: otp[o.id] }, o.id)}
                />
              </>
            )}
          </Card>
        ))}

        {d?.online && d.offers?.length ? <H2>New deliveries near you</H2> : null}
        {(d?.offers || []).map((o) => (
          <Card key={o.id} style={{ borderWidth: 2, borderColor: colors.marigold }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '900' }}>{o.code}</Text>
              <Text style={{ fontWeight: '900', color: colors.greenDark, fontSize: 18 }}>{money(o.earningPaise)}</Text>
            </View>
            <Text style={{ fontWeight: '700' }}>
              Pick up: {o.merchantName}
              {o.distanceKm != null ? ` · ${o.distanceKm.toFixed(1)} km` : ''}
            </Text>
            <Text style={{ fontWeight: '700' }}>Drop: {o.villageName}</Text>
            <Muted>{o.paymentMethod === 'cod' ? `Collect ${money(o.totalPaise)} cash` : 'Paid online'}</Muted>
            <Button title={t('accept')} loading={busy === o.id} onPress={() => post(`/rider/orders/${o.id}/accept`, {}, o.id)} />
          </Card>
        ))}

        <Muted>Hand over the cash you collect at the hub every evening. Earnings are paid weekly.</Muted>
      </Screen>
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderRadius: 12, padding: 10 }}>
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '900' }}>{value}</Text>
    </View>
  );
}
