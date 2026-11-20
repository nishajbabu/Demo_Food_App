// Send each partner to their own home screen.
import { Redirect } from 'expo-router';
import { useAuth } from '../src/state';
import { Loading } from '../src/ui';

export default function Index() {
  const { ready, user } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (user.role === 'merchant') return <Redirect href="/merchant" />;
  if (user.role === 'rider') return <Redirect href="/rider" />;
  if (user.role === 'driver') return <Redirect href="/driver" />;
  return <Redirect href="/login" />;
}
