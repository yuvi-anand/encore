import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';
import { supabase } from '../../src/lib/supabase';
import { syncArtistEvents } from '../../src/lib/events';
import { Event, Artist, distanceMiles } from '../../src/types';

const COLORS = {
  bg: '#000',
  card: '#111',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  border: '#222',
  green: '#1DB954',
};

interface TouringRow {
  artist: Artist;
  nextDate: string;
  nearestCity: string | null;
  nearestState: string | null;
  nearestDistance: number | null;
  inArea: boolean;
  ticketUrl: string | null;
  eventCount: number;
}

function formatDate(d: string): string {
  const date = new Date(d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export default function TouringScreen() {
  const { profile } = useAuth();
  const { userArtists } = useArtists();
  const artistIds = useMemo(() => userArtists.map((ua) => ua.artist_id), [userArtists]);
  const homeCities = profile?.home_cities ?? [];
  const radius = profile?.notification_radius_miles ?? 50;

  const [events, setEvents] = useState<(Event & { artist: Artist })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (artistIds.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('events')
      .select('*, artist:artists(*)')
      .in('artist_id', artistIds)
      .gte('event_date', new Date().toISOString())
      .order('event_date', { ascending: true });
    if (error) console.error('touring fetch error:', error);
    setEvents(((data ?? []) as (Event & { artist: Artist })[]).filter((e) => e.artist));
    setLoading(false);
  }, [artistIds]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const onRefresh = useCallback(async () => {
    if (artistIds.length === 0) return;
    setRefreshing(true);
    await syncArtistEvents(artistIds);
    await fetchEvents();
    setRefreshing(false);
  }, [artistIds, fetchEvents]);

  // Reduce events into one touring row per artist (nearest show to home).
  const rows: TouringRow[] = useMemo(() => {
    const homesWithCoords = homeCities.filter((c) => c.lat !== 0 || c.lng !== 0);
    const byArtist = new Map<string, (Event & { artist: Artist })[]>();
    for (const ev of events) {
      const arr = byArtist.get(ev.artist_id) ?? [];
      arr.push(ev);
      byArtist.set(ev.artist_id, arr);
    }

    const result: TouringRow[] = [];
    for (const [, evs] of byArtist) {
      const artist = evs[0].artist;
      const sorted = [...evs].sort(
        (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
      );

      let nearest: (Event & { artist: Artist }) | null = null;
      let nearestDistance: number | null = null;

      if (homesWithCoords.length > 0) {
        for (const ev of evs) {
          if (ev.venue_lat == null || ev.venue_lng == null) continue;
          const d = Math.min(
            ...homesWithCoords.map((c) => distanceMiles(c.lat, c.lng, ev.venue_lat!, ev.venue_lng!))
          );
          if (nearestDistance == null || d < nearestDistance) {
            nearestDistance = d;
            nearest = ev;
          }
        }
      }

      const display = nearest ?? sorted[0];
      result.push({
        artist,
        nextDate: sorted[0].event_date,
        nearestCity: display.venue_city,
        nearestState: display.venue_state,
        nearestDistance: nearestDistance != null ? Math.round(nearestDistance) : null,
        inArea: nearestDistance != null && nearestDistance <= radius,
        ticketUrl: display.ticket_url,
        eventCount: evs.length,
      });
    }

    // Closest tours first; in-area first; unknown-distance last by soonest date.
    return result.sort((a, b) => {
      if (a.nearestDistance == null && b.nearestDistance == null) {
        return new Date(a.nextDate).getTime() - new Date(b.nextDate).getTime();
      }
      if (a.nearestDistance == null) return 1;
      if (b.nearestDistance == null) return -1;
      return a.nearestDistance - b.nearestDistance;
    });
  }, [events, homeCities, radius]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Touring</Text>
        {rows.length > 0 && <Text style={styles.count}>{rows.length}</Text>}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.artist.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={item.ticketUrl ? 0.8 : 1}
            onPress={() => item.ticketUrl && Linking.openURL(item.ticketUrl)}
          >
            {item.artist.image_url ? (
              <Image source={{ uri: item.artist.image_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarText}>{item.artist.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={1}>{item.artist.name}</Text>
              <Text style={styles.location} numberOfLines={1}>
                {item.nearestCity
                  ? `${item.nearestCity}${item.nearestState ? `, ${item.nearestState}` : ''}`
                  : 'On tour'}
              </Text>
              <Text style={styles.date}>{formatDate(item.nextDate)}</Text>
            </View>
            <View style={styles.right}>
              {item.nearestDistance != null ? (
                <View style={[styles.badge, item.inArea && styles.badgeInArea]}>
                  <Text style={[styles.badgeText, item.inArea && styles.badgeTextInArea]}>
                    {item.inArea ? 'In your area' : `${item.nearestDistance} mi`}
                  </Text>
                </View>
              ) : null}
              {item.eventCount > 1 && (
                <Text style={styles.dates}>{item.eventCount} dates</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" />
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No tours found</Text>
              <Text style={styles.emptySubtitle}>
                None of your artists have upcoming shows listed. Pull down to refresh.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  title: { color: COLORS.text, fontSize: 28, fontFamily: 'Inter_700Bold', flex: 1 },
  count: { color: COLORS.muted, fontSize: 18, fontFamily: 'Inter_400Regular' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    marginVertical: 5,
    gap: 12,
  },
  avatar: { width: 54, height: 54, borderRadius: 27 },
  avatarPlaceholder: { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontFamily: 'Inter_700Bold' },
  info: { flex: 1, gap: 2 },
  name: { color: COLORS.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  location: { color: COLORS.muted, fontSize: 13, fontFamily: 'Inter_400Regular' },
  date: { color: COLORS.accent, fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  badge: {
    backgroundColor: '#222',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeInArea: { backgroundColor: '#1a3a1f' },
  badgeText: { color: COLORS.muted, fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  badgeTextInArea: { color: COLORS.green },
  dates: { color: COLORS.muted, fontSize: 11, fontFamily: 'Inter_400Regular' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { color: COLORS.text, fontSize: 20, fontFamily: 'Inter_700Bold', marginBottom: 8 },
  emptySubtitle: {
    color: COLORS.muted,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
});
