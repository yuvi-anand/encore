import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Artist, UserArtist } from '../types';

export function useArtists(userId: string | undefined) {
  const [userArtists, setUserArtists] = useState<(UserArtist & { artist: Artist })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArtists = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('user_artists')
      .select('*, artist:artists(*)')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) {
      console.error('fetchArtists error:', error);
    } else {
      setUserArtists((data ?? []) as (UserArtist & { artist: Artist })[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  const addArtist = useCallback(
    async (artistData: Partial<Artist>, source: 'spotify' | 'apple_music' | 'manual') => {
      if (!userId) return;

      // Upsert artist into artists table
      let artistId: string | null = null;

      // Try to find existing by spotify_id or bandsintown_id or name
      const filters: string[] = [];
      if (artistData.spotify_id) filters.push(`spotify_id.eq.${artistData.spotify_id}`);
      if (artistData.bandsintown_id) filters.push(`bandsintown_id.eq.${artistData.bandsintown_id}`);

      if (filters.length > 0) {
        const { data: existing } = await supabase
          .from('artists')
          .select('id')
          .or(filters.join(','))
          .maybeSingle();
        if (existing) artistId = existing.id;
      }

      if (!artistId) {
        // Check by name
        const { data: byName } = await supabase
          .from('artists')
          .select('id')
          .ilike('name', artistData.name ?? '')
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

        if (insertError) {
          console.error('addArtist insert error:', insertError);
          return;
        }
        artistId = inserted.id;
      } else {
        // Update fields that may be missing
        await supabase.from('artists').update({
          ...(artistData.spotify_id && { spotify_id: artistData.spotify_id }),
          ...(artistData.image_url && { image_url: artistData.image_url }),
          ...(artistData.genres?.length && { genres: artistData.genres }),
        }).eq('id', artistId);
      }

      // Link user <-> artist
      const { error: linkError } = await supabase
        .from('user_artists')
        .upsert({ user_id: userId, artist_id: artistId, source }, { onConflict: 'user_id,artist_id' });

      if (linkError) {
        console.error('addArtist link error:', linkError);
        return;
      }

      await fetchArtists();
    },
    [userId, fetchArtists]
  );

  const removeArtist = useCallback(
    async (artistId: string) => {
      if (!userId) return;
      const { error } = await supabase
        .from('user_artists')
        .delete()
        .eq('user_id', userId)
        .eq('artist_id', artistId);

      if (error) {
        console.error('removeArtist error:', error);
        return;
      }
      setUserArtists((prev) => prev.filter((ua) => ua.artist_id !== artistId));
    },
    [userId]
  );

  return {
    userArtists,
    loading,
    addArtist,
    removeArtist,
    refetch: fetchArtists,
  };
}
