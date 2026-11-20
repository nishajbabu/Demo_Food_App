// Help: call or WhatsApp support, or raise a ticket and see replies.
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api } from '../src/api';
import { useT } from '../src/i18n';
import { useConfig, useData } from '../src/state';
import { Button, Card, colors, ErrorBox, Field, H2, Muted, Screen } from '../src/ui';

export default function Help() {
  const t = useT();
  const { orderId } = useLocalSearchParams();
  const { config } = useConfig();
  const support = config?.support || {};
  const tickets = useData('/support/tickets/mine', { pollMs: 20000 });
  const [subject, setSubject] = useState(orderId ? `Problem with order GG-${orderId}` : '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api('/support/tickets', {
        method: 'POST',
        body: { subject, message, category: orderId ? 'order' : 'other', orderId: orderId ? Number(orderId) : undefined },
      });
      setMessage('');
      tickets.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id) {
    if (open?.id === id) return setOpen(null);
    try {
      setOpen(await api(`/support/tickets/${id}`));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('help') }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {support.phone ? <Button title="Call us" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${support.phone}`)} /> : null}
        {support.whatsapp ? <Button title="WhatsApp" kind="outline" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://wa.me/91${support.whatsapp}`)} /> : null}
      </View>

      <H2>Write to us</H2>
      <Field label="What is the problem?" value={subject} onChangeText={setSubject} />
      <Field label="Details" value={message} onChangeText={setMessage} multiline placeholder="Tell us what happened" />
      <ErrorBox error={error} />
      <Button title="Send" onPress={send} loading={busy} disabled={subject.length < 3 || !message} />

      <H2>My requests</H2>
      {(tickets.data || []).map((tk) => (
        <Card key={tk.id} onPress={() => toggle(tk.id)}>
          <Text style={{ fontWeight: '800' }}>{tk.subject}</Text>
          <Text style={{ color: tk.status === 'open' ? colors.brown : colors.green, fontWeight: '700' }}>
            {tk.status === 'open' ? 'Open' : 'Solved'}
          </Text>
          {open?.id === tk.id
            ? open.messages.map((m) => (
                <View key={m.id} style={{ backgroundColor: m.isStaff ? colors.greenTint : colors.bg, padding: 10, borderRadius: 10 }}>
                  <Muted>{m.isStaff ? 'GaonGo support' : 'You'}</Muted>
                  <Text>{m.body}</Text>
                </View>
              ))
            : null}
        </Card>
      ))}
    </Screen>
  );
}
