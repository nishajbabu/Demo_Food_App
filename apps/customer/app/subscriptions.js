// My milk / curd / sabzi subscriptions: skip days, pause, resume.
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '../src/api';
import { useT } from '../src/i18n';
import { useData } from '../src/state';
import { Button, Card, colors, Empty, ErrorBox, Loading, money, Muted, Screen } from '../src/ui';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQ = { daily: 'Every day', alternate: 'Alternate days', weekly: 'Once a week' };

export default function Subscriptions() {
  const t = useT();
  const { data, error, loading, reload, setData } = useData('/subscriptions/mine');
  const [busyId, setBusyId] = useState(null);

  async function change(sub, path, body, method = 'POST') {
    setBusyId(sub.id);
    try {
      const updated = await api(path, { method, body });
      setData((list) => list.map((s) => (s.id === sub.id ? updated : s)).filter((s) => s.status !== 'cancelled'));
    } catch (e) {
      Alert.alert('Could not change', e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('subscriptions') }} />
      <Button title={t('newSubscription')} onPress={() => router.push('/subscribe')} />
      {loading ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {!loading && !(data || []).length ? <Empty text="No subscriptions yet. Start one for fresh milk every morning." /> : null}

      {(data || []).map((s) => (
        <Card key={s.id} style={{ gap: 10 }}>
          <View>
            <Text style={{ fontSize: 17, fontWeight: '800' }}>
              {s.productName} · {s.qty} {s.unit}
            </Text>
            <Muted>
              {s.merchantName} · {FREQ[s.frequency]} · {s.slot === 'morning' ? 'Morning 6–7 AM' : 'Evening 5–6 PM'}
            </Muted>
            <Muted>
              This month: {s.thisMonth.deliveredCount} deliveries · {money(s.thisMonth.deliveredPaise)}
            </Muted>
          </View>

          {s.status === 'active' ? (
            <>
              <Muted>{t('skipHint')}</Muted>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {s.days.map((d) => {
                  const locked = d.date < s.earliestChangeDate;
                  const bg = !d.delivery ? colors.white : d.skipped ? '#EEF1EE' : colors.greenTint;
                  const border = !d.delivery ? colors.line : d.skipped ? '#B8BFBA' : colors.green;
                  return (
                    <Pressable
                      key={d.date}
                      disabled={!d.delivery || locked || busyId === s.id}
                      onPress={() => change(s, `/subscriptions/${s.id}/skip`, { date: d.date, skip: !d.skipped })}
                      accessibilityLabel={`${d.date}: ${!d.delivery ? 'no delivery' : d.skipped ? 'skipped' : 'delivery'}`}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 10, borderWidth: 1.5, borderColor: border, backgroundColor: bg, opacity: locked ? 0.6 : 1 }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '600' }}>{DOW[new Date(`${d.date}T00:00:00`).getDay()]}</Text>
                      <Text style={{ fontSize: 16, fontWeight: '800' }}>{Number(d.date.slice(8))}</Text>
                      <Text style={{ fontSize: 10, fontWeight: '700' }}>{!d.delivery ? '–' : d.skipped ? 'Skip' : 'On'}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Muted>Changes for tomorrow close at 9 PM tonight.</Muted>
              <Button title="Pause" kind="outline" loading={busyId === s.id} onPress={() => change(s, `/subscriptions/${s.id}`, { status: 'paused' }, 'PATCH')} />
            </>
          ) : (
            <>
              <Text style={{ fontWeight: '700', color: colors.brown }}>Paused</Text>
              <Button title="Resume" loading={busyId === s.id} onPress={() => change(s, `/subscriptions/${s.id}`, { status: 'active' }, 'PATCH')} />
            </>
          )}
          <Text
            style={{ color: colors.red, textAlign: 'center', paddingVertical: 8 }}
            onPress={() =>
              Alert.alert('Stop this subscription?', '', [
                { text: 'No', style: 'cancel' },
                { text: 'Stop', style: 'destructive', onPress: () => change(s, `/subscriptions/${s.id}`, { status: 'cancelled' }, 'PATCH') },
              ])
            }
          >
            Stop subscription
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
