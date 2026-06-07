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

const SCOPES = [
  'user-top-read',
  'user-follow-read',
  'user-read-email',
  'user-library-read',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
];

export function useSpotifyAuth() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // Force the consent screen so newly-added scopes actually get granted.
      extraParams: { show_dialog: 'true' },
    },
    discovery
  );

  return { request, response, promptAsync };
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
}

export async function exchangeSpotifyCode(
  code: string,
  codeVerifier: string
): Promise<SpotifyTokens | null> {
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
      console.error('Spotify token exchange error:', await res.text());
      return null;
    }
    const data = await res.json();
    if (!data.access_token) return null;
    return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null };
  } catch (e) {
    console.error('exchangeSpotifyCode error:', e);
    return null;
  }
}

/**
 * Returns a usable access token, refreshing via the stored refresh token when
 * possible (access tokens expire after ~1 hour). Calls onRefreshed so the new
 * tokens can be persisted.
 */
export async function getValidSpotifyToken(
  accessToken: string | null,
  refreshToken: string | null,
  onRefreshed: (tokens: SpotifyTokens) => void
): Promise<string | null> {
  if (refreshToken) {
    const t = await refreshSpotifyAccessToken(refreshToken);
    if (t) {
      onRefreshed(t);
      return t.accessToken;
    }
  }
  return accessToken;
}

/** Exchanges a stored refresh token for a fresh access token. */
export async function refreshSpotifyAccessToken(
  refreshToken: string
): Promise<SpotifyTokens | null> {
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    });
    if (!res.ok) {
      console.error('Spotify refresh error:', await res.text());
      return null;
    }
    const data = await res.json();
    if (!data.access_token) return null;
    // Spotify may or may not return a new refresh token.
    return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken };
  } catch (e) {
    console.error('refreshSpotifyAccessToken error:', e);
    return null;
  }
}

// Diagnostics from the most recent getLibraryArtists() call.
export let lastImportStats = { top: 0, followed: 0, saved: 0, playlists: 0, extraIds: 0, hydrated: 0, total: 0, hydrateStatus: '' };

// Captures the first failure during a library fetch, for diagnostics.
export let lastSpotifyError = '';

// Global request gate: serializes EVERY Spotify GET through one chain spaced
// ~280ms apart, so no combination of features (backfill + suggestions + genre)
// can burst past Spotify's rate limit and starve each other into empty results.
let spotifyGate: Promise<void> = Promise.resolve();
function gate(): Promise<void> {
  const next = spotifyGate.then(() => new Promise<void>((r) => setTimeout(r, 280)));
  spotifyGate = next;
  return next;
}

// Last non-OK HTTP status seen, for diagnostics.
export let lastSpotifyStatus = '';

async function spotifyGet(url: string, token: string): Promise<any | null> {
  try {
    await gate();
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    // Retry on 429, but NEVER wait on a long cooldown — if Spotify says wait
    // more than a couple seconds, fail fast so we don't hang the whole app.
    for (let i = 0; res.status === 429 && i < 2; i++) {
      const retry = parseInt(res.headers.get('Retry-After') ?? '1', 10);
      if (retry > 3) break; // long rate-limit cooldown — give up immediately
      await new Promise((r) => setTimeout(r, (retry || 1) * 1000));
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) {
      lastSpotifyStatus = `${res.status} ${url.split('/v1/')[1]?.split('?')[0] ?? ''}`;
      return null;
    }
    return await res.json();
  } catch (e: any) {
    lastSpotifyStatus = `err ${e?.message ?? e}`;
    return null;
  }
}

/** Simplified {id,name} artist refs from the user's Liked Songs. */
async function getSavedTrackArtistRefs(token: string, maxPages = 4): Promise<{ id: string; name: string }[]> {
  const refs: { id: string; name: string }[] = [];
  let url: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50';
  for (let page = 0; url && page < maxPages; page++) {
    const data: any = await spotifyGet(url, token);
    if (!data) break;
    for (const item of data.items ?? []) {
      for (const a of item.track?.artists ?? []) {
        if (a?.id) refs.push({ id: a.id, name: a.name });
      }
    }
    url = data.next ?? null;
  }
  return refs;
}

