import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/hooks/useAuth';
import { useArtists } from '../../src/hooks/useArtists';
import { useEvents } from '../../src/hooks/useEvents';
import { EventCard } from '../../src/components/EventCard';
import { syncEventReminders } from '../../src/lib/notifications';
import { Event, Artist } from '../../src/types';

type Filter = 'all' | 'week' | 'month';

const COLORS = {
  bg: '#000',
  text: '#fff',
  muted: '#888',
  accent: '#6C63FF',
  card: '#111',
};

export default function FeedScreen() {
  const { user, profile } = useAuth();
  const { userArtists } = useArtists();
  // Memoize so the array reference is stable between renders — otherwise
  // useEvents' callbacks rebuild every render and trigger a refetch loop.
  const artistIds = useMemo(
    () => userArtists.map((ua) => ua.artist_id),
    [userArtists]
  );
  const homeCities = profile?.home_cities ?? [];
  const radius = profile?.notification_radius_miles ?? 50;

  const { events, loading, refreshing, refreshEvents } = useEvents(
    user?.id,
    artistIds,
    homeCities,
    radius
  );

  const [filter, setFilter] = useState<Filter>('all');

  // Schedule reminder notifications for the in-area upcoming shows whenever the
  // list or the user's notification preferences change.
  useEffect(() => {
    if (events.length === 0) return;
    syncEventReminders(events, {
      weekBefore: profile?.notify_week_before ?? true,
      dayBefore: profile?.notify_day_before ?? true,
    });
  }, [events, profile?.notify_week_before, profile?.notify_day_before]);

  const filtered = useMemo(() => {
    const now = new Date();
    return events.filter((ev) => {
      const date = new Date(ev.event_date);
      if (filter === 'week') {
        const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return date <= weekOut;
      }
      if (filter === 'month') {
        const monthOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        return date <= monthOut;
      }
      return true;
    });
  }, [events, filter]);

  const filterOptions: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All Time' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Upcoming Shows</Text>
        {events.length > 0 && (
          <Text style={styles.count}>{filtered.length}</Text>
        )}
      </View>

      <View style={styles.filterRow}>
        {filterOptions.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.filterPill, filter === opt.key && styles.filterPillActive]}
            onPress={() => setFilter(opt.key)}
          >
            <Text style={[styles.filterText, filter === opt.key && styles.filterTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventCard event={item} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshEvents}
            tintColor="#6C63FF"
            colors={['#6C63FF']}
          />
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No shows yet</Text>
              <Text style={styles.emptySubtitle}>
                Add more artists to see their upcoming shows here.
              </Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  title: {
    color: COLORS.text,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    flex: 1,
  },
  count: {
    color: COLORS.muted,
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    flexDirection: 'row',
  },
  filterPill: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 14,
    height: 36,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222',
  },
  filterPillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  filterText: {
    color: COLORS.muted,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  filterTextActive: {
    color: COLORS.text,
  },
  list: {
    paddingBottom: 24,
    paddingTop: 4,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: COLORS.muted,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
});
