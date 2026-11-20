// Dairy / subscription delivery sheet: who gets what today or tomorrow, tick as delivered,
// and month-end dues with cash or UPI payments recorded.
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../../src/api';
import { call } from '../../src/common';
import { useData, useT } from '../../src/state';
import { Button, Card, colors, Empty, ErrorBox, Field, H2, Loading, money, Muted, Pill, Screen } from '../../src/ui';

const isoDay = (offset) => {
  const d = new Date(Date.now() + offset * 864e5 + 5.5 * 3600e3); // India time
  return d.toISOString().slice(0, 10);
};

export default function Sheet() {
  const t = useT();
  const [day, setDay] = useState(0);
  const date = isoDay(day);
  const sheet = useData(`/merchant/subscriptions/sheet?date=${date}`);
  const dues = useData('/merchant/subscriptions/dues');
  const [payFor, setPayFor] = useState(null);
  const [amount, setAmount] = useState('');

  async function mark(d, status) {
    try {
      await api(`/merchant/subscription-deliveries/${d.id}`, { method: 'POST', body: { status } });
      sheet.reload();
      dues.reload();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function recordPayment(home, method) {
    try {
      await api('/merchant/subscriptions/payments', {
        method: 'POST',
        body: { customerId: home.customerId, month: dues.data.month, amountPaise: Math.round(parseFloat(amount) * 100), method },
      });
      setPayFor(null);
      setAmount('');
      dues.reload();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  const s = sheet.data;
  return (
    <Screen style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('sheet') }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill label={`Today ${isoDay(0).slice(5)}`} selected={day === 0} onPress={() => setDay(0)} />
        <Pill label={`Tomorrow ${isoDay(1).slice(5)}`} selected={day === 1} onPress={() => setDay(1)} />
      </View>
      {sheet.loading ? <Loading /> : null}
      <ErrorBox error={sheet.error} onRetry={sheet.reload} />
      {s ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {s.totals.map((x) => (
              <Card key={x.product} style={{ flexGrow: 1 }}>
                <Muted>{x.product}</Muted>
                <Text style={{ fontSize: 20, fontWeight: '900' }}>{x.qty}</Text>
              </Card>
            ))}
            <Card style={{ flexGrow: 1 }}>
              <Muted>Homes · paused</Muted>
              <Text style={{ fontSize: 20, fontWeight: '900' }}>
                {s.homes} · {s.paused}
              </Text>
            </Card>
          </View>
          <Muted>
            {s.done} of {s.deliveries.length} done
          </Muted>
          {!s.deliveries.length ? <Empty text="No deliveries for this day." /> : null}
          {s.deliveries.map((d) => (
            <Card key={d.id} style={{ backgroundColor: d.status === 'delivered' ? colors.greenTint : colors.white }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>
                {d.customerName || d.customerPhone} · {d.productName} {d.qty} {d.unit}
              </Text>
              <Muted>
                {d.villageName} · {d.addressText} · {d.slot}
              </Muted>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {d.status === 'scheduled' ? (
                  <>
                    <Button title="Delivered" style={{ flex: 2 }} onPress={() => mark(d, 'delivered')} />
                    <Button title="Missed" kind="danger" style={{ flex: 1 }} onPress={() => mark(d, 'missed')} />
                  </>
                ) : (
                  <Pressable onPress={() => mark(d, 'scheduled')} style={{ paddingVertical: 8 }}>
                    <Text style={{ fontWeight: '800', color: d.status === 'delivered' ? colors.green : colors.red }}>
                      {d.status === 'delivered' ? 'Delivered' : 'Missed'} · tap to undo
                    </Text>
                  </Pressable>
                )}
                <Button title={t('call')} kind="outline" style={{ flex: 1 }} onPress={() => call(d.customerPhone)} />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <H2>Month-end dues {dues.data ? `(${dues.data.month})` : ''}</H2>
      {dues.data ? <Text style={{ fontSize: 22, fontWeight: '900' }}>{money(dues.data.totalDuePaise)} to collect</Text> : null}
      {(dues.data?.homes || []).map((h) => (
        <Card key={h.customerId}>
          <Text style={{ fontWeight: '800' }}>{h.customerName || h.customerPhone}</Text>
          <Muted>
            Billed {money(h.billedPaise)} · paid {money(h.paidPaise)} · due {money(Math.max(0, h.duePaise))}
          </Muted>
          {payFor === h.customerId ? (
            <View style={{ gap: 8 }}>
              <Field label="Amount received (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Cash" style={{ flex: 1 }} disabled={!(parseFloat(amount) > 0)} onPress={() => recordPayment(h, 'cash')} />
                <Button title="UPI" kind="outline" style={{ flex: 1 }} disabled={!(parseFloat(amount) > 0)} onPress={() => recordPayment(h, 'upi')} />
              </View>
            </View>
          ) : (
            <Text style={{ color: colors.green, fontWeight: '700' }} onPress={() => setPayFor(h.customerId)}>
              Record payment
            </Text>
          )}
        </Card>
      ))}
    </Screen>
  );
}