/** Simplified artist refs from the user's playlists (capped to stay fast). */
async function getPlaylistArtistRefs(
  token: string,
  maxPlaylists = 25,
  maxTracksPerPlaylist = 100
): Promise<{ id: string; name: string }[]> {
  const refs: { id: string; name: string }[] = [];
  const playlists: any = await spotifyGet(
    `https://api.spotify.com/v1/me/playlists?limit=${maxPlaylists}`,
    token
  );
  for (const pl of playlists?.items ?? []) {
    let url: string | null = `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50&fields=next,items(track(artists(id,name)))`;
    let fetched = 0;
    while (url && fetched < maxTracksPerPlaylist) {
      const data: any = await spotifyGet(url, token);
      if (!data) break;
      for (const item of data.items ?? []) {
        for (const a of item.track?.artists ?? []) {
          if (a?.id) refs.push({ id: a.id, name: a.name });
        }
      }
      fetched += (data.items ?? []).length;
      url = data.next ?? null;
    }
  }
  return refs;
}

/** Fetches full artist objects (with genres + images) for the given ids. */
// Spotify's batch /artists endpoint 403s for newer apps, so we enrich artists
// via /search (by name, matched back to the known id), which works.
async function hydrateArtists(
  token: string,
  refs: { id: string; name: string }[]
): Promise<Partial<Artist>[]> {
  const out: Partial<Artist>[] = [];
  for (const ref of refs) {
    if (!ref.name) continue;
    const data: any = await spotifyGet(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(ref.name)}&type=artist&limit=5`,
      token
    );
    const items: SpotifyArtistItem[] = data?.artists?.items ?? [];
    const match = items.find((a) => a.id === ref.id) ?? items[0];
    if (match) out.push(normalizeSpotifyArtist(match));
    // (Throttling handled globally by the gate in spotifyGet.)
  }
  return out;
}

/**
 * Pulls the user's full Spotify library — top artists (3 time ranges) and
 * follows (full objects), plus artists from Liked Songs and playlists
 * (hydrated to full objects). De-duped by spotify id, ranked top-first.
 */
export async function getLibraryArtists(token: string): Promise<Partial<Artist>[]> {
  lastSpotifyError = '';
  // Sequential, not parallel — a burst of parallel requests is what trips
  // Spotify's rate limiter. Playlists are skipped (huge request cost, little
  // payoff); Liked Songs covers the user's real listening.
  const topLong = await getTopArtists(token, 'long_term');
  const topMedium = await getTopArtists(token, 'medium_term');
  const topShort = await getTopArtists(token, 'short_term');
  const followed = await getFollowedArtists(token);
  const savedRefs = await getSavedTrackArtistRefs(token);
  const playlistRefs: { id: string; name: string }[] = [];

  lastImportStats = {
    top: topLong.length + topMedium.length + topShort.length,
    followed: followed.length,
    saved: savedRefs.length,
    playlists: playlistRefs.length,
    extraIds: 0,
    hydrated: 0,
    total: 0,
    hydrateStatus: '',
  };

  // Full objects first (preserve ranking order: top long → medium → short → followed).
  const byId = new Map<string, Partial<Artist>>();
  for (const a of [...topLong, ...topMedium, ...topShort, ...followed]) {
    if (a.spotify_id && !byId.has(a.spotify_id)) byId.set(a.spotify_id, a);
  }

  // Count how often each artist appears across saved tracks + playlists, and
  // only keep ones that recur — this filters out one-off featured artists and
  // random collaborators the user doesn't actually listen to.
  const MIN_OCCURRENCES = 2;
  const counts = new Map<string, number>();
  const refName = new Map<string, string>();
  for (const r of [...savedRefs, ...playlistRefs]) {
    if (!r.id) continue;
    counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    if (!refName.has(r.id)) refName.set(r.id, r.name);
  }

  // Add recurring liked/playlist artists as bare entries (name + id). We do NOT
  // hydrate images/genres here — that's slow and would hold up the import. The
  // app backfills images/genres for these in the background afterward.
  const extraRefs = [...counts.entries()]
    .filter(([id, n]) => n >= MIN_OCCURRENCES && !byId.has(id))
    .map(([id]) => ({ id, name: refName.get(id) ?? '' }));
  for (const ref of extraRefs) {
    byId.set(ref.id, {
      name: ref.name,
      spotify_id: ref.id,
      genres: [],
      image_url: null,
      thumb_url: null,
      bandsintown_id: null,
      ticketmaster_id: null,
      apple_music_id: null,
    });
  }

  lastImportStats.extraIds = extraRefs.length;
  lastImportStats.total = byId.size;
  return Array.from(byId.values());
}

/**
 * Looks up a single artist by name via /search (the batch /artists endpoint
 * 403s for newer apps) and returns the full object, matched back to the id.
 */
export async function fetchArtistByName(
  token: string,
  name: string,
  spotifyId: string
): Promise<Partial<Artist> | null> {
  if (!name) return null;
  const data: any = await spotifyGet(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=5`,
    token
  );
  const items: SpotifyArtistItem[] = data?.artists?.items ?? [];
  const match = items.find((a) => a.id === spotifyId) ?? items[0];
  return match ? normalizeSpotifyArtist(match) : null;
}

