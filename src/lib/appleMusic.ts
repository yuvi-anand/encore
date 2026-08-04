import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Artist } from '../types';

WebBrowser.maybeCompleteAuthSession();

const DEVELOPER_TOKEN = process.env.EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN!;
const APPLE_MUSIC_BASE = 'https://api.music.apple.com/v1';

// ⚠️ PLACEHOLDER — NOT FUNCTIONAL. A real Music User Token comes from the
// native MusicKit SDK's authorize() call, NOT Apple ID OAuth. This function
// cannot produce a usable token. To make Apple Music import work you must add a
// native MusicKit module (e.g. a config plugin / custom native module) and call
// its authorize(); see docs/apple-music-setup.md. Kept only as a wiring stub.
export async function connectAppleMusic(): Promise<string | null> {
  // Apple Music uses MusicKit — on native, this requires a native module.
  // In production, implement with a MusicKit native module (authorize()).
  try {
    const result = await WebBrowser.openAuthSessionAsync(
      `https://appleid.apple.com/auth/authorize?response_type=code&client_id=com.encore.app&redirect_uri=encore://auth/apple`,
      'encore://auth/apple'
    );

    if (result.type === 'success') {
      const url = result.url;
      const params = new URLSearchParams(url.split('?')[1]);
      return params.get('code');
    }
    return null;
  } catch (error) {
    console.error('connectAppleMusic error:', error);
    return null;
  }
}

interface AppleMusicArtistItem {
  id: string;
  attributes?: {
    name: string;
    genreNames?: string[];
    artwork?: { url: string; width: number; height: number };
  };
}

function normalizeAppleArtist(item: AppleMusicArtistItem): Partial<Artist> {
  const artwork = item.attributes?.artwork;
  const imageUrl = artwork
    ? artwork.url.replace('{w}', '400').replace('{h}', '400')
    : null;
  const thumbUrl = artwork
    ? artwork.url.replace('{w}', '100').replace('{h}', '100')
    : null;

  return {
    name: item.attributes?.name ?? '',
    apple_music_id: item.id,
    genres: item.attributes?.genreNames ?? [],
    image_url: imageUrl,
    thumb_url: thumbUrl,
    spotify_id: null,
    bandsintown_id: null,
    ticketmaster_id: null,
  };
}

export async function getRecentlyPlayed(userToken: string): Promise<Partial<Artist>[]> {
  try {
    const res = await fetch(`${APPLE_MUSIC_BASE}/me/recent/played/tracks?limit=50&types=songs`, {
      headers: {
        Authorization: `Bearer ${DEVELOPER_TOKEN}`,
        'Music-User-Token': userToken,
      },
    });
    if (!res.ok) throw new Error(`Apple Music recently played error: ${res.status}`);
    const data = await res.json();

    // Extract unique artists from tracks
    const artistIds = new Set<string>();
    const artistPartials: Partial<Artist>[] = [];

    for (const track of data.data ?? []) {
      const relationships = track.relationships?.artists?.data ?? [];
      for (const artist of relationships) {
        if (!artistIds.has(artist.id)) {
          artistIds.add(artist.id);
          artistPartials.push(normalizeAppleArtist(artist));
        }
      }
    }
    return artistPartials;
  } catch (error) {
    console.error('getRecentlyPlayed error:', error);
    return [];
  }
}

/**
 * The moat import: the user's saved Apple Music library artists (paginated).
 * This is the Apple Music equivalent of Spotify's getLibraryArtists. Requires a
 * Music User Token from native MusicKit auth; returns name + genres + artwork.
 */
export async function getAppleMusicLibraryArtists(userToken: string): Promise<Partial<Artist>[]> {
  if (!DEVELOPER_TOKEN || !userToken) return [];
  const out: Partial<Artist>[] = [];
  // Apple returns `next` as a relative path like "/v1/me/library/artists?offset=100".
  let next: string | null = '/v1/me/library/artists?limit=100';
  try {
    while (next) {
      const res = await fetch(`https://api.music.apple.com${next}`, {
        headers: {
          Authorization: `Bearer ${DEVELOPER_TOKEN}`,
          'Music-User-Token': userToken,
        },
      });
      if (!res.ok) break;
      const data: any = await res.json();
      for (const item of data?.data ?? []) {
        if (item?.attributes?.name) out.push(normalizeAppleArtist(item));
      }
      next = data?.next ?? null;
    }
  } catch (error) {
    console.error('getAppleMusicLibraryArtists error:', error);
  }
  return out;
}

export async function searchArtists(query: string, userToken: string): Promise<Partial<Artist>[]> {
  try {
    const res = await fetch(
      `${APPLE_MUSIC_BASE}/catalog/us/search?term=${encodeURIComponent(query)}&types=artists&limit=20`,
      {
        headers: {
          Authorization: `Bearer ${DEVELOPER_TOKEN}`,
          'Music-User-Token': userToken,
        },
      }
    );
    if (!res.ok) throw new Error(`Apple Music search error: ${res.status}`);
    const data = await res.json();
    const items: AppleMusicArtistItem[] = data.results?.artists?.data ?? [];
    return items.map(normalizeAppleArtist);
  } catch (error) {
    console.error('searchArtists (Apple Music) error:', error);
    return [];
  }
}
