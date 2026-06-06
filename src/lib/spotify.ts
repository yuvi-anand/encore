import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Artist } from '../types';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID!;
const REDIRECT_URI = AuthSession.makeRedirectUri({ scheme: 'encore', path: 'auth/spotify' });

// Log the exact redirect URI so it can be registered in the Spotify dashboard.
console.log('[Spotify] Redirect URI to register:', REDIRECT_URI);

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SCOPES = ['user-top-read', 'user-follow-read', 'user-read-email'];

export function useSpotifyAuth() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    },
    discovery
  );

  return { request, response, promptAsync };
}

export async function exchangeSpotifyCode(code: string, codeVerifier: string): Promise<string | null> {
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
      }).toString(),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Spotify token exchange error:', err);
      return null;
    }
    const data = await res.json();
    return data.access_token ?? null;
  } catch (e) {
    console.error('exchangeSpotifyCode error:', e);
    return null;
  }
}

/**
 * Pulls the user's full Spotify library — top artists (all time, 6mo, recent)
 * plus everyone they follow — de-duped by spotify id. This is what populates
 * the app after connecting.
 */
export async function getLibraryArtists(token: string): Promise<Partial<Artist>[]> {
  const [topLong, topMedium, topShort, followed] = await Promise.all([
    getTopArtists(token, 'long_term'),
    getTopArtists(token, 'medium_term'),
    getTopArtists(token, 'short_term'),
    getFollowedArtists(token),
  ]);

  const byId = new Map<string, Partial<Artist>>();
  for (const a of [...topLong, ...topMedium, ...topShort, ...followed]) {
    const key = a.spotify_id ?? a.name ?? '';
    if (key && !byId.has(key)) byId.set(key, a);
  }
  return Array.from(byId.values());
}

function normalizeSpotifyArtist(item: SpotifyArtistItem): Partial<Artist> {
  return {
    name: item.name,
    spotify_id: item.id,
    genres: item.genres ?? [],
    image_url: item.images?.[0]?.url ?? null,
    thumb_url: item.images?.[item.images.length - 1]?.url ?? null,
    bandsintown_id: null,
    ticketmaster_id: null,
    apple_music_id: null,
  };
}

interface SpotifyArtistItem {
  id: string;
  name: string;
  genres?: string[];
  images?: { url: string; width: number; height: number }[];
}

export async function getTopArtists(
  token: string,
  timeRange: 'long_term' | 'medium_term' | 'short_term' = 'long_term'
): Promise<Partial<Artist>[]> {
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/me/top/artists?time_range=${timeRange}&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Spotify top artists error: ${res.status}`);
    const data = await res.json();
    return (data.items as SpotifyArtistItem[]).map(normalizeSpotifyArtist);
  } catch (error) {
    console.error('getTopArtists error:', error);
    return [];
  }
}

export async function getFollowedArtists(token: string): Promise<Partial<Artist>[]> {
  const results: Partial<Artist>[] = [];
  let url: string | null = 'https://api.spotify.com/v1/me/following?type=artist&limit=50';
  try {
    while (url) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Spotify followed artists error: ${res.status}`);
      const data: any = await res.json();
      results.push(...(data.artists?.items as SpotifyArtistItem[]).map(normalizeSpotifyArtist));
      url = data.artists?.next ?? null;
    }
  } catch (error) {
    console.error('getFollowedArtists error:', error);
  }
  return results;
}

export async function searchArtists(query: string, token: string): Promise<Partial<Artist>[]> {
  try {
    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Spotify search error: ${res.status}`);
    const data = await res.json();
    return (data.artists.items as SpotifyArtistItem[]).map(normalizeSpotifyArtist);
  } catch (error) {
    console.error('searchArtists error:', error);
    return [];
  }
}
