import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Artist } from '../types';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

// Last.fm API key is publishable (like a client id). Create one for free at
// https://www.last.fm/api/account/create and put it in EXPO_PUBLIC_LASTFM_API_KEY.
const API_KEY = process.env.EXPO_PUBLIC_LASTFM_API_KEY ?? '';
const BASE = 'https://ws.audioscrobbler.com/2.0/';

// Deep link Last.fm redirects back to after the user authorizes. Must match the
// Callback URL registered on the Last.fm API account (encore://auth/lastfm).
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: 'encore', path: 'auth/lastfm' });

/**
 * Opens Last.fm's own login/sign-up page in a web auth session. After the user
 * signs in (or creates an account) and authorizes, Last.fm redirects back with
 * a one-time token, which we exchange — server-side, via the `lastfm-auth` edge
 * function that holds the shared secret — for the account username. The secret
 * never ships in the app. Returns the username, or null if cancelled/failed.
 */
export async function authenticateLastfm(): Promise<string | null> {
  try {
    const authUrl = `https://www.last.fm/api/auth/?api_key=${API_KEY}&cb=${encodeURIComponent(REDIRECT_URI)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);
    if (result.type !== 'success' || !result.url) return null;

    const token = new URL(result.url).searchParams.get('token');
    if (!token) return null;

    const { data, error } = await supabase.functions.invoke('lastfm-auth', {
      body: { token },
    });
    if (error || !data?.username) {
      console.error('lastfm-auth exchange failed:', error ?? data);
      return null;
    }
    return data.username as string;
  } catch (e) {
    console.error('authenticateLastfm error:', e);
    return null;
  }
}

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
