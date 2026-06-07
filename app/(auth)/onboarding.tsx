import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { router } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';
import { useSpotifyAuth, exchangeSpotifyCode, getLibraryArtists } from '../../src/lib/spotify';
import { ArtistCard } from '../../src/components/ArtistCard';
import { CityChip } from '../../src/components/CityChip';
import { geocodeCity } from '../../src/lib/geocode';
import { Artist, HomeCity } from '../../src/types';

const COLORS = {
  bg: '#000',
  card: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  spotify: '#1DB954',
  border: '#222',
};

const TOTAL_STEPS = 3;

export default function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const [spotifyToken, setSpotifyToken] = useState<string | null>(null);
  const [spotifyConnecting, setSpotifyConnecting] = useState(false);
  const [topArtists, setTopArtists] = useState<Partial<Artist>[]>([]);
  const [selectedArtistIds, setSelectedArtistIds] = useState<Set<string>>(new Set());
  const [cityInput, setCityInput] = useState('');
  const [homeCities, setHomeCities] = useState<HomeCity[]>([]);
  const [saving, setSaving] = useState(false);

  const { updateProfile } = useAuth();
  const { importArtists } = useArtists();
  const { request, response, promptAsync } = useSpotifyAuth();

  // Handle Spotify auth response
  React.useEffect(() => {
    if (response?.type === 'success') {
      const code = (response as any).params?.code;
      const codeVerifier = request?.codeVerifier;
      if (code && codeVerifier) {
        exchangeSpotifyCode(code, codeVerifier).then((tokens) => {
          if (tokens) {
            setSpotifyToken(tokens.accessToken);
            updateProfile({
              spotify_token: tokens.accessToken,
              spotify_refresh_token: tokens.refreshToken,
            });
            getLibraryArtists(tokens.accessToken).then((artists) => {
              setTopArtists(artists);
              const ids = new Set(artists.map((a, i) => a.spotify_id ?? String(i)));
              setSelectedArtistIds(ids);
              setSpotifyConnecting(false);
            });
          } else {
            setSpotifyConnecting(false);
            Alert.alert('Connection failed', 'Could not get Spotify token. Please try again.');
          }
        });
      }
    } else if (response?.type === 'error' || response?.type === 'dismiss') {
      setSpotifyConnecting(false);
      if (response?.type === 'error') {
        Alert.alert('Connection failed', 'Could not connect to Spotify. Please try again.');
      }
    }
  }, [response]);

  const handleSpotifyConnect = async () => {
    setSpotifyConnecting(true);
    await promptAsync();
  };

  const toggleArtist = (key: string) => {
    setSelectedArtistIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addCity = async () => {
    const trimmed = cityInput.trim();
    if (!trimmed) return;
    if (homeCities.length >= 3) {
      Alert.alert('Limit reached', 'You can add up to 3 home cities.');
      return;
    }
    setCityInput('');
    const city = await geocodeCity(trimmed);
    setHomeCities((prev) => [...prev, city]);
  };

  const removeCity = (index: number) => {
    setHomeCities((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      if (homeCities.length > 0) {
        await updateProfile({ home_cities: homeCities });
      }

      // Import selected artists in one batch.
      const selectedArtists = topArtists.filter((a, i) =>
        selectedArtistIds.has(a.spotify_id ?? String(i))
      );
      if (selectedArtists.length > 0) {
        await importArtists(selectedArtists, 'spotify');
      }
    } catch (e) {
      console.error('Onboarding finish error:', e);
    }
    setSaving(false);
    router.replace('/(tabs)/feed');
  };

  const steps = [
    <StepConnect
      spotifyToken={spotifyToken}
      connecting={spotifyConnecting}
      onConnectSpotify={handleSpotifyConnect}
    />,
    <StepCity
      input={cityInput}
      onChangeInput={setCityInput}
      onAdd={addCity}
      cities={homeCities}
      onRemove={removeCity}
    />,
    <StepArtists
      artists={topArtists}
      selected={selectedArtistIds}
      onToggle={toggleArtist}
      hasSpotify={!!spotifyToken}
    />,
  ];

  const stepTitles = ['Connect Music', 'Home City', 'Your Artists'];
  const stepDescriptions = [
    'Connect your streaming accounts to import artists.',
    'Set up to 3 cities to track shows near you.',
    'Confirm the artists you want to follow.',
  ];

  return (
    <View style={styles.container}>
      <View style={styles.progressRow}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <View
            key={i}
            style={[styles.progressDot, i <= step && styles.progressDotActive]}
          />
        ))}
      </View>

      <View style={styles.stepHeader}>
        <Text style={styles.stepTitle}>{stepTitles[step]}</Text>
        <Text style={styles.stepDesc}>{stepDescriptions[step]}</Text>
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {steps[step]}
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 && (
          <TouchableOpacity style={styles.backButton} onPress={() => setStep((s) => s - 1)}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        )}
        {step < TOTAL_STEPS - 1 ? (
          <TouchableOpacity
            style={[styles.continueButton, step === 0 && { flex: 1 }]}
            onPress={() => setStep((s) => s + 1)}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleFinish}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.continueButtonText}>Get Started</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function StepConnect({
  spotifyToken,
  connecting,
  onConnectSpotify,
}: {
  spotifyToken: string | null;
  connecting: boolean;
  onConnectSpotify: () => void;
}) {
  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.serviceCard}>
        <View style={stepStyles.serviceInfo}>
          <Text style={stepStyles.serviceName}>Spotify</Text>
          <Text style={stepStyles.serviceDesc}>Import your top artists & followed artists</Text>
        </View>
        <TouchableOpacity
          style={[stepStyles.connectButton, stepStyles.spotifyButton, spotifyToken && stepStyles.connectedButton]}
          onPress={onConnectSpotify}
          disabled={!!spotifyToken || connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <View style={stepStyles.btnRow}>
              {!spotifyToken && <FontAwesome name="spotify" size={14} color="#fff" />}
              <Text style={stepStyles.connectButtonText}>
                {spotifyToken ? 'Connected' : 'Connect'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={stepStyles.serviceCard}>
        <View style={stepStyles.serviceInfo}>
          <Text style={stepStyles.serviceName}>Apple Music</Text>
          <Text style={stepStyles.serviceDesc}>Import your recently played artists</Text>
        </View>
        <TouchableOpacity style={[stepStyles.connectButton, stepStyles.appleButton, stepStyles.btnRow]} onPress={() => Alert.alert('Coming soon', 'Apple Music integration coming soon.')}>
          <FontAwesome name="apple" size={14} color="#fff" />
          <Text style={stepStyles.connectButtonText}>Connect</Text>
        </TouchableOpacity>
      </View>

      <Text style={stepStyles.skipNote}>You can skip this and add artists manually.</Text>
    </View>
  );
}

