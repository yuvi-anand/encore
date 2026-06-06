import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Artist, UserArtist } from '../types';
import { useAuth } from './useAuth';

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
    source: 'spotify' | 'apple_music' | 'manual'
  ) => Promise<number>;
  removeArtist: (artistId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

const ArtistsContext = createContext<ArtistsContextValue | undefined>(undefined);

export function ArtistsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [userArtists, setUserArtists] = useState<UserArtistRow[]>([]);
  const [loading, setLoading] = useState(true);

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
      source: 'spotify' | 'apple_music' | 'manual'
    ): Promise<number> => {
      if (!userId || artists.length === 0) return 0;

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

      if (withSpotify.length > 0) {
        const spotifyIds = withSpotify.map((a) => a.spotify_id as string);

        // 1. Find which of these artists already exist.
        const { data: existing, error: selErr } = await supabase
          .from('artists')
          .select('id, spotify_id')
          .in('spotify_id', spotifyIds);
        if (selErr) console.error('importArtists select error:', selErr);
        for (const row of existing ?? []) {
          if (row.spotify_id) idBySpotify.set(row.spotify_id, row.id);
        }

        // 2. Insert the ones that don't exist yet.
        const toInsert = withSpotify.filter((a) => !idBySpotify.has(a.spotify_id as string));
        if (toInsert.length > 0) {
          const { data: inserted, error: insErr } = await supabase
            .from('artists')
            .insert(
              toInsert.map((a) => ({
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
      if (links.length > 0) {
        const { error: linkError } = await supabase
          .from('user_artists')
          .upsert(links, { onConflict: 'user_id,artist_id' });
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

  const value: ArtistsContextValue = {
    userArtists,
    loading,
    addArtist,
    importArtists,
    removeArtist,
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
