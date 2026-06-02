import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Artist } from '../types';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID!;
const REDIRECT_URI = process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI ?? AuthSession.makeRedirectUri({ scheme: 'encore', path: 'auth/spotify' });

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SCOPES = [
  'user-top-read',
  'user-follow-read',
  'user-read-email',
].join(' ');

export function useSpotifyAuth() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: SCOPES.split(' '),
      redirectUri: REDIRECT_URI,
      responseType: AuthSession.ResponseType.Token,
    },
    discovery
  );

  return { request, response, promptAsync };
}

export async function connectSpotify(): Promise<string | null> {
  try {
    const result = await AuthSession.startAsync({
      authUrl: `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`,
      returnUrl: REDIRECT_URI,
    });

    if (result.type === 'success' && result.params.access_token) {
      return result.params.access_token;
    }
    return null;
  } catch (error) {
    console.error('Spotify connect error:', error);
    return null;
  }
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

export async function getTopArtists(token: string): Promise<Partial<Artist>[]> {
  try {
    const res = await fetch(
      'https://api.spotify.com/v1/me/top/artists?time_range=long_term&limit=50',
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
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Spotify followed artists error: ${res.status}`);
      const data = await res.json();
      const items = data.artists?.items as SpotifyArtistItem[];
      results.push(...items.map(normalizeSpotifyArtist));
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
    console.error('searchArtists (Spotify) error:', error);
    return [];
  }
}
