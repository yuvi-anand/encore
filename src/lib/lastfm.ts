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
 * Pulls a query parameter out of a redirect URL without relying on `URL` /
 * `searchParams`. React Native's URL implementation does not reliably parse the
 * query string of a custom-scheme URL like `encore://auth/lastfm?token=...`,
 * which silently yielded a null token and made the whole sign-in look like it
 * did nothing at all.
 */
function paramFromUrl(url: string, name: string): string | null {
  const m = url.match(new RegExp(`[?&]${name}=([^&#]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export type LastfmAuthResult =
  | { ok: true; username: string }
  | { ok: false; cancelled: boolean; message: string };

/**
 * Opens Last.fm's own login/sign-up page in a web auth session. After the user
 * signs in (or creates an account) and authorizes, Last.fm redirects back with
 * a one-time token, which we exchange — server-side, via the `lastfm-auth` edge
 * function that holds the shared secret — for the account username. The secret
 * never ships in the app.
 *
 * Returns a discriminated result rather than null-on-everything, so callers can
 * tell "the user backed out" apart from "something is actually broken" and show
 * a real message instead of failing silently.
 */
export async function authenticateLastfm(): Promise<LastfmAuthResult> {
  if (!API_KEY) {
    return { ok: false, cancelled: false, message: 'Last.fm is not configured (missing API key).' };
  }
  try {
    // No trailing slash: Last.fm 301s `/api/auth/` -> `/api/auth`.
    const authUrl =
      `https://www.last.fm/api/auth?api_key=${API_KEY}&cb=${encodeURIComponent(REDIRECT_URI)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { ok: false, cancelled: true, message: 'cancelled' };
    }
    if (result.type !== 'success' || !result.url) {
      return { ok: false, cancelled: false, message: `Sign-in didn’t complete (${result.type}).` };
    }

    const token = paramFromUrl(result.url, 'token');
    if (!token) {
      console.error('lastfm: no token in redirect', result.url);
      return { ok: false, cancelled: false, message: 'Last.fm didn’t return an access token.' };
    }

    const { data, error } = await supabase.functions.invoke('lastfm-auth', { body: { token } });
    if (error) {
      console.error('lastfm-auth invoke failed:', error);
      return { ok: false, cancelled: false, message: `Couldn’t verify with Last.fm: ${error.message}` };
    }
    if (!data?.username) {
      console.error('lastfm-auth returned no username:', data);
      return {
        ok: false,
        cancelled: false,
        message: data?.error ? `Last.fm: ${data.error}` : 'Last.fm didn’t return an account name.',
      };
    }
    return { ok: true, username: data.username as string };
  } catch (e: any) {
    console.error('authenticateLastfm error:', e);
    return { ok: false, cancelled: false, message: e?.message ?? 'Unexpected error signing in.' };
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
 * How much each window counts toward the blended taste score. Recent listening
 * is weighted far above all-time so the ranking reflects what someone is into
 * *now*, while `overall` still surfaces long-standing favourites.
 */
const PERIOD_WEIGHTS: Record<string, number> = {
  '7day': 8,
  '1month': 4,
  '6month': 2,
  overall: 1,
};

const PAGE_LIMIT = 200; // Last.fm allows up to 1000, but 200/page is gentler.
const MAX_PAGES = 3; // up to 600 artists per window — well beyond a typical user.
// Upper bound on how many artists one account contributes. Long-time scrobblers
// can have thousands in the deep tail; every followed artist costs a recurring
// Ticketmaster lookup, so keep the meaningful head and drop the noise.
const MAX_ARTISTS = 500;

/** One page of a user's top artists for a window. Returns [] on any failure. */
async function fetchTopArtistsPage(
  username: string,
  period: string,
  page: number
): Promise<{ artists: LastfmArtist[]; totalPages: number }> {
  try {
    const res = await fetch(
      `${BASE}?method=user.gettopartists&user=${encodeURIComponent(username)}` +
        `&period=${period}&limit=${PAGE_LIMIT}&page=${page}&api_key=${API_KEY}&format=json`
    );
    if (!res.ok) return { artists: [], totalPages: 0 };
    const data = await res.json();
    const raw = data?.topartists?.artist;
    // Last.fm returns a bare object (not an array) when there's exactly one result.
    const artists: LastfmArtist[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const totalPages = parseInt(data?.topartists?.['@attr']?.totalPages ?? '1', 10) || 1;
    return { artists, totalPages };
  } catch (e) {
    console.error(`getLastfmTopArtists (${period} p${page}) error:`, e);
    return { artists: [], totalPages: 0 };
  }
}

/**
 * Pulls a Last.fm user's artists across several listening windows and blends
 * them into one taste-ranked list.
 *
 * Each window contributes `playcount × weight` to an artist's score, with recent
 * windows weighted heaviest — so the returned order is "who they actually listen
 * to", most-listened first. That order becomes the stored rank, which drives how
 * the Artists tab is sorted. Paginates so heavy listeners aren't truncated.
 */
export async function getLastfmTopArtists(username: string): Promise<Partial<Artist>[]> {
  const scores = new Map<string, { artist: LastfmArtist; score: number }>();

  for (const [period, weight] of Object.entries(PERIOD_WEIGHTS)) {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
      const { artists, totalPages: tp } = await fetchTopArtistsPage(username, period, page);
      if (page === 1) totalPages = tp;
      if (artists.length === 0) break;

      for (const a of artists) {
        const name = a?.name?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        // Playcount is the listening-habit signal. Fall back to 1 so an artist
        // with no count still registers rather than scoring zero.
        const plays = parseInt(a.playcount ?? '', 10);
        const contribution = (Number.isFinite(plays) && plays > 0 ? plays : 1) * weight;
        const existing = scores.get(key);
        if (existing) existing.score += contribution;
        else scores.set(key, { artist: a, score: contribution });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ARTISTS)
    .map((entry) => normalize(entry.artist));
}
