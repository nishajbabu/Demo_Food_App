// Live order tracking: status steps, delivery OTP, rider contact, bill.
import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api';
import { useT } from '../../src/i18n';
import { useData } from '../../src/state';
import { STATUS_TEXT } from '../../src/components';
import { Button, Card, colors, ErrorBox, H1, Loading, money, Muted, Screen } from '../../src/ui';

const STEPS = ['placed', 'accepted', 'ready', 'picked_up', 'delivered'];
const STEP_LABEL = { placed: 'Order placed', accepted: 'Shop accepted', ready: 'Packed', picked_up: 'On the way', delivered: 'Delivered' };

export default function OrderScreen() {
  const { id } = useLocalSearchParams();
  const t = useT();
  const { data: o, error, loading, reload, setData } = useData(`/orders/${id}`, { pollMs: 8000 });
  const [busy, setBusy] = useState(false);

  if (loading && !o) return <Loading />;
  if (!o) return <ErrorBox error={error} onRetry={reload} />;

  const stopped = ['cancelled', 'rejected'].includes(o.status);
  const at = STEPS.indexOf(o.status);
  const when = (status) => o.events?.find((e) => e.status === status)?.createdAt;

  function cancel() {
    Alert.alert('Cancel this order?', '', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, cancel',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            setData(await api(`/orders/${o.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by customer' } }));
          } catch (e) {
            Alert.alert('Could not cancel', e.message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: o.code }} />
      <H1 style={{ color: stopped ? colors.red : colors.ink }}>{STATUS_TEXT[o.status]}</H1>
      <Muted>
        {o.merchantName} · {o.items.length} {t('items')}
      </Muted>
      <ErrorBox error={error} />

      {!stopped ? (
        <View style={{ gap: 10 }}>
          {STEPS.map((s, i) => (
            <View key={s} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: i <= at ? colors.green : colors.white,
                  borderWidth: 2,
                  borderColor: i <= at ? colors.green : '#B8BFBA',
                }}
              />
              <Text style={{ fontSize: 15, fontWeight: i === at ? '800' : '500', color: i <= at ? colors.ink : colors.muted }}>
                {STEP_LABEL[s]}
                {when(s) ? `  ·  ${new Date(when(s)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Muted>{o.cancelReason}</Muted>
      )}

      {!stopped && o.status !== 'delivered' ? (
        <Card style={{ backgroundColor: colors.marigoldTint, borderWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ flex: 1, fontSize: 14 }}>{t('yourOtp')}</Text>
          <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 4 }}>{o.deliveryOtp}</Text>
        </Card>
      ) : null}

      {o.riderName && o.status !== 'delivered' ? (
        <Card>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{o.riderName} is your delivery partner</Text>
          {o.riderPhone ? <Button title={t('callRider')} kind="outline" onPress={() => Linking.openURL(`tel:${o.riderPhone}`)} /> : null}
        </Card>
      ) : null}

      <Card style={{ backgroundColor: colors.bg, borderWidth: 0 }}>
        {o.items.map((i) => (
          <View key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text>
              {i.qty} × {i.name}
            </Text>
            <Text>{money(i.pricePaise * i.qty)}</Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text>{t('delivery')}</Text>
          <Text>{o.deliveryFeePaise ? money(o.deliveryFeePaise) : t('free')}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{t('total')}</Text>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{money(o.totalPaise)}</Text>
        </View>
        <Muted>
          {o.paymentMethod === 'cod' ? t('cod') : t('upi')} · {o.paymentStatus}
        </Muted>
        <Muted>
          {t('deliverTo')}: {o.addressText}
        </Muted>
      </Card>

      {o.status === 'awaiting_payment' ? (
        <Button
          title={t('upi')}
          onPress={async () => {
            try {
              const link = await api(`/orders/${o.id}/pay`, { method: 'POST' });
              Linking.openURL(link.url);
            } catch (e) {
              Alert.alert('Payment error', e.message);
            }
          }}
        />
      ) : null}
      {['awaiting_payment', 'placed', 'accepted'].includes(o.status) ? <Button title={t('cancel')} kind="danger" onPress={cancel} loading={busy} /> : null}
      <Button title="Problem with this order?" kind="outline" onPress={() => router.push({ pathname: '/help', params: { orderId: o.id } })} />
    </Screen>
  );
}
