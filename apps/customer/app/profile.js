// Name, village and landmark (village homes rarely have street addresses).
import { useContext, useState } from 'react';
import { Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { api } from '../src/api';
import { LangContext, useT } from '../src/i18n';
import { useAuth, useData } from '../src/state';
import { Button, colors, ErrorBox, Field, H2, Loading, Muted, Pill, Screen } from '../src/ui';

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const { lang, setLang } = useContext(LangContext);
  const t = useT();
  const villages = useData('/villages');
  const [name, setName] = useState(user?.name || '');
  const [villageId, setVillageId] = useState(user?.villageId || null);
  const [landmark, setLandmark] = useState(user?.landmark || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/me', { method: 'PATCH', body: { name, villageId, landmark } });
      setUser(r.user);
      router.replace('/home');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t('profile') }} />
      <Muted>Phone: {user?.phone}</Muted>
      <Field label="Your name" value={name} onChangeText={setName} placeholder="e.g. Kavita" />
      <H2>Your village</H2>
      {villages.loading ? <Loading /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(villages.data || []).map((v) => (
          <Pill key={v.id} label={v.name} selected={v.id === villageId} onPress={() => setVillageId(v.id)} />
        ))}
      </View>
      <Field
        label="Landmark / house details"
        value={landmark}
        onChangeText={setLandmark}
        placeholder="House 23, blue gate opposite the hand pump"
        multiline
      />
      <Muted>Riders use this to find your home, and will call you when they are close.</Muted>
      <ErrorBox error={error || villages.error} />
      <Button title="Save" onPress={save} loading={busy} disabled={!name || !villageId || !landmark} />
      <H2>{t('language')}</H2>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill label="English" selected={lang === 'en'} onPress={() => setLang('en')} />
        <Pill label="தமிழ்" selected={lang === 'ta'} onPress={() => setLang('ta')} />
        <Pill label="हिंदी" selected={lang === 'hi'} onPress={() => setLang('hi')} />
      </View>
      <Button
        title={t('logout')}
        kind="danger"
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      />
      <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>GaonGo v0.1</Text>
    </Screen>
  );
}
