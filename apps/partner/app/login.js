// Login with mobile number + SMS code.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, getServerUrl, setServerUrl } from '../src/api';
import { useAuth } from '../src/state';
import { Button, colors, ErrorBox, Field, H1, Muted, Screen } from '../src/ui';

export default function Login() {
  const { loginWithToken } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [devOtp, setDevOtp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showDev, setShowDev] = useState(false);
  const [server, setServer] = useState(getServerUrl());

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/request-otp', { method: 'POST', body: { phone } });
      setDevOtp(r.devOtp || null);
      setStep('otp');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/verify-otp', { method: 'POST', body: { phone, otp, app: 'partner' } });
      await loginWithToken(r.token, r.user);
      router.replace('/');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
      <Screen>
        <View style={{ marginTop: 32, gap: 6 }}>
          <Text style={{ fontSize: 40, fontWeight: '900', color: colors.green }}>GaonGo Partner</Text>
          <H1>Namaste! नमस्ते!</H1>
          <Muted>For shops, delivery riders and drivers.</Muted>
        </View>

        {step === 'phone' ? (
          <>
            <Field label="Mobile number" placeholder="10-digit number" keyboardType="phone-pad" maxLength={10} value={phone} onChangeText={setPhone} />
            <Button title="Send code" onPress={sendCode} loading={busy} disabled={phone.length !== 10} />
          </>
        ) : (
          <>
            <Muted>We sent a code to {phone}.</Muted>
            {devOtp ? (
              <View style={{ backgroundColor: colors.marigoldTint, padding: 12, borderRadius: 12 }}>
                <Text style={{ fontWeight: '700' }}>Test mode: your code is {devOtp}</Text>
              </View>
            ) : null}
            <Field label="Code from SMS" placeholder="6 digits" keyboardType="number-pad" maxLength={6} value={otp} onChangeText={setOtp} />
            <Button title="Log in" onPress={verify} loading={busy} disabled={otp.length < 4} />
            <Button title="Change number" kind="outline" onPress={() => setStep('phone')} />
          </>
        )}

        <ErrorBox error={error} />

        <Pressable onPress={() => setShowDev((s) => !s)} style={{ paddingVertical: 12 }}>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>Developer settings</Text>
        </Pressable>
        {showDev ? (
          <View style={{ gap: 8 }}>
            <Field label="Server address" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} />
            <Button
              title="Save server address"
              kind="outline"
              onPress={async () => {
                setServer(await setServerUrl(server));
                setShowDev(false);
              }}
            />
            <Muted>Leave empty and save to go back to the default.</Muted>
          </View>
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}
