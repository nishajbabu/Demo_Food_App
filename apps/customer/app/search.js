// Search results across shops near you.
import { Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useName } from '../src/i18n';
import { useData } from '../src/state';
import { Card, colors, Empty, ErrorBox, Loading, money, Muted, Screen } from '../src/ui';

export default function Search() {
  const { q } = useLocalSearchParams();
  const nameOf = useName();
  const { data, error, loading } = useData(`/search?q=${encodeURIComponent(q || '')}`);
  return (
    <Screen>
      <Stack.Screen options={{ title: `"${q}"` }} />
      {loading ? <Loading /> : null}
      <ErrorBox error={error} />
      {!loading && !(data || []).length ? <Empty text="Nothing found. Try another word." /> : null}
      {(data || []).map((p) => (
        <Card key={p.id} onPress={() => router.push(`/shop/${p.merchantId}`)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, flex: 1 }}>{nameOf(p)}</Text>
            <Text style={{ fontWeight: '800' }}>{money(p.pricePaise)}</Text>
          </View>
          <Muted>
            {p.unit} · {p.merchantName}
          </Muted>
          {!p.inStock || !p.isOpen ? <Text style={{ color: colors.red }}>Not available now</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}
