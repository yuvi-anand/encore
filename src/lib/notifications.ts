import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { Event, Artist } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Requests notification permission (and sets up the Android channel). */
export async function ensureNotificationPermission(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('encore-shows', {
      name: 'Upcoming Shows',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6C63FF',
    });
  }
  return finalStatus === 'granted';
}

/** Fires a local notification a couple seconds out to verify delivery works. */
export async function sendTestNotification(): Promise<boolean> {
  const granted = await ensureNotificationPermission();
  if (!granted) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Encore',
      body: 'Notifications are working — you’ll be alerted about new shows.',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
    },
  });
  return true;
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) {
      console.warn('Push notification permission not granted');
      return null;
    }

    // A projectId is required to fetch an Expo push token. In Expo Go
    // without an EAS project this will be undefined and push tokens are
    // unavailable — that's fine, local scheduled notifications still work.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) {
      console.warn('No EAS projectId — skipping push token registration.');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token;
  } catch (error) {
    console.error('registerForPushNotifications error:', error);
    return null;
  }
}

export async function savePushToken(userId: string, token: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', userId);
  } catch (error) {
    console.error('savePushToken error:', error);
  }
}

export async function scheduleEventNotification(
  event: Event,
  artist: Artist,
  daysBefore: number
): Promise<void> {
  try {
    const eventDate = new Date(event.event_date);
    const notifyDate = new Date(eventDate.getTime() - daysBefore * 24 * 60 * 60 * 1000);

    if (notifyDate <= new Date()) return;

    const body =
      daysBefore === 1
        ? `${artist.name} plays ${event.venue_name ?? 'a venue near you'} TOMORROW`
        : `${artist.name} plays ${event.venue_name ?? 'a venue near you'} in ${daysBefore} days`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Encore — ${artist.name}`,
        body,
        data: { eventId: event.id, artistId: artist.id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: notifyDate,
      },
    });
  } catch (error) {
    console.error('scheduleEventNotification error:', error);
  }
}

export async function scheduleEventReminders(
  event: Event,
  artist: Artist,
  options: { weekBefore: boolean; dayBefore: boolean }
): Promise<void> {
  if (options.weekBefore) {
    await scheduleEventNotification(event, artist, 7);
  }
  if (options.dayBefore) {
    await scheduleEventNotification(event, artist, 1);
  }
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Cancels existing reminders and reschedules them for all the given upcoming
 * events, based on the user's notification preferences. Call this whenever the
 * in-area events list changes.
 */
export async function syncEventReminders(
  events: (Event & { artist?: Artist })[],
  options: { weekBefore: boolean; dayBefore: boolean }
): Promise<number> {
  const granted = await ensureNotificationPermission();
  if (!granted) return 0;

  await Notifications.cancelAllScheduledNotificationsAsync();
  let scheduled = 0;
  for (const event of events) {
    if (!event.artist) continue;
    if (options.weekBefore) {
      await scheduleEventNotification(event, event.artist, 7);
      scheduled += 1;
    }
    if (options.dayBefore) {
      await scheduleEventNotification(event, event.artist, 1);
      scheduled += 1;
    }
  }
  return scheduled;
}
