import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { syncArtistEvents, chunk } from '../lib/events';
import { Event, Artist, HomeCity, distanceMiles } from '../types';

type EventRow = Event & { artist: Artist };

/**
 * Whether a show is close enough to one of the user's home cities to belong in
 * the feed.
 *
 * Uses real distance against the user's radius setting. This previously matched
 * on city *name*, which ignored the radius slider entirely and hid shows in
 * neighbouring towns — a venue 10 miles away in the next suburb simply never
 * appeared. Name matching is kept only as a fallback for events (or home cities)
 * that have no coordinates.
 */
function matchesHomeArea(
  event: Pick<Event, 'venue_city' | 'venue_lat' | 'venue_lng'>,
  homeCities: HomeCity[],
  radiusMiles: number
): boolean {
  if (homeCities.length === 0) return true; // no filter set → show everything

  const homesWithCoords = homeCities.filter((c) => c.lat !== 0 || c.lng !== 0);
  if (event.venue_lat != null && event.venue_lng != null && homesWithCoords.length > 0) {
    return homesWithCoords.some(
      (c) => distanceMiles(c.lat, c.lng, event.venue_lat as number, event.venue_lng as number) <= radiusMiles
    );
  }

  // No coordinates on one side — fall back to comparing city names.
  const venue = (event.venue_city ?? '').toLowerCase().trim();
  if (!venue) return false;
  return homeCities.some((c) => {
    const home = c.city.toLowerCase().trim();
    return home.length > 0 && (venue.includes(home) || home.includes(venue));
  });
}

export function useEvents(
  userId: string | undefined,
  artistIds: string[],
  homeCities: HomeCity[],
  radiusMiles: number
) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const autoRefreshedFor = useRef<string>('');

  const fetchEvents = useCallback(async () => {
    if (!userId || artistIds.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }

    // Batch the id list — a user following hundreds of artists would otherwise
    // build a URL long enough for PostgREST to reject the request outright.
    const nowIso = new Date().toISOString();
    const collected: EventRow[] = [];
    let failed = false;
    for (const group of chunk(artistIds)) {
      const { data, error } = await supabase
        .from('events')
        .select('*, artist:artists(*)')
        .in('artist_id', group)
        .gte('event_date', nowIso)
        .order('event_date', { ascending: true });
      if (error) {
        console.error('fetchEvents error:', error);
        failed = true;
        continue;
      }
      collected.push(...((data ?? []) as EventRow[]));
    }

    if (!failed || collected.length > 0) {
      const rows = collected
        .filter((e) => matchesHomeArea(e, homeCities, radiusMiles))
        .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
      setEvents(rows);
    }
    setLoading(false);
  }, [userId, artistIds, homeCities, radiusMiles]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const refreshEvents = useCallback(async () => {
    if (!userId || artistIds.length === 0) return;
    setRefreshing(true);
    await syncArtistEvents(artistIds);
    await fetchEvents();
    setRefreshing(false);
  }, [userId, artistIds, fetchEvents]);

  // Auto-fetch shows the first time we have artists, so the feed populates
  // without the user having to pull-to-refresh.
  useEffect(() => {
    if (!userId || artistIds.length === 0) return;
    const key = `${userId}:${artistIds.length}`;
    if (autoRefreshedFor.current === key) return;
    autoRefreshedFor.current = key;
    refreshEvents();
  }, [userId, artistIds, refreshEvents]);

  return {
    events,
    loading,
    refreshing,
    refreshEvents,
    refetch: fetchEvents,
  };
}
