import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getArtistEvents } from '../lib/bandsintown';
import { searchEvents } from '../lib/ticketmaster';
import { Event, Artist, HomeCity } from '../types';

export function useEvents(
  userId: string | undefined,
  artistIds: string[],
  homeCities: HomeCity[],
  radiusMiles: number
) {
  const [events, setEvents] = useState<(Event & { artist: Artist })[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!userId || artistIds.length === 0) {
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

    if (error) {
      console.error('fetchEvents error:', error);
    } else {
      setEvents((data ?? []) as (Event & { artist: Artist })[]);
    }
    setLoading(false);
  }, [userId, artistIds]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const refreshEvents = useCallback(async () => {
    if (!userId || artistIds.length === 0) return;
    setRefreshing(true);

    // Fetch artist records
    const { data: artistRows } = await supabase
      .from('artists')
      .select('*')
      .in('id', artistIds);

    const artists = (artistRows ?? []) as Artist[];

    // Primary city for location filtering
    const primaryCity = homeCities[0];
    const locationStr = primaryCity
      ? `${primaryCity.city},${primaryCity.state ?? primaryCity.country}`
      : undefined;

    const allEvents: Omit<Event, 'id' | 'created_at' | 'artist'>[] = [];

    await Promise.allSettled(
      artists.map(async (artist) => {
        // Bandsintown
        const btEvents = await getArtistEvents(
          artist.name,
          artist.id,
          locationStr,
          radiusMiles
        );
        allEvents.push(...btEvents);

        // Ticketmaster — search per city
        for (const city of homeCities.slice(0, 2)) {
          const tmEvents = await searchEvents(artist.name, artist.id, city.city, radiusMiles);
          allEvents.push(...tmEvents);
        }
      })
    );

    // Upsert events — handle duplicates by bandsintown_id or ticketmaster_id
    if (allEvents.length > 0) {
      const btEvents = allEvents.filter((e) => e.bandsintown_id);
      const tmEvents = allEvents.filter((e) => e.ticketmaster_id && !e.bandsintown_id);

      if (btEvents.length > 0) {
        await supabase
          .from('events')
          .upsert(btEvents, { onConflict: 'bandsintown_id', ignoreDuplicates: false });
      }
      if (tmEvents.length > 0) {
        await supabase
          .from('events')
          .upsert(tmEvents, { onConflict: 'ticketmaster_id', ignoreDuplicates: false });
      }
    }

    await fetchEvents();
    setRefreshing(false);
  }, [userId, artistIds, homeCities, radiusMiles, fetchEvents]);

  return {
    events,
    loading,
    refreshing,
    refreshEvents,
    refetch: fetchEvents,
  };
}
