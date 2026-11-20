// Registers the device for push notifications on Android/iOS (safely skipped in browser).
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { api, store } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPushToken() {
  if (Platform.OS === 'web') return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Orders & Rides',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        sound: 'default',
      });
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const pushToken = tokenRes?.data;
    if (!pushToken) return;

    await store.set('pushToken', pushToken);
    await api('/auth/push-token', { method: 'POST', body: { token: pushToken } });
  } catch {
    // Ignore on emulators / Expo Go without EAS projectId; works in EAS builds.
  }
}

export async function unregisterPushToken() {
  if (Platform.OS === 'web') return;
  try {
    const pushToken = await store.get('pushToken');
    if (pushToken) {
      await api('/auth/push-token', { method: 'DELETE', body: { token: pushToken } }).catch(() => {});
      await store.del('pushToken');
    }
  } catch {
    // ignore
  }
}