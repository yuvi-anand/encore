import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { syncArtistEvents, chunk } from '../lib/events';
import { Event, Artist, HomeCity } from '../types';

type EventRow = Event & { artist: Artist };

/** Whether an event's city matches one of the user's home cities. */
function matchesHomeCity(event: Pick<Event, 'venue_city'>, homeCities: HomeCity[]): boolean {
  if (homeCities.length === 0) return true; // no filter set → show everything
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
        .filter((e) => matchesHomeCity(e, homeCities))
        .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
      setEvents(rows);
    }
    setLoading(false);
  }, [userId, artistIds, homeCities]);

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
