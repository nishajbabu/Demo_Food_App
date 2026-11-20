// First screen: decide where to go (login, fill in details, or home).
import { Redirect } from 'expo-router';
import { useAuth } from '../src/state';
import { Loading } from '../src/ui';

export default function Index() {
  const { ready, user } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (!user.name || !user.villageId || !user.landmark) return <Redirect href="/profile" />;
  return <Redirect href="/home" />;
}
