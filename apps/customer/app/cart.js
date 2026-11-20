// Cart and checkout.
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '../src/api';
import { useName, useT } from '../src/i18n';
import { useAuth, useCart, useConfig } from '../src/state';
import { Button, Card, colors, Empty, ErrorBox, Field, H2, money, Muted, Pill, Screen, Stepper } from '../src/ui';

export default function Cart() {
  const cart = useCart();
  const { user } = useAuth();
  const { config } = useConfig();
  const t = useT();
  const nameOf = useName();
  const [address, setAddress] = useState(user?.landmark || '');
  const [note, setNote] = useState('');
  const [pay, setPay] = useState('cod');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const feeRule = config?.money || { deliveryFeePaise: 2000, freeDeliveryAbovePaise: 19900 };
  const fee = cart.totalPaise >= feeRule.freeDeliveryAbovePaise ? 0 : feeRule.deliveryFeePaise;
  const upiOn = Boolean(config?.payments?.upi);

  async function placeOrder() {
    setBusy(true);
    setError(null);
    try {
      const order = await api('/orders', {
        method: 'POST',
        body: {
          merchantId: cart.merchant.id,
          items: cart.list.map((i) => ({ productId: i.product.id, qty: i.qty })),
          paymentMethod: pay,
          addressText: address,
          note: note || undefined,
        },
      });
      cart.clear();
      if (pay === 'upi') {
        const link = await api(`/orders/${order.id}/pay`, { method: 'POST' });
        Linking.openURL(link.url);
      }
      router.replace(`/order/${order.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!cart.count) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('cart') }} />
        <Empty text="Your cart is empty." />
        <Button title="Back to home" kind="outline" onPress={() => router.replace('/home')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('cart') }} />
      <H2>{cart.merchant.name}</H2>
      <Card>
        {cart.list.map(({ product, qty }) => (
          <View key={product.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', fontSize: 15 }}>{nameOf(product)}</Text>
              <Muted>
                {product.unit} · {money(product.pricePaise * qty)}
              </Muted>
            </View>
            <Stepper qty={qty} onAdd={() => cart.add(cart.merchant, product)} onRemove={() => cart.remove(product)} />
          </View>
        ))}
      </Card>

      <Card style={{ backgroundColor: colors.bg, borderWidth: 0 }}>
        <Row label={t('items')} value={money(cart.totalPaise)} />
        <Row label={t('delivery')} value={fee ? money(fee) : t('free')} />
        {fee ? <Muted>Add {money(feeRule.freeDeliveryAbovePaise - cart.totalPaise)} more for free delivery</Muted> : null}
        <Row label={t('total')} value={money(cart.totalPaise + fee)} bold />
      </Card>

      <Field label={t('deliverTo')} value={address} onChangeText={setAddress} multiline />
      <Field label="Note for the shop (optional)" value={note} onChangeText={setNote} placeholder="Less spicy, call before coming…" />

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill label={t('cod')} selected={pay === 'cod'} onPress={() => setPay('cod')} />
        {upiOn ? <Pill label={t('upi')} selected={pay === 'upi'} onPress={() => setPay('upi')} /> : null}
      </View>

      <ErrorBox error={error} />
      <Button title={`${t('placeOrder')} · ${money(cart.totalPaise + fee)}`} onPress={placeOrder} loading={busy} disabled={!address} />
    </Screen>
  );
}

function Row({ label, value, bold }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: bold ? 17 : 15, fontWeight: bold ? '800' : '400' }}>{label}</Text>
      <Text style={{ fontSize: bold ? 17 : 15, fontWeight: bold ? '800' : '600' }}>{value}</Text>
    </View>
  );
}
