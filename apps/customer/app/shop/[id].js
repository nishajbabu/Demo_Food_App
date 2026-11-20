// One shop's menu / items. Add to cart from here.
import { Alert, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useName, useT } from '../../src/i18n';
import { useCart, useData } from '../../src/state';
import { CartBar, VegMark } from '../../src/components';
import { colors, ErrorBox, H2, Loading, money, Muted, Screen, Stepper } from '../../src/ui';

export default function Shop() {
  const { id } = useLocalSearchParams();
  const t = useT();
  const nameOf = useName();
  const cart = useCart();
  const { data: shop, error, loading, reload } = useData(`/merchants/${id}`);

  function add(product) {
    const merchant = { id: shop.id, name: shop.name, type: shop.type };
    if (cart.merchant && cart.merchant.id !== shop.id && cart.count > 0) {
      Alert.alert('Start a new cart?', `Your cart has items from ${cart.merchant.name}. One order comes from one shop.`, [
        { text: 'Keep old cart', style: 'cancel' },
        { text: 'Start new', onPress: () => cart.add(merchant, product) },
      ]);
      return;
    }
    cart.add(merchant, product);
  }

  const groups = {};
  for (const p of shop?.products || []) (groups[p.category || 'Items'] ||= []).push(p);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: shop?.name || '' }} />
      <Screen>
        {loading ? <Loading /> : null}
        <ErrorBox error={error} onRetry={reload} />
        {shop ? (
          <View style={{ gap: 4 }}>
            {shop.description ? <Muted>{shop.description}</Muted> : null}
            <Muted>
              {shop.villageName}
              {shop.landmark ? ` · ${shop.landmark}` : ''}
            </Muted>
            {!shop.isOpen ? <Text style={{ color: colors.red, fontWeight: '800' }}>{t('closed')}</Text> : null}
          </View>
        ) : null}
        {Object.entries(groups).map(([category, products]) => (
          <View key={category} style={{ gap: 2 }}>
            <H2 style={{ marginTop: 8 }}>{category}</H2>
            {products.map((p) => (
              <View key={p.id} style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEF1EE', alignItems: 'center' }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <VegMark isVeg={p.isVeg} />
                  <Text style={{ fontSize: 16, fontWeight: '700' }}>{nameOf(p)}</Text>
                  <Muted>{[p.unit, p.description].filter(Boolean).join(' · ')}</Muted>
                  <Text style={{ fontSize: 15, fontWeight: '800' }}>{money(p.pricePaise)}</Text>
                </View>
                {p.inStock && shop.isOpen ? (
                  <Stepper qty={cart.merchant?.id === shop.id ? cart.qtyOf(p.id) : 0} onAdd={() => add(p)} onRemove={() => cart.remove(p)} addLabel={t('add')} />
                ) : (
                  <Muted>{p.inStock ? '' : 'Out of stock'}</Muted>
                )}
              </View>
            ))}
          </View>
        ))}
      </Screen>
      <CartBar />
    </View>
  );
}
