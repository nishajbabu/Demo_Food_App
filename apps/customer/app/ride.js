// Rides: private ride (bike / auto / e-rickshaw / cab) or a seat in a share auto.
import { useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../src/api';
import { useT } from '../src/i18n';
import { useData } from '../src/state';
import { STATUS_TEXT } from '../src/components';
import { Button, Card, colors, ErrorBox, H1, H2, Loading, money, Muted, Pill, Screen } from '../src/ui';

export default function Ride() {
  const t = useT();
  const places = useData('/places');
  const mine = useData('/rides/mine', { pollMs: 6000 });
  const trips = useData('/share/trips', { pollMs: 20000 });
  const [mode, setMode] = useState('private');
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [pay, setPay] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const active = (mine.data?.rides || []).find((r) => ['requested', 'accepted', 'started'].includes(r.status));
  const activeRide = useData(active ? `/rides/${active.id}` : null, { pollMs: 5000, enabled: Boolean(active) });

  useEffect(() => {
    setEstimate(null);
    setVehicle(null);
    if (!from || !to || from === to) return;
    api(`/rides/estimate?pickupPlaceId=${from}&dropPlaceId=${to}`)
      .then(setEstimate)
      .catch(setError);
  }, [from, to]);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      await api('/rides', { method: 'POST', body: { vehicleType: vehicle, pickupPlaceId: from, dropPlaceId: to, paymentMethod: pay } });
      await mine.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function action(path, confirm) {
    const go = async () => {
      try {
        const r = await api(path, { method: 'POST' });
        if (r.message) Alert.alert('GaonGo', r.message);
        await mine.reload();
        await activeRide.reload();
      } catch (e) {
        Alert.alert('Error', e.message);
      }
    };
    if (confirm) Alert.alert(confirm, '', [{ text: 'No', style: 'cancel' }, { text: 'Yes', onPress: go }]);
    else go();
  }

  async function bookSeats(trip, seats) {
    try {
      await api(`/share/trips/${trip.id}/book`, { method: 'POST', body: { seats, paymentMethod: 'cash' } });
      Alert.alert('Seat booked', `${seats} seat(s) on ${trip.routeName}. Pay ${money(seats * trip.farePerSeatPaise)} to the driver.`);
      trips.reload();
      mine.reload();
    } catch (e) {
      Alert.alert('Could not book', e.message);
    }
  }

  const r = activeRide.data;
  if (active && r) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('ride') }} />
        <H1>{STATUS_TEXT[r.status]}</H1>
        <Muted>
          {r.pickupName} → {r.dropName} · {r.distanceKm} km · {money(r.farePaise)}
        </Muted>
        {r.driverName ? (
          <Card>
            <Text style={{ fontSize: 17, fontWeight: '800' }}>
              {r.driverName} · {r.vehicleLabel}
            </Text>
            <Muted>{r.vehicleNo}</Muted>
            <Button title="Call driver" kind="outline" onPress={() => Linking.openURL(`tel:${r.driverPhone}`)} />
          </Card>
        ) : (
          <Muted>Waiting for a driver to accept…</Muted>
        )}
        {r.status !== 'started' ? (
          <Card style={{ backgroundColor: colors.marigoldTint, borderWidth: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ flex: 1 }}>Tell the driver this code when you get in</Text>
            <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 4 }}>{r.rideOtp}</Text>
          </Card>
        ) : null}
        <Button title="SOS – I need help" kind="danger" onPress={() => action(`/rides/${r.id}/sos`, 'Send an SOS to the GaonGo team?')} />
        {['requested', 'accepted'].includes(r.status) ? (
          <Button title="Cancel ride" kind="outline" onPress={() => action(`/rides/${r.id}/cancel`, 'Cancel this ride?')} />
        ) : null}
      </Screen>
    );
  }

  const placeList = places.data || [];
  return (
    <Screen>
      <Stack.Screen options={{ title: t('ride') }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill label="Book a ride" selected={mode === 'private'} onPress={() => setMode('private')} />
        <Pill label="Share auto seat" selected={mode === 'share'} onPress={() => setMode('share')} />
      </View>
      {places.loading ? <Loading /> : null}
      <ErrorBox error={error || places.error} />

      {mode === 'private' ? (
        <>
          <H2>From</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {placeList.map((p) => (
              <Pill key={p.id} label={p.name} selected={from === p.id} onPress={() => setFrom(p.id)} />
            ))}
          </View>
          <H2>To</H2>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {placeList.filter((p) => p.id !== from).map((p) => (
              <Pill key={p.id} label={p.name} selected={to === p.id} onPress={() => setTo(p.id)} />
            ))}
          </View>

          {estimate ? (
            <>
              <Muted>About {estimate.distanceKm} km</Muted>
              {estimate.options.map((o) => (
                <Card key={o.vehicleType} onPress={() => setVehicle(o.vehicleType)} style={{ borderWidth: 2, borderColor: vehicle === o.vehicleType ? colors.green : colors.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: '800' }}>{o.label}</Text>
                    <Muted>
                      Up to {o.seats} · {o.driversOnline ? `${o.driversOnline} nearby` : 'no driver online now'}
                    </Muted>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: '800' }}>{money(o.farePaise)}</Text>
                </Card>
              ))}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pill label="Pay cash" selected={pay === 'cash'} onPress={() => setPay('cash')} />
                <Pill label="Pay UPI to driver" selected={pay === 'upi'} onPress={() => setPay('upi')} />
              </View>
              <Button title="Book ride" onPress={book} loading={busy} disabled={!vehicle} />
            </>
          ) : null}
        </>
      ) : (
        <>
          <Muted>Share autos run fixed routes at fixed times. Book a seat and pay the driver.</Muted>
          {(trips.data || []).map((trip) => (
            <Card key={trip.id}>
              <Text style={{ fontSize: 16, fontWeight: '800' }}>{trip.routeName}</Text>
              <Muted>
                Leaves {new Date(trip.departsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {trip.driverName} · {money(trip.farePerSeatPaise)}/seat
              </Muted>
              <Text style={{ fontWeight: '700', color: trip.seatsFree ? colors.green : colors.red }}>
                {trip.seatsFree ? `${trip.seatsFree} seats free` : 'Full'}
              </Text>
              {trip.seatsFree ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[1, 2, 3].filter((n) => n <= trip.seatsFree).map((n) => (
                    <Pill key={n} label={`Book ${n}`} onPress={() => bookSeats(trip, n)} />
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
          {(mine.data?.shareBookings || []).filter((b) => b.status === 'booked' && b.tripStatus === 'scheduled').length ? (
            <>
              <H2>My seats</H2>
              {mine.data.shareBookings
                .filter((b) => b.status === 'booked' && b.tripStatus === 'scheduled')
                .map((b) => (
                  <Card key={b.id}>
                    <Text style={{ fontWeight: '800' }}>
                      {b.routeName} · {b.seats} seat(s)
                    </Text>
                    <Muted>
                      {new Date(b.departsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {b.driverName} · pay {money(b.farePaise)}
                    </Muted>
                    <Button title="Call driver" kind="outline" onPress={() => Linking.openURL(`tel:${b.driverPhone}`)} />
                  </Card>
                ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
