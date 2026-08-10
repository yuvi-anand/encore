import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { Artist, UserArtist, ArtistSource } from '../types';
import { useAuth } from './useAuth';
import { getValidSpotifyToken, getLibraryArtists, fetchArtistByName } from '../lib/spotify';
import { getLastfmTopArtists } from '../lib/lastfm';

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // re-sync at most every 12h

type UserArtistRow = UserArtist & { artist: Artist };

/** `%` and `_` are LIKE wildcards — escape them so names match literally. */
function escapeLike(name: string): string {
  return name.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Matching key for "is this the same artist?" across sources. Last.fm, Spotify
 * and Apple Music punctuate and case names differently ("Tyler, The Creator" vs
 * "Tyler the Creator"), so compare on a stripped-down form.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface ArtistsContextValue {
  userArtists: UserArtistRow[];
  loading: boolean;
  addArtist: (
    artistData: Partial<Artist>,
    source: ArtistSource
  ) => Promise<void>;
  importArtists: (
    artists: Partial<Artist>[],
    source: ArtistSource,
    mode?: 'replace' | 'merge'
  ) => Promise<number>;
  removeArtist: (artistId: string) => Promise<void>;
  /** Fetches the Spotify library and imports it, guarded so only one runs at a time. */
  syncLibrary: (token: string, mode?: 'replace' | 'merge') => Promise<number>;
  /** Fetches a Last.fm user's top artists and imports them. */
  syncLastfm: (username: string, mode?: 'replace' | 'merge') => Promise<number>;
  refetch: () => Promise<void>;
}

const ArtistsContext = createContext<ArtistsContextValue | undefined>(undefined);

export function ArtistsProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, updateProfile } = useAuth();
  const userId = user?.id;
  const [userArtists, setUserArtists] = useState<UserArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Ensures the library fetch+import never runs twice concurrently (manual
  // reconnect + background auto-sync would otherwise collide and rate-limit).
  const syncingRef = useRef(false);
  // Guards the background auto-sync so it runs at most once per user per app
  // session — refreshing the token mutates the profile, so without this the
  // effect would retrigger itself in an infinite loop.
  const autoSyncedRef = useRef<string>('');
  const lastfmSyncedRef = useRef<string>('');
  const enrichingRef = useRef(false);

  const fetchArtists = useCallback(async () => {
    if (!userId) {
      setUserArtists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('user_artists')
      .select('*, artist:artists(*)')
      .eq('user_id', userId)
      .order('rank', { ascending: true, nullsFirst: false })
      .order('added_at', { ascending: false });

    if (error) {
      console.error('fetchArtists error:', error);
    } else {
      // Filter out rows whose joined artist failed to load.
      setUserArtists((data ?? []).filter((r: any) => r.artist) as UserArtistRow[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  const addArtist = useCallback(
    async (
      artistData: Partial<Artist>,
      source: ArtistSource
    ) => {
      if (!userId) return;

      let artistId: string | null = null;

      const filters: string[] = [];
      if (artistData.spotify_id) filters.push(`spotify_id.eq.${artistData.spotify_id}`);
      if (artistData.bandsintown_id) filters.push(`bandsintown_id.eq.${artistData.bandsintown_id}`);
      if (artistData.ticketmaster_id) filters.push(`ticketmaster_id.eq.${artistData.ticketmaster_id}`);

      // NOTE: these lookups use limit(1) rather than maybeSingle() on purpose —
      // maybeSingle() *errors* when more than one row matches, and the catalog
      // legitimately contains same-named rows. That error used to leave artistId
      // null and insert yet another duplicate, compounding the problem.
      if (filters.length > 0) {
        const { data: existing } = await supabase
          .from('artists')
          .select('id')
          .or(filters.join(','))
          .limit(1);
        if (existing?.[0]) artistId = existing[0].id;
      }

      if (!artistId && artistData.name) {
        const { data: byName } = await supabase
          .from('artists')
          .select('id')
          .ilike('name', escapeLike(artistData.name))
          // Prefer the most complete row so duplicates converge on one canonical
          // artist instead of fanning out further.
          .order('spotify_id', { ascending: false, nullsFirst: false })
          .limit(1);
        if (byName?.[0]) artistId = byName[0].id;
      }

      if (!artistId) {
        const { data: inserted, error: insertError } = await supabase
          .from('artists')
          .insert({
            name: artistData.name ?? '',
            spotify_id: artistData.spotify_id ?? null,
            apple_music_id: artistData.apple_music_id ?? null,
            bandsintown_id: artistData.bandsintown_id ?? null,
            ticketmaster_id: artistData.ticketmaster_id ?? null,
            genres: artistData.genres ?? [],
            image_url: artistData.image_url ?? null,
            thumb_url: artistData.thumb_url ?? null,
          })
          .select('id')
          .single();

        if (insertError || !inserted) {
          console.error('addArtist insert error:', insertError);
          return;
        }
        artistId = inserted.id;
      } else {
        await supabase
          .from('artists')
          .update({
            ...(artistData.spotify_id && { spotify_id: artistData.spotify_id }),
            ...(artistData.bandsintown_id && { bandsintown_id: artistData.bandsintown_id }),
            ...(artistData.ticketmaster_id && { ticketmaster_id: artistData.ticketmaster_id }),
            ...(artistData.image_url && { image_url: artistData.image_url }),
            ...(artistData.genres?.length && { genres: artistData.genres }),
          })
          .eq('id', artistId);
      }

      const { error: linkError } = await supabase
        .from('user_artists')
        .upsert(
          { user_id: userId, artist_id: artistId, source },
          { onConflict: 'user_id,artist_id' }
        );

      if (linkError) {
        console.error('addArtist link error:', linkError);
        return;
      }

      await fetchArtists();
    },
    [userId, fetchArtists]
  );

  const importArtists = useCallback(
    async (
      artists: Partial<Artist>[],
      source: ArtistSource,
      mode: 'replace' | 'merge' = 'replace'
    ): Promise<number> => {
      if (!userId || artists.length === 0) return 0;

      if (mode === 'replace') {
        // A fresh connect replaces that source's set (keeps manual adds).
        await supabase
          .from('user_artists')
          .delete()
          .eq('user_id', userId)
          .eq('source', source);
      } else {
        // Background re-sync: never remove artists. Reset existing ranks for
        // this source so artists no longer in the current library sink to the
        // bottom, then the upsert below re-ranks current ones.
        await supabase
          .from('user_artists')
          .update({ rank: null })
          .eq('user_id', userId)
          .eq('source', source);
      }

      // De-dupe the incoming batch, keeping the FIRST occurrence so the caller's
      // ordering (most-listened first) survives as the stored rank.
      const byKey = new Map<string, Partial<Artist>>();
      for (const a of artists) {
        const name = a.name?.trim();
        if (!name) continue;
        const key = a.spotify_id ? `sp:${a.spotify_id}` : `nm:${normalizeName(name)}`;
        if (!byKey.has(key)) byKey.set(key, a);
      }
      const unique = Array.from(byKey.values());
      if (unique.length === 0) return 0;

      // Resolve every incoming artist to a catalog row id, in bulk. This used to
      // fall back to a per-artist path (several queries plus a full refetch each)
      // for any artist without a spotify_id — i.e. every Last.fm artist — which
      // made a few-hundred-artist import take thousands of round trips.
      const rowIdFor = new Map<Partial<Artist>, string>();
      const unresolved = new Set(unique);

      // 1. Match on spotify_id.
      const withSpotify = unique.filter((a) => a.spotify_id);
      if (withSpotify.length > 0) {
        const idBySpotify = new Map<string, string>();
        for (const group of chunk(withSpotify.map((a) => a.spotify_id as string), 80)) {
          const { data, error } = await supabase
            .from('artists')
            .select('id, spotify_id')
            .in('spotify_id', group);
          if (error) console.error('importArtists spotify lookup error:', error);
          for (const row of data ?? []) if (row.spotify_id) idBySpotify.set(row.spotify_id, row.id);
        }
        for (const a of withSpotify) {
          const id = idBySpotify.get(a.spotify_id as string);
          if (id) {
            rowIdFor.set(a, id);
            unresolved.delete(a);
          }
        }
      }

      // 2. Match whatever's left by name (case/punctuation-insensitive). This is
      // what lets a Last.fm "Radiohead" and a Spotify "Radiohead" collapse onto
      // one catalog row instead of creating a duplicate.
      const remaining = Array.from(unresolved);
      if (remaining.length > 0) {
        const byNormName = new Map<string, { id: string; spotify_id: string | null }>();
        const names = remaining.map((a) => (a.name as string).trim());
        // Exact match first (cheap), then a case-insensitive pass for the rest.
        for (const group of chunk(names, 60)) {
          const { data } = await supabase
            .from('artists')
            .select('id, name, spotify_id')
            .in('name', group);
          for (const row of data ?? []) {
            const k = normalizeName(row.name ?? '');
            const prev = byNormName.get(k);
            // Prefer a row that already has a spotify_id as the canonical one.
            if (!prev || (!prev.spotify_id && row.spotify_id)) {
              byNormName.set(k, { id: row.id, spotify_id: row.spotify_id });
            }
          }
        }
        const stillMissing = remaining.filter(
          (a) => !byNormName.has(normalizeName(a.name as string))
        );
        for (const group of chunk(stillMissing, 40)) {
          // Quote values so names containing commas ("Tyler, The Creator") don't
          // break the or() filter; skip the rare names that need escaping.
          const ors = group
            .map((a) => (a.name as string).trim())
            .filter((n) => !/["\\%_]/.test(n))
            .map((n) => `name.ilike."${n}"`);
          if (ors.length === 0) continue;
          const { data } = await supabase
            .from('artists')
            .select('id, name, spotify_id')
            .or(ors.join(','));
          for (const row of data ?? []) {
            const k = normalizeName(row.name ?? '');
            const prev = byNormName.get(k);
            if (!prev || (!prev.spotify_id && row.spotify_id)) {
              byNormName.set(k, { id: row.id, spotify_id: row.spotify_id });
            }
          }
        }
        for (const a of remaining) {
          const hit = byNormName.get(normalizeName(a.name as string));
          if (hit) {
            rowIdFor.set(a, hit.id);
            unresolved.delete(a);
          }
        }
      }

      // 3. Bulk-insert anything genuinely new.
      const toInsert = Array.from(unresolved);
      for (const group of chunk(toInsert, 80)) {
        const { data: inserted, error: insErr } = await supabase
          .from('artists')
          .insert(
            group.map((a) => ({
              name: (a.name as string).trim(),
              spotify_id: a.spotify_id ?? null,
              apple_music_id: a.apple_music_id ?? null,
              genres: a.genres ?? [],
              image_url: a.image_url ?? null,
              thumb_url: a.thumb_url ?? null,
            }))
          )
          .select('id, name, spotify_id');
        if (insErr) {
          console.error('importArtists insert error:', insErr);
          continue;
        }
        // Map inserted rows back by spotify_id when present, else by name.
        const insertedBySpotify = new Map<string, string>();
        const insertedByName = new Map<string, string>();
        for (const row of inserted ?? []) {
          if (row.spotify_id) insertedBySpotify.set(row.spotify_id, row.id);
          insertedByName.set(normalizeName(row.name ?? ''), row.id);
        }
        for (const a of group) {
          const id = a.spotify_id
            ? insertedBySpotify.get(a.spotify_id)
            : insertedByName.get(normalizeName(a.name as string));
          if (id) rowIdFor.set(a, id);
        }
      }

      // 4. Upgrade catalog rows that are missing artwork/genres when this import
      // carries better data (e.g. a Spotify import filling in a bare Last.fm row).
      const upgradable = unique.filter(
        (a) => rowIdFor.has(a) && (a.image_url || a.genres?.length)
      );
      if (upgradable.length > 0) {
        const ids = upgradable.map((a) => rowIdFor.get(a) as string);
        const bare = new Set<string>();
        for (const group of chunk(ids, 80)) {
          const { data } = await supabase
            .from('artists')
            .select('id, image_url, genres')
            .in('id', group);
          for (const row of data ?? []) {
            if (!row.image_url || !row.genres?.length) bare.add(row.id);
          }
        }
        for (const a of upgradable) {
          const id = rowIdFor.get(a) as string;
          if (!bare.has(id)) continue;
          await supabase
            .from('artists')
            .update({
              ...(a.image_url && { image_url: a.image_url, thumb_url: a.thumb_url ?? a.image_url }),
              ...(a.genres?.length && { genres: a.genres }),
              ...(a.spotify_id && { spotify_id: a.spotify_id }),
            })
            .eq('id', id);
        }
      }

      // 5. Link to the user, preserving listening rank for EVERY source (rank was
      // previously Spotify-only, which threw away Last.fm's play-count ordering).
      // Dedupe by artist_id so two incoming entries resolving to the same catalog
      // row can't violate the (user_id, artist_id) primary key in one upsert.
      const linkByArtist = new Map<string, { user_id: string; artist_id: string; source: ArtistSource; rank: number }>();
      unique.forEach((a, i) => {
        const artist_id = rowIdFor.get(a);
        if (!artist_id || linkByArtist.has(artist_id)) return;
        linkByArtist.set(artist_id, { user_id: userId, artist_id, source, rank: i });
      });
      const links = Array.from(linkByArtist.values());
      let linked = 0;
      for (const group of chunk(links, 80)) {
        const { error: linkError } = await supabase
          .from('user_artists')
          .upsert(group, { onConflict: 'user_id,artist_id' });
        if (linkError) console.error('importArtists link error:', linkError);
        else linked += group.length;
      }

      await fetchArtists();
      return linked;
    },
    [userId, fetchArtists]
  );

  const removeArtist = useCallback(
    async (artistId: string) => {
      if (!userId) return;
      // Optimistic update.
      setUserArtists((prev) => prev.filter((ua) => ua.artist_id !== artistId));
      const { error } = await supabase
        .from('user_artists')
        .delete()
        .eq('user_id', userId)
        .eq('artist_id', artistId);
      if (error) {
        console.error('removeArtist error:', error);
        await fetchArtists();
      }
    },
    [userId, fetchArtists]
  );

  /**
   * Fills in artwork + genres for artists imported "bare" (Last.fm gives names
   * only; Spotify's Liked Songs/playlists do too). Runs server-side against a
   * Spotify *app* token, so it works for every user regardless of which service
   * they connected and never spends their personal rate-limit budget — the old
   * client-side backfill hammered the user's token and was what triggered
   * Spotify's long rate-limit penalties. Each call handles a fixed batch, so
   * loop until it stops making progress. Safe to fire-and-forget.
   */
  const runEnrichment = useCallback(async () => {
    if (enrichingRef.current) return;
    enrichingRef.current = true;
    try {
      for (let i = 0; i < 8; i++) {
        const { data, error } = await supabase.functions.invoke('enrich-artists', { body: {} });
        if (error) {
          console.error('enrich-artists error:', error);
          break;
        }
        // Stop when nothing is left, or when a pass made no progress (some
        // obscure names have no Spotify match and would be rescanned forever).
        if (!data?.scanned || !data?.enriched) break;
        await fetchArtists(); // surface artwork as it lands
      }
      await fetchArtists();
    } catch (e) {
      console.error('runEnrichment error:', e);
    } finally {
      enrichingRef.current = false;
    }
  }, [fetchArtists]);

  const syncLibrary = useCallback(
    async (token: string, mode: 'replace' | 'merge' = 'merge'): Promise<number> => {
      if (syncingRef.current) return 0; // a sync is already running
      syncingRef.current = true;
      try {
        const library = await getLibraryArtists(token);
        if (library.length === 0) return 0;
        const count = await importArtists(library, 'spotify', mode);
        if (userId) {
          await AsyncStorage.setItem(`encore:lastSync:${userId}`, String(Date.now()));
        }
        void runEnrichment();
        return count;
      } finally {
        syncingRef.current = false;
      }
    },
    [userId, importArtists, runEnrichment]
  );

  // Last.fm has no OAuth — a public username is enough to read listening data.
  // Fetches the user's top artists (name-only) and imports them; the shared
  // guard keeps it from colliding with a Spotify sync.
  const syncLastfm = useCallback(
    async (username: string, mode: 'replace' | 'merge' = 'replace'): Promise<number> => {
      if (syncingRef.current) return 0;
      syncingRef.current = true;
      try {
        const artists = await getLastfmTopArtists(username);
        if (artists.length === 0) return 0;
        const count = await importArtists(artists, 'lastfm', mode);
        // Last.fm returns names only, so artwork + genres come from enrichment.
        await runEnrichment();
        return count;
      } finally {
        syncingRef.current = false;
      }
    },
    [importArtists, runEnrichment]
  );

  // Background re-sync: as listening habits evolve, pull the latest Spotify
  // library on app open (throttled), ADD any new artists, re-rank, and never
  // remove existing ones. Requires a stored refresh token.
  useEffect(() => {
    if (!userId || !profile?.spotify_token) return;
    if (autoSyncedRef.current === userId) return; // already attempted this session
    autoSyncedRef.current = userId;

    // Snapshot the tokens now so refreshing (which mutates the profile) can't
    // retrigger this effect.
    const accessToken = profile.spotify_token;
    const refreshToken = profile.spotify_refresh_token;

    (async () => {
      try {
        // Always refresh the access token on open so /search-backed features
        // (suggestions, search enrichment) keep working — access tokens expire
        // after ~1h. This must NOT be gated by the sync throttle.
        const token = await getValidSpotifyToken(accessToken, refreshToken, (t) =>
          updateProfile({
            spotify_token: t.accessToken,
            spotify_refresh_token: t.refreshToken,
          })
        );
        if (!token) return;

        // Full library re-sync only every 12h.
        const key = `encore:lastSync:${userId}`;
        const last = await AsyncStorage.getItem(key);
        if (!last || Date.now() - parseInt(last, 10) >= SYNC_INTERVAL_MS) {
          await syncLibrary(token, 'merge');
        }
      } catch (e) {
        console.error('background spotify sync error:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.spotify_token]);

  // Background Last.fm re-sync on app open (throttled to every 12h). Same
  // philosophy as Spotify: ADD newly-listened artists, never remove.
  useEffect(() => {
    if (!userId || !profile?.lastfm_username) return;
    const key = `${userId}:${profile.lastfm_username}`;
    if (lastfmSyncedRef.current === key) return;
    lastfmSyncedRef.current = key;
    const username = profile.lastfm_username;

    (async () => {
      try {
        const storageKey = `encore:lastSyncLastfm:${userId}`;
        const last = await AsyncStorage.getItem(storageKey);
        if (!last || Date.now() - parseInt(last, 10) >= SYNC_INTERVAL_MS) {
          await syncLastfm(username, 'merge');
          await AsyncStorage.setItem(storageKey, String(Date.now()));
        }
      } catch (e) {
        console.error('background lastfm sync error:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.lastfm_username]);

  const value: ArtistsContextValue = {
    userArtists,
    loading,
    addArtist,
    importArtists,
    removeArtist,
    syncLibrary,
    syncLastfm,
    refetch: fetchArtists,
  };

  return React.createElement(ArtistsContext.Provider, { value }, children);
}

export function useArtists(): ArtistsContextValue {
  const ctx = useContext(ArtistsContext);
  if (!ctx) {
    throw new Error('useArtists must be used within an ArtistsProvider');
  }
  return ctx;
}
