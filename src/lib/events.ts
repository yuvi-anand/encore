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
 * A pull-to-refresh must not fan out one Ticketmaster call per followed artist —
 * a Last.fm import can bring in hundreds, which would blow the daily quota in a
 * handful of refreshes and take minutes. Refresh the most-listened slice; the
 * scheduled sync-events job covers the full set on its own throttle.
 */
const MAX_ARTISTS_PER_REFRESH = 60;

/** Postgrest filters go in the URL, so batch `in(...)` lists to keep it short. */
export function chunk<T>(arr: T[], size = 60): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetches upcoming events for the given artists from Ticketmaster and upserts
 * them.
 *
 * Deliberately additive: it never deletes stored events. An earlier version
 * purged every event for these artists before rebuilding, which (a) exceeded the
 * URL limit once a user followed a few hundred artists and (b) meant any show
 * Ticketmaster happened not to return that second vanished from the table — and
 * the scheduled job, which decides "is this show new?" by looking it up there,
 * would then re-announce it. That was a notification-flood regression waiting to
 * happen. Past events age out of the queries via their `event_date` filters.
 */
export async function syncArtistEvents(artistIds: string[]): Promise<void> {
  if (artistIds.length === 0) return;

  // Most-listened first (rank ascending), so a refresh covers what matters most.
  const artists: Artist[] = [];
  for (const group of chunk(artistIds)) {
    const { data, error } = await supabase.from('artists').select('*').in('id', group);
    if (error) {
      console.error('syncArtistEvents artist lookup error:', error);
      continue;
    }
    artists.push(...((data ?? []) as Artist[]));
  }
  if (artists.length === 0) return;

  const slice = artists.slice(0, MAX_ARTISTS_PER_REFRESH);

  const all: Omit<Event, 'id' | 'created_at' | 'artist'>[] = [];
  await mapWithConcurrency(slice, 3, async (artist) => {
    try {
      const tm = await searchEvents(artist.name, artist.id);
      all.push(...tm);
    } catch (e) {
      console.error('syncArtistEvents fetch error for', artist.name, e);
    }
  });

  if (all.length === 0) return;

  const tmMap = new Map<string, (typeof all)[number]>();
  for (const e of all) {
    if (e.ticketmaster_id) tmMap.set(e.ticketmaster_id, e);
  }
  for (const group of chunk(Array.from(tmMap.values()), 100)) {
    const { error } = await supabase
      .from('events')
      .upsert(group, { onConflict: 'ticketmaster_id' });
    if (error) console.error('syncArtistEvents upsert error:', error);
  }
}
