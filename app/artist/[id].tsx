import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';
import { supabase } from '../../src/lib/supabase';
import { syncArtistEvents } from '../../src/lib/events';
import { Artist, Event, distanceMiles } from '../../src/types';

const COLORS = {
  bg: '#000',
  card: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  border: '#222',
  green: '#1DB954',
  greenBg: '#1a3a1f',
};

const EVENT_SELECT =
  'id,artist_id,title,venue_name,venue_city,venue_state,venue_country,venue_lat,venue_lng,event_date,ticket_url' as const;

type Show = Pick<
  Event,
  | 'id'
  | 'artist_id'
  | 'title'
  | 'venue_name'
  | 'venue_city'
  | 'venue_state'
  | 'venue_country'
  | 'venue_lat'
  | 'venue_lng'
  | 'event_date'
  | 'ticket_url'
>;

function formatDate(d: string): string {
  const date = new Date(d);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTime(d: string): string {
  const date = new Date(d);
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours >= 12 ? 'PM' : 'AM'}`;
}

export default function ArtistProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { userArtists, removeArtist } = useArtists();

  const homeCities = useMemo(
    () => (profile?.home_cities ?? []).filter((c) => c.lat !== 0 || c.lng !== 0),
    [profile?.home_cities]
  );
  const radius = profile?.notification_radius_miles ?? 50;

  // Paint the header from the followed-artists cache immediately — the whole
  // point of this screen is answering "are they touring?" fast, so nothing
  // above the fold should wait on the network.
  const followed = useMemo(
    () => userArtists.find((ua) => ua.artist_id === id),
    [userArtists, id]
  );
  const [artist, setArtist] = useState<Artist | null>(followed?.artist ?? null);
  const [shows, setShows] = useState<Show[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (followed?.artist) setArtist(followed.artist);
  }, [followed?.artist]);

  // Only needed when arriving at an artist the user doesn't follow.
  useEffect(() => {
    if (!id || artist) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.from('artists').select('*').eq('id', id).maybeSingle();
      if (alive && data) setArtist(data as Artist);
    })();
    return () => {
      alive = false;
    };
  }, [id, artist]);

  const loadShows = useCallback(async (): Promise<Show[]> => {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_SELECT)
      .eq('artist_id', id)
      .gte('event_date', new Date().toISOString())
      .order('event_date', { ascending: true });
    if (error) {
      console.error('artist shows fetch error:', error);
      return [];
    }
    return (data ?? []) as Show[];
  }, [id]);

  const checkedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;

    (async () => {
      const cached = await loadShows();
      if (!alive) return;
      setShows(cached);

      // "No dates cached" and "not touring" are different answers. If we have
      // nothing on file, ask Ticketmaster directly (once per visit) so the
      // status shown is real rather than just an empty table.
      if (cached.length === 0 && checkedRef.current !== id) {
        checkedRef.current = id;
        setChecking(true);
        try {
          await syncArtistEvents([id]);
          const fresh = await loadShows();
          if (alive) setShows(fresh);
        } catch (e) {
          console.error('artist tour check error:', e);
        } finally {
          if (alive) setChecking(false);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [id, loadShows]);

  const distanceFor = useCallback(
    (show: Show): number | null => {
      if (homeCities.length === 0 || show.venue_lat == null || show.venue_lng == null) return null;
      return Math.round(
        Math.min(
          ...homeCities.map((c) => distanceMiles(c.lat, c.lng, show.venue_lat!, show.venue_lng!))
        )
      );
    },
    [homeCities]
  );

  const nearby = useMemo(() => {
    if (!shows) return null;
    let best: { show: Show; distance: number } | null = null;
    for (const show of shows) {
      const d = distanceFor(show);
      if (d == null) continue;
      if (!best || d < best.distance) best = { show, distance: d };
    }
    return best;
  }, [shows, distanceFor]);

  const handleUnfollow = () => {
    if (!artist) return;
    Alert.alert('Remove Artist', `Remove ${artist.name} from your list?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeArtist(artist.id);
          router.back();
        },
      },
    ]);
  };

  const loading = shows === null;
  const touring = (shows?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Feather name="chevron-left" size={26} color={COLORS.text} />
        </TouchableOpacity>
        {followed ? (
          <TouchableOpacity onPress={handleUnfollow} hitSlop={12} style={styles.backBtn}>
            <Feather name="more-horizontal" size={22} color={COLORS.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          {artist?.image_url ? (
            <Image source={{ uri: artist.image_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {(artist?.name ?? '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.name} numberOfLines={2}>
            {artist?.name ?? 'Artist'}
          </Text>
          {artist?.genres?.length ? (
            <View style={styles.genreRow}>
              {artist.genres.slice(0, 3).map((g) => (
                <View key={g} style={styles.genreChip}>
                  <Text style={styles.genreText}>{g}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* The headline answer. */}
          <View
            style={[
              styles.statusPill,
              touring && styles.statusPillTouring,
              loading && styles.statusPillLoading,
            ]}
          >
            {loading || checking ? (
              <>
                <ActivityIndicator size="small" color={COLORS.muted} />
                <Text style={styles.statusTextMuted}>Checking for dates…</Text>
              </>
            ) : touring ? (
              <>
                <Feather name="check-circle" size={14} color={COLORS.green} />
                <Text style={styles.statusTextTouring}>
                  On tour · {shows!.length} {shows!.length === 1 ? 'date' : 'dates'}
                </Text>
              </>
            ) : (
              <>
                <Feather name="slash" size={14} color={COLORS.muted} />
                <Text style={styles.statusTextMuted}>No dates announced</Text>
              </>
            )}
          </View>

          {nearby ? (
            <Text style={styles.nearby}>
              {nearby.distance <= radius
                ? `Playing ${nearby.distance} mi from you on ${formatDate(nearby.show.event_date)}`
                : `Nearest show is ${nearby.distance} mi away`}
            </Text>
          ) : null}
        </View>

        {touring ? (
          <>
            <Text style={styles.sectionHeader}>Upcoming Dates</Text>
            {shows!.map((show) => {
              const d = distanceFor(show);
              const inArea = d != null && d <= radius;
              const location = [show.venue_city, show.venue_state ?? show.venue_country]
                .filter(Boolean)
                .join(', ');
              return (
                <View key={show.id} style={styles.showCard}>
                  <View style={styles.showDate}>
                    <Text style={styles.showDateText}>{formatDate(show.event_date)}</Text>
                    <Text style={styles.showTimeText}>{formatTime(show.event_date)}</Text>
                  </View>
                  <View style={styles.showInfo}>
                    {show.venue_name ? (
                      <Text style={styles.venue} numberOfLines={1}>
                        {show.venue_name}
                      </Text>
                    ) : null}
                    {location ? (
                      <Text style={styles.location} numberOfLines={1}>
                        {location}
                      </Text>
                    ) : null}
                    {d != null ? (
                      <View style={[styles.distBadge, inArea && styles.distBadgeInArea]}>
                        <Text style={[styles.distText, inArea && styles.distTextInArea]}>
                          {inArea ? 'In your area' : `${d} mi`}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {show.ticket_url ? (
                    <TouchableOpacity
                      style={styles.ticketBtn}
                      onPress={() => Linking.openURL(show.ticket_url!)}
                    >
                      <Text style={styles.ticketBtnText}>Tickets</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : !loading && !checking ? (
          <View style={styles.emptyCard}>
            <Feather name="bell" size={22} color={COLORS.muted} />
            <Text style={styles.emptyTitle}>Nothing announced yet</Text>
            <Text style={styles.emptyBody}>
              {followed
                ? "You'll get a notification the moment they announce a tour."
                : 'Follow this artist to be notified when they announce a tour.'}
            </Text>
          </View>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    minHeight: 40,
  },
  backBtn: { padding: 4 },
  scroll: { paddingHorizontal: 16 },
  hero: { alignItems: 'center', paddingTop: 8, paddingBottom: 12, gap: 10 },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  avatarPlaceholder: { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 44, fontFamily: 'Inter_700Bold' },
  name: {
    color: COLORS.text,
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  genreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  genreChip: { backgroundColor: '#1a1a1a', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  genreText: { color: COLORS.muted, fontSize: 11, fontFamily: 'Inter_400Regular' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
  },
  statusPillTouring: { backgroundColor: COLORS.greenBg },
  statusPillLoading: { backgroundColor: '#141414' },
  statusTextTouring: { color: COLORS.green, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  statusTextMuted: { color: COLORS.muted, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  nearby: {
    color: COLORS.accent,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  sectionHeader: {
    color: COLORS.muted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  showCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    marginVertical: 4,
    gap: 12,
  },
  showDate: { width: 96 },
  showDateText: { color: COLORS.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  showTimeText: { color: COLORS.muted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  showInfo: { flex: 1, gap: 2 },
  venue: { color: COLORS.text, fontSize: 14, fontFamily: 'Inter_400Regular' },
  location: { color: COLORS.muted, fontSize: 12, fontFamily: 'Inter_400Regular' },
  distBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#222',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginTop: 4,
  },
  distBadgeInArea: { backgroundColor: COLORS.greenBg },
  distText: { color: COLORS.muted, fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  distTextInArea: { color: COLORS.green },
  ticketBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ticketBtnText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  emptyTitle: { color: COLORS.text, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyBody: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 19,
  },
});
