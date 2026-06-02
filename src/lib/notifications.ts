import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { Event, Artist } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('encore-shows', {
        name: 'Upcoming Shows',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6C63FF',
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
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
