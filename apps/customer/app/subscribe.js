// Start a new subscription: product, quantity, how often, morning or evening.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '../src/api';
import { useName, useT } from '../src/i18n';
import { useData } from '../src/state';
import { Button, Card, colors, ErrorBox, H2, Loading, money, Muted, Pill, Screen } from '../src/ui';

const PER_MONTH = { daily: 30, alternate: 15, weekly: 4 };

export default function Subscribe() {
  const t = useT();
  const nameOf = useName();
  const { data, error, loading } = useData('/subscriptions/products');
  const [productId, setProductId] = useState(null);
  const [qty, setQty] = useState(1);
  const [frequency, setFrequency] = useState('daily');
  const [slot, setSlot] = useState('morning');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const products = data?.products || [];
  const product = products.find((p) => p.id === productId);
  const isLitre = product?.unit === 'litre';
  const step = isLitre ? 0.5 : 1;

  async function start() {
    setBusy(true);
    setSaveError(null);
    try {
      await api('/subscriptions', { method: 'POST', body: { productId, qty, frequency, slot, startDate: data.earliestStartDate } });
      router.replace('/subscriptions');
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('newSubscription') }} />
      {loading ? <Loading /> : null}
      <ErrorBox error={error} />

      <H2>1. What do you want?</H2>
      {products.map((p) => (
        <Card
          key={p.id}
          onPress={() => {
            setProductId(p.id);
            setQty(1);
            setFrequency(p.unit.includes('basket') ? 'weekly' : 'daily');
          }}
          style={{ borderWidth: 2, borderColor: p.id === productId ? colors.green : colors.line }}
        >
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{nameOf(p)}</Text>
          <Muted>
            {money(p.pricePaise)} / {p.unit} · {p.merchantName}
          </Muted>
        </Card>
      ))}

      {product ? (
        <>
          <H2>2. How much each time?</H2>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Button title="−" kind="outline" style={{ width: 56 }} onPress={() => setQty((q) => Math.max(step, q - step))} />
            <Text style={{ fontSize: 22, fontWeight: '800', minWidth: 90, textAlign: 'center' }}>
              {qty} {isLitre ? 'L' : product.unit}
            </Text>
            <Button title="+" style={{ width: 56 }} onPress={() => setQty((q) => Math.min(10, q + step))} />
          </View>

          <H2>3. How often?</H2>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill label="Every day" selected={frequency === 'daily'} onPress={() => setFrequency('daily')} />
            <Pill label="Alternate days" selected={frequency === 'alternate'} onPress={() => setFrequency('alternate')} />
            <Pill label="Once a week" selected={frequency === 'weekly'} onPress={() => setFrequency('weekly')} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Pill label="Morning 6–7 AM" selected={slot === 'morning'} onPress={() => setSlot('morning')} />
            <Pill label="Evening 5–6 PM" selected={slot === 'evening'} onPress={() => setSlot('evening')} />
          </View>

          <Card style={{ backgroundColor: colors.bg, borderWidth: 0 }}>
            <Muted>Estimated for a month</Muted>
            <Text style={{ fontSize: 24, fontWeight: '900' }}>≈ {money(product.pricePaise * qty * PER_MONTH[frequency])}</Text>
            <Muted>Pay at month end by UPI, or cash to the delivery person. First delivery: {data.earliestStartDate}</Muted>
          </Card>
          <ErrorBox error={saveError} />
          <Button title="Start subscription" onPress={start} loading={busy} />
        </>
      ) : null}
    </Screen>
  );
}
