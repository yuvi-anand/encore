import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { Artist } from '../types';

WebBrowser.maybeCompleteAuthSession();

const DEVELOPER_TOKEN = process.env.EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN!;
const APPLE_MUSIC_BASE = 'https://api.music.apple.com/v1';

export async function connectAppleMusic(): Promise<string | null> {
  // Apple Music uses MusicKit — on native, this requires native module.
  // Here we use a web-based approach to get a user token via MusicKit JS.
  // In production, implement with react-native-apple-music or a custom native module.
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
