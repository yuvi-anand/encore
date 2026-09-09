import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncArtistEvents, chunk } from '../lib/events';

// Only the columns the feed actually renders. `*, artist:artists(*)` repeated
// every artist's full row on every one of its events — about 1 KB per event,
// which is a lot of JSON to pull and parse on a phone before the feed appears.
const EVENT_SELECT =
  'id,artist_id,title,venue_name,venue_city,venue_state,venue_country,venue_lat,venue_lng,event_date,ticket_url,artist:artists(id,name,image_url,thumb_url,genres)' as const;

/** How long to go between full Ticketmaster sweeps on app open. */
const EVENT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
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

  // Depend on the *contents* of these props, not their identity. Callers
  // naturally write `profile?.home_cities ?? []`, which allocates a new array
  // every render; keying the fetch callback off that identity made it a new
  // function each render, so the effect below re-ran on every render, set state,
  // and re-rendered — an infinite loop ("Maximum update depth exceeded").
  const artistKey = artistIds.join(',');
  const homeKey = JSON.stringify(homeCities.map((c) => [c.city, c.lat, c.lng]));
  // Latest values for use inside the callback without widening its deps.
  const artistIdsRef = useRef(artistIds);
  artistIdsRef.current = artistIds;
  const homeCitiesRef = useRef(homeCities);
  homeCitiesRef.current = homeCities;

  const fetchEvents = useCallback(async () => {
    const artistIds = artistIdsRef.current;
    const homeCities = homeCitiesRef.current;
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
        .select(EVENT_SELECT)
        .in('artist_id', group)
        .gte('event_date', nowIso)
        .order('event_date', { ascending: true });
      if (error) {
        console.error('fetchEvents error:', error);
        failed = true;
        continue;
      }
      // Cast through unknown: without generated DB types PostgREST types the
      // embedded artist as an array, but this is a many-to-one FK embed so at
      // runtime it's a single object.
      collected.push(...((data ?? []) as unknown as EventRow[]));
    }

    if (!failed || collected.length > 0) {
      const rows = collected
        .filter((e) => matchesHomeArea(e, homeCities, radiusMiles))
        .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
      setEvents(rows);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, artistKey, homeKey, radiusMiles]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const refreshEvents = useCallback(async () => {
    const ids = artistIdsRef.current;
    if (!userId || ids.length === 0) return;
    setRefreshing(true);
    await syncArtistEvents(ids);
    await fetchEvents();
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, artistKey, fetchEvents]);

  // Auto-fetch shows the first time we have artists, so the feed populates
  // without the user having to pull-to-refresh.
  useEffect(() => {
    if (!userId || !artistKey) return;
    // Only auto-sync once per user per app session. Keying this on the artist
    // count meant every step of an import (which changes the count) kicked off
    // another full Ticketmaster sync.
    if (autoRefreshedFor.current === userId) return;
    autoRefreshedFor.current = userId;

    (async () => {
      // This sweep is up to 60 Ticketmaster lookups. It was running on every
      // single app open, which is most of why startup dragged — so it's now
      // throttled the same way the Spotify and Last.fm syncs are. The cached
      // rows still load immediately via the fetchEvents effect above, and
      // pull-to-refresh still forces a fresh sweep.
      const key = `encore:lastSyncEvents:${userId}`;
      const last = await AsyncStorage.getItem(key);
      if (last && Date.now() - parseInt(last, 10) < EVENT_SYNC_INTERVAL_MS) return;
      await refreshEvents();
      await AsyncStorage.setItem(key, String(Date.now()));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, artistKey]);

  return {
    events,
    loading,
    refreshing,
    refreshEvents,
    refetch: fetchEvents,
  };
}
