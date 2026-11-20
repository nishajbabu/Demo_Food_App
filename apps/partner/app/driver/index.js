// Driver: daily pass, go online, accept ride requests, run share-auto trips.
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { call, Header, Toggle, useLocationUpdates, useNewItemAlert } from '../../src/common';
import { useData, useT } from '../../src/state';
import { Button, Card, colors, Empty, ErrorBox, Field, H2, Loading, money, Muted, Pill, Screen } from '../../src/ui';

export default function DriverHome() {
  const t = useT();
  const req = useData('/driver/requests', { pollMs: 5000 });
  const trips = useData('/driver/share-trips', { pollMs: 15000 });
  const routes = useData('/driver/routes');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [newTrip, setNewTrip] = useState({ routeId: null, minutes: 30 });
  const d = req.data;

  useLocationUpdates(Boolean(d?.online), '/driver/status');
  useNewItemAlert(d?.online && !d.current ? (d.requests || []).map((r) => r.id) : null, 'New ride request!');

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await req.reload();
      await trips.reload();
    } catch (e) {
      Alert.alert('GaonGo', e.message);
    } finally {
      setBusy(false);
    }
  }

  const post = (path, body) => run(() => api(path, { method: 'POST', body }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1F2933' }} edges={['top']}>
      <Header
        title={d ? `${d.vehicleType === 'auto' ? 'Auto' : d.vehicleType === 'cab' ? 'Cab' : d.vehicleType === 'erick' ? 'E-rickshaw' : 'Bike'} · ${d.vehicleNo || ''}` : 'Driver'}
        subtitle="GaonGo Partner · Driver"
        right={d ? <Toggle on={d.online} onPress={() => run(() => api('/driver/status', { method: 'PATCH', body: { online: !d.online } }))} onLabel={t('online')} offLabel={t('offline')} /> : null}
      />
      <Screen style={{ backgroundColor: colors.bg }}>
        {req.loading ? <Loading /> : null}
        <ErrorBox error={req.error} onRetry={req.reload} />

        {d ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stat label="Earned today" value={money(d.earnedTodayPaise)} />
              <Stat label="Trips" value={String(d.tripsToday)} />
            </View>
            <Card style={{ backgroundColor: d.passActive ? colors.marigoldTint : colors.white }}>
              <Text style={{ fontWeight: '800', fontSize: 16 }}>{d.passActive ? 'Daily pass active · zero commission' : 'No pass for today'}</Text>
              <Muted>Pay a flat {money(d.passPricePaise)} a day and keep 100% of every fare.</Muted>
              {!d.passActive ? <Button title={`Buy today's pass · ${money(d.passPricePaise)}`} onPress={() => post('/driver/pass')} loading={busy} /> : null}
            </Card>
          </>
        ) : null}

        {d?.current ? (
          <Card style={{ borderWidth: 2, borderColor: colors.green, gap: 10 }}>
            <Text style={{ fontWeight: '900', fontSize: 17 }}>
              {d.current.status === 'accepted' ? 'Go to pickup' : 'Ride in progress'} · {money(d.current.farePaise)}
            </Text>
            <Text style={{ fontSize: 16 }}>
              {d.current.pickupName} → {d.current.dropName} ({d.current.distanceKm} km)
            </Text>
            <Muted>{d.current.paymentMethod === 'cash' ? 'Collect cash at drop' : 'Customer pays you by UPI'}</Muted>
            {d.current.status === 'accepted' ? (
              <>
                <Field label="Customer's 4-digit ride code" keyboardType="number-pad" maxLength={4} value={otp} onChangeText={setOtp} />
                <Button title="Start ride" disabled={otp.length !== 4} loading={busy} onPress={() => post(`/driver/rides/${d.current.id}/start`, { otp }).then(() => setOtp(''))} />
                <Button title="Give ride back" kind="danger" onPress={() => post(`/driver/rides/${d.current.id}/cancel`)} />
              </>
            ) : (
              <Button title="Complete ride" loading={busy} onPress={() => post(`/driver/rides/${d.current.id}/complete`)} />
            )}
          </Card>
        ) : null}

        {d?.online && !d.current ? (
          <>
            <H2>Ride requests</H2>
            {!d.requests?.length ? <Empty text="No requests right now." /> : null}
            {(d.requests || []).map((r) => (
              <Card key={r.id} style={{ borderWidth: 2, borderColor: colors.marigold }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '800', fontSize: 16, flex: 1 }}>
                    {r.pickupName} → {r.dropName}
                  </Text>
                  <Text style={{ fontWeight: '900', fontSize: 18, color: colors.greenDark }}>{money(r.farePaise)}</Text>
                </View>
                <Muted>
                  {r.distanceKm} km · {r.customerName || 'Customer'} · {r.paymentMethod}
                </Muted>
                <Button title={t('accept')} loading={busy} onPress={() => post(`/driver/rides/${r.id}/accept`)} />
              </Card>
            ))}
          </>
        ) : null}

        <H2>Share-auto trips</H2>
        {(trips.data || []).map((trip) => (
          <Card key={trip.id} style={{ gap: 8 }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{trip.routeName}</Text>
            <Muted>
              {new Date(trip.departsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {trip.status} · {money(trip.farePerSeatPaise)}/seat
            </Muted>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {Array.from({ length: trip.seatsTotal }).map((_, i) => {
                const kind = i < trip.seatsBooked ? 'app' : i < trip.seatsBooked + trip.walkins ? 'walk' : 'free';
                return (
                  <View
                    key={i}
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: 1.5,
                      borderColor: kind === 'app' ? colors.green : kind === 'walk' ? colors.brown : colors.line,
                      backgroundColor: kind === 'app' ? colors.greenTint : kind === 'walk' ? colors.marigoldTint : colors.white,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800' }}>{kind === 'app' ? 'App' : kind === 'walk' ? 'Walk-in' : 'Free'}</Text>
                  </View>
                );
              })}
            </View>
            {trip.bookings.map((b) => (
              <Text key={b.id} onPress={() => call(b.customerPhone)}>
                {b.customerName || b.customerPhone} · {b.seats} seat(s) · {b.paymentMethod} {money(b.farePaise)} · tap to call
              </Text>
            ))}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="− Walk-in" kind="outline" style={{ flex: 1 }} onPress={() => post(`/driver/share-trips/${trip.id}/walkins`, { delta: -1 })} />
              <Button title="+ Walk-in" kind="outline" style={{ flex: 1 }} onPress={() => post(`/driver/share-trips/${trip.id}/walkins`, { delta: 1 })} />
            </View>
            {trip.status === 'scheduled' ? <Button title="Start trip" onPress={() => post(`/driver/share-trips/${trip.id}/start`)} /> : null}
            {trip.status === 'started' ? <Button title="Complete trip" onPress={() => post(`/driver/share-trips/${trip.id}/complete`)} /> : null}
          </Card>
        ))}

        <Card>
          <Text style={{ fontWeight: '800' }}>Add a departure</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(routes.data || []).map((r) => (
              <Pill key={r.id} label={r.name} selected={newTrip.routeId === r.id} onPress={() => setNewTrip({ ...newTrip, routeId: r.id })} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[15, 30, 60, 120].map((m) => (
              <Pill key={m} label={`In ${m} min`} selected={newTrip.minutes === m} onPress={() => setNewTrip({ ...newTrip, minutes: m })} />
            ))}
          </View>
          <Button
            title="Add departure"
            disabled={!newTrip.routeId}
            loading={busy}
            onPress={() =>
              post('/driver/share-trips', {
                routeId: newTrip.routeId,
                departsAt: new Date(Date.now() + newTrip.minutes * 60000).toISOString(),
                seatsTotal: 6,
              })
            }
          />
        </Card>
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
