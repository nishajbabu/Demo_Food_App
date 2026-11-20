// Partner help: call the ops team or raise a ticket (payout problems, app issues...).
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { api } from '../src/api';
import { useAuth, useData } from '../src/state';
import { Button, Card, colors, ErrorBox, Field, H2, Muted, Screen } from '../src/ui';

export default function Help() {
  const { config } = useAuth();
  const support = config?.support || {};
  const tickets = useData('/support/tickets/mine', { pollMs: 20000 });
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api('/support/tickets', { method: 'POST', body: { subject, message, category: 'partner' } });
      setSubject('');
      setMessage('');
      tickets.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen style={{ backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Help' }} />
      {support.phone ? <Button title={`Call GaonGo team · ${support.phone}`} onPress={() => Linking.openURL(`tel:${support.phone}`)} /> : null}
      <H2>Write to us</H2>
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="Payout not received" />
      <Field label="Details" value={message} onChangeText={setMessage} multiline />
      <ErrorBox error={error} />
      <Button title="Send" onPress={send} loading={busy} disabled={subject.length < 3 || !message} />
      <H2>My requests</H2>
      {(tickets.data || []).map((tk) => (
        <Card
          key={tk.id}
          onPress={async () => setOpen(open?.id === tk.id ? null : await api(`/support/tickets/${tk.id}`))}
        >
          <Text style={{ fontWeight: '800' }}>{tk.subject}</Text>
          <Muted>{tk.status === 'open' ? 'Open' : 'Solved'}</Muted>
          {open?.id === tk.id
            ? open.messages.map((m) => (
                <View key={m.id} style={{ backgroundColor: m.isStaff ? colors.greenTint : colors.bg, padding: 10, borderRadius: 10 }}>
                  <Muted>{m.isStaff ? 'GaonGo team' : 'You'}</Muted>
                  <Text>{m.body}</Text>
                </View>
              ))
            : null}
        </Card>
      ))}
    </Screen>
  );
}