/**
 * Artists to suggest in Discover: from the user's top tracks + recently played,
 * hydrated to full objects. Caller filters out already-followed artists.
 */
/**
 * Batch-fetches full artist objects (photos + genres) in one call per 50 ids
 * via /artists. Far cheaper than per-artist /search. Returns [] if the endpoint
 * is unavailable (some apps get 403) so the caller can fall back.
 */
export async function fetchArtistsByIds(
  token: string,
  ids: string[]
): Promise<Partial<Artist>[]> {
  const out: Partial<Artist>[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data: any = await spotifyGet(
      `https://api.spotify.com/v1/artists?ids=${batch.join(',')}`,
      token
    );
    for (const a of data?.artists ?? []) if (a) out.push(normalizeSpotifyArtist(a));
  }
  return out;
}

/**
 * Top artists within a genre via Spotify's `genre:` search filter, with a plain
 * keyword fallback. On-demand (one call per genre tab, cached by the caller),
 * so it stays well within rate limits. Results include images + genres.
 */
export async function searchArtistsByGenre(
  token: string,
  genreTerm: string
): Promise<Partial<Artist>[]> {
  const q = genreTerm.includes(' ') ? `genre:"${genreTerm}"` : `genre:${genreTerm}`;
  let data: any = await spotifyGet(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=artist&limit=25`,
    token
  );
  let items: SpotifyArtistItem[] = data?.artists?.items ?? [];
  const genreCount = items.length;
  let fallbackCount = -1;
  if (items.length === 0) {
    // Fallback: plain keyword search if the genre filter returns nothing.
    data = await spotifyGet(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(genreTerm)}&type=artist&limit=25`,
      token
    );
    items = data?.artists?.items ?? [];
    fallbackCount = items.length;
  }
  console.log(`[GenreSearch] ${genreTerm} genre:${genreCount} fallback:${fallbackCount} status:${lastSpotifyStatus || 'ok'}`);
  return items.map(normalizeSpotifyArtist);
}

export async function getSuggestedArtists(token: string): Promise<Partial<Artist>[]> {
  const [topTracks, recent] = await Promise.all([
    spotifyGet('https://api.spotify.com/v1/me/top/tracks?time_range=medium_term&limit=50', token),
    spotifyGet('https://api.spotify.com/v1/me/player/recently-played?limit=50', token),
  ]);

  const refs = new Map<string, string>();
  for (const t of topTracks?.items ?? []) {
    for (const a of t.artists ?? []) if (a?.id && !refs.has(a.id)) refs.set(a.id, a.name);
  }
  for (const item of recent?.items ?? []) {
    for (const a of item.track?.artists ?? []) if (a?.id && !refs.has(a.id)) refs.set(a.id, a.name);
  }

  // Bare entries (name + id); real artist photos are loaded by the caller.
  const result: Partial<Artist>[] = [...refs.entries()].slice(0, 40).map(([id, name]) => ({
    name,
    spotify_id: id,
    genres: [],
    image_url: null,
    thumb_url: null,
    bandsintown_id: null,
    ticketmaster_id: null,
    apple_music_id: null,
  }));
  return result;
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
    if (!res.ok) {
      const body = await res.text();
      lastSpotifyError = `top ${res.status}: ${body.slice(0, 80)}`;
      throw new Error(`Spotify top artists error: ${res.status}`);
    }
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
