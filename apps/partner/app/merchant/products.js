// Shop items: switch stock on/off, change price, add new items.
import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../../src/api';
import { useData, useT } from '../../src/state';
import { Button, Card, colors, ErrorBox, Field, H2, Loading, money, Muted, Pill, Screen } from '../../src/ui';

export default function Products() {
  const t = useT();
  const { data, error, loading, reload, setData } = useData('/merchant/products');
  const [editing, setEditing] = useState(null); // product id whose price is being edited
  const [price, setPrice] = useState('');
  const [form, setForm] = useState({ name: '', nameTa: '', nameHi: '', unit: '', price: '', category: '', isSubscribable: false });
  const [saving, setSaving] = useState(false);

  async function update(p, body) {
    try {
      const updated = await api(`/merchant/products/${p.id}`, { method: 'PATCH', body });
      setData((list) => list.map((x) => (x.id === p.id ? updated : x)));
    } catch (e) {
      Alert.alert('Could not save', e.message);
    }
  }

  async function add() {
    setSaving(true);
    try {
      await api('/merchant/products', {
        method: 'POST',
        body: {
          name: form.name,
          nameTa: form.nameTa || undefined,
          nameHi: form.nameHi || undefined,
          unit: form.unit || 'piece',
          category: form.category || undefined,
          pricePaise: Math.round(parseFloat(form.price) * 100),
          isSubscribable: form.isSubscribable,
        },
      });
      setForm({ name: '', nameTa: '', nameHi: '', unit: '', price: '', category: '', isSubscribable: false });
      reload();
    } catch (e) {
      Alert.alert('Could not add', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('products') }} />
      {loading ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {(data || []).map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>{p.name}</Text>
              <Muted>
                {p.unit} · {money(p.pricePaise)}
                {p.isSubscribable ? ' · subscription' : ''}
              </Muted>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Switch value={p.inStock} onValueChange={(v) => update(p, { inStock: v })} trackColor={{ true: colors.green }} />
              <Text style={{ fontSize: 11, color: colors.muted }}>{p.inStock ? 'In stock' : 'Out'}</Text>
            </View>
          </View>
          {editing === p.id ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Field label="New price (₹)" keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
              </View>
              <Button
                title="Save"
                onPress={async () => {
                  await update(p, { pricePaise: Math.round(parseFloat(price) * 100) });
                  setEditing(null);
                }}
                disabled={!(parseFloat(price) >= 0)}
              />
            </View>
          ) : (
            <Text
              style={{ color: colors.green, fontWeight: '700' }}
              onPress={() => {
                setEditing(p.id);
                setPrice(String(p.pricePaise / 100));
              }}
            >
              Change price
            </Text>
          )}
        </Card>
      ))}

      <H2>Add a new item</H2>
      <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="e.g. Besan" />
      <Field label="Name in Tamil (optional)" value={form.nameTa} onChangeText={(v) => setForm({ ...form, nameTa: v })} />
      <Field label="Name in Hindi (optional)" value={form.nameHi} onChangeText={(v) => setForm({ ...form, nameHi: v })} />
      <Field label="Pack size / unit" value={form.unit} onChangeText={(v) => setForm({ ...form, unit: v })} placeholder="500 g, 1 kg, plate, litre" />
      <Field label="Category" value={form.category} onChangeText={(v) => setForm({ ...form, category: v })} placeholder="Dal, Snacks, Milk…" />
      <Field label="Price (₹)" keyboardType="decimal-pad" value={form.price} onChangeText={(v) => setForm({ ...form, price: v })} />
      <Pill label="Can be subscribed (daily/weekly)" selected={form.isSubscribable} onPress={() => setForm({ ...form, isSubscribable: !form.isSubscribable })} />
      <Button title="Add item" onPress={add} loading={saving} disabled={!form.name || !(parseFloat(form.price) >= 0)} />
    </Screen>
  );
}
