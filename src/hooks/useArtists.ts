import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { Artist, UserArtist } from '../types';
import { useAuth } from './useAuth';
import { getValidSpotifyToken, getLibraryArtists, fetchArtistByName } from '../lib/spotify';

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // re-sync at most every 12h

type UserArtistRow = UserArtist & { artist: Artist };

interface ArtistsContextValue {
  userArtists: UserArtistRow[];
  loading: boolean;
  addArtist: (
    artistData: Partial<Artist>,
    source: 'spotify' | 'apple_music' | 'manual'
  ) => Promise<void>;
  importArtists: (
    artists: Partial<Artist>[],
    source: 'spotify' | 'apple_music' | 'manual',
    mode?: 'replace' | 'merge'
  ) => Promise<number>;
  removeArtist: (artistId: string) => Promise<void>;
  /** Fetches the Spotify library and imports it, guarded so only one runs at a time. */
  syncLibrary: (token: string, mode?: 'replace' | 'merge') => Promise<number>;
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
  const backfillingRef = useRef(false);

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
      source: 'spotify' | 'apple_music' | 'manual'
    ) => {
      if (!userId) return;

      let artistId: string | null = null;

      const filters: string[] = [];
      if (artistData.spotify_id) filters.push(`spotify_id.eq.${artistData.spotify_id}`);
      if (artistData.bandsintown_id) filters.push(`bandsintown_id.eq.${artistData.bandsintown_id}`);
      if (artistData.ticketmaster_id) filters.push(`ticketmaster_id.eq.${artistData.ticketmaster_id}`);

      if (filters.length > 0) {
        const { data: existing } = await supabase
          .from('artists')
          .select('id')
          .or(filters.join(','))
          .maybeSingle();
        if (existing) artistId = existing.id;
      }

      if (!artistId && artistData.name) {
        const { data: byName } = await supabase
          .from('artists')
          .select('id')
          .ilike('name', artistData.name)
          .maybeSingle();
        if (byName) artistId = byName.id;
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
      source: 'spotify' | 'apple_music' | 'manual',
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

      // De-dupe the incoming batch by spotify id / name.
      const byKey = new Map<string, Partial<Artist>>();
      for (const a of artists) {
        const key = a.spotify_id ?? a.bandsintown_id ?? a.name?.toLowerCase() ?? '';
        if (key && !byKey.has(key)) byKey.set(key, a);
      }
      const unique = Array.from(byKey.values());

      const withSpotify = unique.filter((a) => a.spotify_id);
      const idBySpotify = new Map<string, string>();
      // Rank by position in the (already ranked) input list.
      const rankBySpotify = new Map<string, number>();
      withSpotify.forEach((a, i) => rankBySpotify.set(a.spotify_id as string, i));

      const chunk = <T,>(arr: T[], size: number): T[][] => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };

      if (withSpotify.length > 0) {
        const spotifyIds = withSpotify.map((a) => a.spotify_id as string);

        // 1. Find which of these artists already exist (chunked to keep URLs small).
        const existingBare = new Map<string, string>(); // spotify_id -> row id, missing image/genres
        for (const ids of chunk(spotifyIds, 80)) {
          const { data: existing, error: selErr } = await supabase
            .from('artists')
            .select('id, spotify_id, image_url, genres')
            .in('spotify_id', ids);
          if (selErr) console.error('importArtists select error:', selErr);
          for (const row of existing ?? []) {
            if (!row.spotify_id) continue;
            idBySpotify.set(row.spotify_id, row.id);
            if (!row.image_url || !(row.genres?.length)) existingBare.set(row.spotify_id, row.id);
          }
        }

        // 1b. Backfill image/genres onto existing rows that were imported bare
        // before (e.g. from a prior import), when we now have better data.
        for (const a of withSpotify) {
          const sid = a.spotify_id as string;
          const rowId = existingBare.get(sid);
          if (!rowId) continue;
          if (!a.image_url && !(a.genres?.length)) continue;
          await supabase
            .from('artists')
            .update({
              ...(a.image_url && { image_url: a.image_url, thumb_url: a.thumb_url ?? a.image_url }),
              ...(a.genres?.length && { genres: a.genres }),
            })
            .eq('id', rowId);
        }

        // 2. Insert the ones that don't exist yet (chunked).
        const toInsert = withSpotify.filter((a) => !idBySpotify.has(a.spotify_id as string));
        for (const group of chunk(toInsert, 80)) {
          const { data: inserted, error: insErr } = await supabase
            .from('artists')
            .insert(
              group.map((a) => ({
                name: a.name ?? '',
                spotify_id: a.spotify_id ?? null,
                genres: a.genres ?? [],
                image_url: a.image_url ?? null,
                thumb_url: a.thumb_url ?? null,
              }))
            )
            .select('id, spotify_id');
          if (insErr) console.error('importArtists insert error:', insErr);
          for (const row of inserted ?? []) {
            if (row.spotify_id) idBySpotify.set(row.spotify_id, row.id);
          }
        }
      }

      // Anything without a spotify id falls back to the single-add path.
      const fallback = unique.filter((a) => !a.spotify_id);
      for (const a of fallback) {
        await addArtist(a, source);
      }

      // Link all the resolved artists to the user, preserving listening rank.
      const links = Array.from(idBySpotify.entries()).map(([spotifyId, artist_id]) => ({
        user_id: userId,
        artist_id,
        source,
        rank: source === 'spotify' ? rankBySpotify.get(spotifyId) ?? null : null,
      }));
      for (const group of chunk(links, 80)) {
        const { error: linkError } = await supabase
          .from('user_artists')
          .upsert(group, { onConflict: 'user_id,artist_id' });
        if (linkError) console.error('importArtists link error:', linkError);
      }

      await fetchArtists();
      return links.length + fallback.length;
    },
    [userId, addArtist, fetchArtists]
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

  // Backfills images + genres for artists imported "bare" (from Liked Songs /
  // playlists). Runs in the background, separate from the import, throttled to
  // stay under Spotify's rate limit. Safe to call fire-and-forget.
  const backfillImages = useCallback(
    async (token: string) => {
      if (!userId || backfillingRef.current) return;
      backfillingRef.current = true;
      try {
        const { data } = await supabase
          .from('user_artists')
          .select('artist:artists(id, name, spotify_id, image_url, genres)')
          .eq('user_id', userId);
        const bare = (data ?? [])
          .map((r: any) => r.artist)
          .filter((a: any) => a && a.spotify_id && !a.image_url);

        let updated = 0;
        for (const a of bare) {
          const full = await fetchArtistByName(token, a.name, a.spotify_id);
          if (full && (full.image_url || full.genres?.length)) {
            await supabase
              .from('artists')
              .update({
                ...(full.image_url && { image_url: full.image_url, thumb_url: full.thumb_url ?? full.image_url }),
                ...(full.genres?.length && { genres: full.genres }),
              })
              .eq('id', a.id);
            updated += 1;
            if (updated % 25 === 0) await fetchArtists();
          }
          // (Throttling handled globally by the gate in spotifyGet.)
        }
        if (updated > 0) await fetchArtists();
      } catch (e) {
        console.error('backfillImages error:', e);
      } finally {
        backfillingRef.current = false;
      }
    },
    [userId, fetchArtists]
  );

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
        // Enrich the bare (Liked Songs/playlist) artists in the background,
        // delayed so user-facing fetches (suggestions, genre tabs) get the
        // shared request queue first.
        setTimeout(() => void backfillImages(token), 15000);
        return count;
      } finally {
        syncingRef.current = false;
      }
    },
    [userId, importArtists]
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

  const value: ArtistsContextValue = {
    userArtists,
    loading,
    addArtist,
    importArtists,
    removeArtist,
    syncLibrary,
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