function StepCity({
  input,
  onChangeInput,
  onAdd,
  cities,
  onRemove,
}: {
  input: string;
  onChangeInput: (v: string) => void;
  onAdd: () => void;
  cities: HomeCity[];
  onRemove: (i: number) => void;
}) {
  return (
    <View style={stepStyles.container}>
      <View style={stepStyles.inputRow}>
        <TextInput
          style={stepStyles.cityInput}
          placeholder="City name (e.g. New York)"
          placeholderTextColor="#555"
          value={input}
          onChangeText={onChangeInput}
          returnKeyType="done"
          onSubmitEditing={onAdd}
        />
        <TouchableOpacity style={stepStyles.addCityButton} onPress={onAdd}>
          <Text style={stepStyles.addCityButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={stepStyles.chipRow}>
        {cities.map((city, i) => (
          <CityChip key={i} city={city} onRemove={() => onRemove(i)} />
        ))}
      </View>

      {cities.length === 0 && (
        <Text style={stepStyles.skipNote}>Add up to 3 cities to track nearby shows.</Text>
      )}
    </View>
  );
}

function StepArtists({
  artists,
  selected,
  onToggle,
  hasSpotify,
}: {
  artists: Partial<Artist>[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  hasSpotify: boolean;
}) {
  if (!hasSpotify || artists.length === 0) {
    return (
      <View style={stepStyles.container}>
        <Text style={stepStyles.emptyText}>
          {hasSpotify
            ? 'No top artists found on Spotify.'
            : 'Connect Spotify in the previous step to import artists, or add them manually in the Artists tab.'}
        </Text>
      </View>
    );
  }

  const rows: Partial<Artist>[][] = [];
  for (let i = 0; i < artists.length; i += 2) {
    rows.push(artists.slice(i, i + 2));
  }

  return (
    <View style={stepStyles.container}>
      <Text style={stepStyles.artistsNote}>
        Tap an artist to deselect. Selected artists will be added to your list.
      </Text>
      {rows.map((row, ri) => (
        <View key={ri} style={stepStyles.artistRow}>
          {row.map((a, ci) => {
            const key = a.spotify_id ?? `${ri}-${ci}`;
            const isSelected = selected.has(key);
            return (
              <View key={key} style={{ flex: 1 }}>
                <ArtistCard
                  artist={{
                    ...a,
                    id: key,
                    name: a.name ?? '',
                    created_at: '',
                    genres: a.genres ?? [],
                    bandsintown_id: null,
                    ticketmaster_id: null,
                    apple_music_id: null,
                    image_url: a.image_url ?? null,
                    thumb_url: a.thumb_url ?? null,
                    spotify_id: a.spotify_id ?? null,
                  }}
                  onPress={() => onToggle(key)}
                  size="sm"
                  selected={isSelected}
                />
              </View>
            );
          })}
          {row.length === 1 && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}

const stepStyles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
  },
  serviceCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  serviceInfo: {
    flex: 1,
    marginRight: 12,
  },
  serviceName: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    marginBottom: 2,
  },
  serviceDesc: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  connectButton: {
    backgroundColor: '#6C63FF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 88,
    alignItems: 'center',
  },
  spotifyButton: {
    backgroundColor: '#1DB954',
  },
  appleButton: {
    backgroundColor: '#FA243C',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectedButton: {
    backgroundColor: '#222',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  skipNote: {
    color: '#555',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cityInput: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    borderWidth: 1,
    borderColor: '#222',
  },
  addCityButton: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCityButtonText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  artistsNote: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginBottom: 4,
  },
  artistRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emptyText: {
    color: '#555',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 20,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 60,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  progressDot: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#222',
  },
  progressDotActive: {
    backgroundColor: '#6C63FF',
  },
  stepHeader: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  stepTitle: {
    color: '#fff',
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    marginBottom: 6,
  },
  stepDesc: {
    color: '#888',
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  body: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 24,
    paddingBottom: 40,
  },
  backButton: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#888',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  continueButton: {
    flex: 2,
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
