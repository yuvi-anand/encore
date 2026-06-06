import { supabase } from './supabase';
import { searchEvents } from './ticketmaster';
import { Event, Artist } from '../types';

/** Runs async work with limited concurrency to respect API rate limits. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Fetches upcoming events for the given artists from Ticketmaster, purges the
 * old stored events for those artists, and upserts the fresh set. Shared by the
 * Feed and Touring screens so there's one source of truth for event data.
 */
export async function syncArtistEvents(artistIds: string[]): Promise<void> {
  if (artistIds.length === 0) return;

  const { data: artistRows } = await supabase.from('artists').select('*').in('id', artistIds);
  const artists = (artistRows ?? []) as Artist[];

  const all: Omit<Event, 'id' | 'created_at' | 'artist'>[] = [];
  await mapWithConcurrency(artists, 3, async (artist) => {
    const tm = await searchEvents(artist.name, artist.id);
    all.push(...tm);
  });

  // Purge stale events (e.g. tribute mismatches) then rebuild.
  await supabase.from('events').delete().in('artist_id', artistIds);

  if (all.length > 0) {
    const tmMap = new Map<string, (typeof all)[number]>();
    for (const e of all) {
      if (e.ticketmaster_id) tmMap.set(e.ticketmaster_id, e);
    }
    if (tmMap.size > 0) {
      await supabase
        .from('events')
        .upsert(Array.from(tmMap.values()), { onConflict: 'ticketmaster_id' });
    }
  }
}
