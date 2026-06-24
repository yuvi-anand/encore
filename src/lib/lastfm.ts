import { Artist } from '../types';

// Last.fm API key is publishable (like a client id). Create one for free at
// https://www.last.fm/api/account/create and put it in EXPO_PUBLIC_LASTFM_API_KEY.
const API_KEY = process.env.EXPO_PUBLIC_LASTFM_API_KEY ?? '';
const BASE = 'https://ws.audioscrobbler.com/2.0/';

interface LastfmArtist {
  name: string;
  mbid?: string;
  playcount?: string;
}

function normalize(a: LastfmArtist): Partial<Artist> {
  return {
    name: a.name,
    // Last.fm doesn't reliably give images/genres anymore; the app enriches
    // these from Spotify catalog search (client-credentials) separately.
    genres: [],
    image_url: null,
    thumb_url: null,
    spotify_id: null,
    bandsintown_id: null,
    ticketmaster_id: null,
    apple_music_id: null,
  };
}

/** Confirms a Last.fm username exists (and has public listening data). */
export async function lastfmUserExists(username: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${BASE}?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${API_KEY}&format=json`
    );
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.user?.name;
  } catch {
    return false;
  }
}

/**
 * Pulls a Last.fm user's artists — their top artists across recent and all-time
 * windows, deduped. Captures evolving taste and the long tail (any artist they
 * have scrobbled shows up). Ordered most-listened first (for rank).
 */
export async function getLastfmTopArtists(username: string): Promise<Partial<Artist>[]> {
  const periods = ['1month', '6month', 'overall'];
  const byName = new Map<string, Partial<Artist>>();
  for (const period of periods) {
    try {
      const res = await fetch(
        `${BASE}?method=user.gettopartists&user=${encodeURIComponent(username)}&period=${period}&limit=200&api_key=${API_KEY}&format=json`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const artists: LastfmArtist[] = data?.topartists?.artist ?? [];
      for (const a of artists) {
        const key = a.name?.toLowerCase();
        if (key && !byName.has(key)) byName.set(key, normalize(a));
      }
    } catch (e) {
      console.error(`getLastfmTopArtists (${period}) error:`, e);
    }
  }
  return Array.from(byName.values());
}
