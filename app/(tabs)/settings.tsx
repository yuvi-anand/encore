import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';
import { CityChip } from '../../src/components/CityChip';
import { useSpotifyAuth, exchangeSpotifyCode, getLibraryArtists } from '../../src/lib/spotify';
import { geocodeCity } from '../../src/lib/geocode';
import { sendTestNotification } from '../../src/lib/notifications';
import { HomeCity } from '../../src/types';

const COLORS = {
  bg: '#000',
  section: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  border: '#1a1a1a',
  destructive: '#FF453A',
  spotify: '#1DB954',
};

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingsRow({
  label,
  right,
  onPress,
}: {
  label: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {right}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, profile, updateProfile } = useAuth();
  const { importArtists } = useArtists();
  const [cityInput, setCityInput] = useState('');
  const [connectingSpotify, setConnectingSpotify] = useState(false);

  const homeCities: HomeCity[] = profile?.home_cities ?? [];
  const radius = profile?.notification_radius_miles ?? 50;
  const notifyAnnouncements = profile?.notify_announcements ?? true;
  const notifyWeek = profile?.notify_week_before ?? true;
  const notifyDay = profile?.notify_day_before ?? true;

  const [addingCity, setAddingCity] = useState(false);

  const addCity = async () => {
    const trimmed = cityInput.trim();
    if (!trimmed) return;
    if (homeCities.length >= 3) {
      Alert.alert('Limit reached', 'You can add up to 3 home cities.');
      return;
    }
    setAddingCity(true);
    setCityInput('');
    const newCity = await geocodeCity(trimmed);
    await updateProfile({ home_cities: [...homeCities, newCity] });
    setAddingCity(false);
  };

  const removeCity = (index: number) => {
    const updated = homeCities.filter((_, i) => i !== index);
    updateProfile({ home_cities: updated });
  };

  const { request, response, promptAsync } = useSpotifyAuth();

  React.useEffect(() => {
    if (response?.type === 'success') {
      const code = (response as any).params?.code;
      const codeVerifier = request?.codeVerifier;
      if (code && codeVerifier) {
        exchangeSpotifyCode(code, codeVerifier).then(async (token) => {
          if (!token) {
            setConnectingSpotify(false);
            Alert.alert('Error', 'Could not connect to Spotify.');
            return;
          }
          await updateProfile({ spotify_token: token });
          // Pull the user's library and populate their artists.
          try {
            const library = await getLibraryArtists(token);
            const count = await importArtists(library, 'spotify');
            Alert.alert(
              'Spotify connected',
              count > 0
                ? `Imported ${count} artist${count === 1 ? '' : 's'} from your Spotify library.`
                : 'Connected, but we couldn’t find any artists to import.'
            );
          } catch (e) {
            console.error('Spotify import error:', e);
            Alert.alert('Connected', 'Spotify connected, but importing artists failed.');
          }
          setConnectingSpotify(false);
        });
      } else {
        setConnectingSpotify(false);
      }
    } else if (response?.type === 'error' || response?.type === 'dismiss') {
      setConnectingSpotify(false);
    }
  }, [response]);

  const handleConnectSpotify = async () => {
    setConnectingSpotify(true);
    await promptAsync();
  };

  const handleDisconnectSpotify = () => {
    Alert.alert(
      'Disconnect Spotify',
      'Your imported artists will stay, but we’ll stop syncing from Spotify.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => updateProfile({ spotify_token: null }),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        {/* Home Cities */}
        <SectionHeader title="Home Cities" />
        <View style={styles.section}>
          {homeCities.map((city, i) => (
            <View key={i} style={styles.cityRow}>
              <CityChip city={city} onRemove={() => removeCity(i)} />
            </View>
          ))}
          {homeCities.length < 3 && (
            <View style={styles.addCityRow}>
              <TextInput
                style={styles.cityInput}
                placeholder="Add a city..."
                placeholderTextColor="#444"
                value={cityInput}
                onChangeText={setCityInput}
                returnKeyType="done"
                onSubmitEditing={addCity}
              />
              <TouchableOpacity style={styles.addCityBtn} onPress={addCity} disabled={addingCity}>
                {addingCity ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.addCityBtnText}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.radiusRow}>
            <Text style={styles.radiusLabel}>Search radius</Text>
            <View style={styles.radiusSegments}>
              {[25, 50, 75, 100].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.radiusSegment, radius === v && styles.radiusSegmentActive]}
                  onPress={() => updateProfile({ notification_radius_miles: v })}
                >
                  <Text style={[styles.radiusSegmentText, radius === v && styles.radiusSegmentTextActive]}>
                    {v} mi
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Connected Accounts */}
        <SectionHeader title="Connected Accounts" />
        <View style={styles.section}>
          <SettingsRow
            label="Spotify"
            right={
              connectingSpotify ? (
                <ActivityIndicator color={COLORS.accent} size="small" />
              ) : profile?.spotify_token ? (
                <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnectSpotify}>
                  <Text style={styles.disconnectBtnText}>Disconnect</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.connectBtn, styles.spotifyBtn]} onPress={handleConnectSpotify}>
                  <Text style={styles.connectBtnText}>Connect</Text>
                </TouchableOpacity>
              )
            }
          />
          <View style={styles.separator} />
          <SettingsRow
            label="Apple Music"
            right={
              profile?.apple_music_token ? (
                <Text style={[styles.badge, styles.badgeRed]}>Connected</Text>
              ) : (
                <TouchableOpacity
                  style={[styles.connectBtn, styles.appleBtn]}
                  onPress={() => Alert.alert('Coming soon', 'Apple Music integration coming soon.')}
                >
                  <Text style={styles.connectBtnText}>Connect</Text>
                </TouchableOpacity>
              )
            }
          />
        </View>

        {/* Notifications */}
        <SectionHeader title="Notifications" />
        <View style={styles.section}>
          <SettingsRow
            label="Show announcements"
            right={
              <Switch
                value={notifyAnnouncements}
                onValueChange={(v) => updateProfile({ notify_announcements: v })}
                trackColor={{ false: '#333', true: COLORS.accent }}
                thumbColor="#fff"
              />
            }
          />
          <View style={styles.separator} />
          <SettingsRow
            label="1 week before"
            right={
              <Switch
                value={notifyWeek}
                onValueChange={(v) => updateProfile({ notify_week_before: v })}
                trackColor={{ false: '#333', true: COLORS.accent }}
                thumbColor="#fff"
              />
            }
          />
          <View style={styles.separator} />
          <SettingsRow
            label="1 day before"
            right={
              <Switch
                value={notifyDay}
                onValueChange={(v) => updateProfile({ notify_day_before: v })}
                trackColor={{ false: '#333', true: COLORS.accent }}
                thumbColor="#fff"
              />
            }
          />
          <View style={styles.separator} />
          <SettingsRow
            label="Send a test notification"
            onPress={async () => {
              const ok = await sendTestNotification();
              Alert.alert(
                ok ? 'Test sent' : 'Permission needed',
                ok
                  ? 'You should get a notification in a couple seconds. Background the app to see the banner.'
                  : 'Enable notifications for Encore in your device settings first.'
              );
            }}
            right={<Text style={styles.testLink}>Send</Text>}
          />
        </View>

        {/* Account */}
        <SectionHeader title="Account" />
        <View style={styles.section}>
          <SettingsRow
            label="Manage account"
            onPress={() => router.push('/account')}
            right={
              <View style={styles.manageRight}>
                <Text style={styles.emailText} numberOfLines={1}>
                  {user?.email ?? ''}
                </Text>
                <Feather name="chevron-right" size={18} color={COLORS.muted} />
              </View>
            }
          />
        </View>

        <View style={styles.bottom} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    paddingHorizontal: 16,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    paddingTop: 12,
    paddingBottom: 20,
    paddingHorizontal: 4,
  },
  sectionHeader: {
    color: COLORS.muted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
    paddingHorizontal: 4,
  },
  section: {
    backgroundColor: COLORS.section,
    borderRadius: 14,
    overflow: 'hidden',
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    minHeight: 50,
  },
  rowLabel: {
    color: COLORS.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    flex: 1,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
  },
  cityRow: {
    paddingVertical: 8,
  },
  addCityRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
  },
  cityInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  addCityBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCityBtnText: {
    color: COLORS.text,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  radiusRow: {
    paddingVertical: 12,
  },
  radiusLabel: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },
  radiusValue: {
    color: COLORS.text,
    fontFamily: 'Inter_600SemiBold',
  },
  radiusSegments: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  radiusSegment: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  radiusSegmentActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  radiusSegmentText: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  radiusSegmentTextActive: {
    color: COLORS.text,
  },
  badge: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeGreen: {
    backgroundColor: '#1a3a1f',
    color: '#1DB954',
  },
  badgeRed: {
    backgroundColor: '#3a1a1a',
    color: '#FF453A',
  },
  connectBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  spotifyBtn: {
    backgroundColor: '#1DB954',
  },
  appleBtn: {
    backgroundColor: '#FA243C',
  },
  connectBtnText: {
    color: COLORS.text,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  disconnectBtn: {
    backgroundColor: 'transparent',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#333',
  },
  disconnectBtnText: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  testLink: {
    color: COLORS.accent,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  emailText: {
    color: COLORS.muted,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    maxWidth: 170,
  },
  manageRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bottom: {
    height: 40,
  },
});
