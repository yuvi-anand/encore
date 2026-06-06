import { Artist, Event } from '../types';

const API_KEY = process.env.EXPO_PUBLIC_TICKETMASTER_API_KEY!;
const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';

interface TmEvent {
  id: string;
  name: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string };
  };
  _embedded?: {
    venues?: TmVenue[];
    attractions?: TmAttraction[];
  };
  url?: string;
}

interface TmVenue {
  name: string;
  city?: { name: string };
  state?: { name: string };
  country?: { name: string };
  location?: { latitude: string; longitude: string };
}

interface TmAttraction {
  id: string;
  name: string;
  images?: { url: string; width: number; height: number; ratio: string }[];
  classifications?: { genre?: { name: string } }[];
}

/** Lowercase, strip accents and punctuation for name comparison. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRIBUTE_TERMS = [
  'tribute',
  'cover band',
  'covers',
  'karaoke',
  'experience',
  'celebration of',
  'songs of',
  'music of',
  'reimagined',
  'as performed by',
  'salute',
  'homage',
  'a night of',
];

/**
 * Verifies an event genuinely features the artist — not a tribute/cover act.
 * Ticketmaster keyword search returns "Sade Tribute" when searching "Sade",
 * so we require one of the event's attractions to match the artist name
 * exactly and reject anything that looks like a tribute.
 */
function eventIsRealArtist(ev: TmEvent, artistName: string): boolean {
  const target = normalizeName(artistName);
  const attractions = ev._embedded?.attractions ?? [];

  // Reject obvious tribute phrasing anywhere in the event/attraction names.
  const haystacks = [ev.name, ...attractions.map((a) => a.name)]
    .filter(Boolean)
    .map((s) => (s as string).toLowerCase());
  if (haystacks.some((h) => TRIBUTE_TERMS.some((t) => h.includes(t)))) return false;

  // Require an exact attraction-name match to the artist.
  if (attractions.length === 0) return false;
  return attractions.some((a) => normalizeName(a.name) === target);
}

function normalizeTmEvent(
  ev: TmEvent,
  artistId: string
): Omit<Event, 'id' | 'created_at' | 'artist'> {
  const venue = ev._embedded?.venues?.[0];
  const dateTime =
    ev.dates?.start?.dateTime ??
    (ev.dates?.start?.localDate
      ? `${ev.dates.start.localDate}T${ev.dates.start.localTime ?? '00:00:00'}`
      : null);

  return {
    artist_id: artistId,
    title: ev.name ?? null,
    venue_name: venue?.name ?? null,
    venue_city: venue?.city?.name ?? null,
    venue_state: venue?.state?.name ?? null,
    venue_country: venue?.country?.name ?? null,
    venue_lat: venue?.location?.latitude ? parseFloat(venue.location.latitude) : null,
    venue_lng: venue?.location?.longitude ? parseFloat(venue.location.longitude) : null,
    event_date: dateTime ?? new Date().toISOString(),
    ticket_url: ev.url ?? null,
    bandsintown_id: null,
    ticketmaster_id: ev.id,
    source: 'ticketmaster',
  };
}

function normalizeTmAttraction(attr: TmAttraction): Partial<Artist> {
  const image = attr.images?.find((i) => i.ratio === '16_9') ?? attr.images?.[0];
  const genres = attr.classifications
    ?.map((c) => c.genre?.name)
    .filter((g): g is string => !!g && g !== 'Undefined');

  return {
    name: attr.name,
    ticketmaster_id: attr.id,
    image_url: image?.url ?? null,
    thumb_url: image?.url ?? null,
    genres: genres ?? [],
    spotify_id: null,
    bandsintown_id: null,
    apple_music_id: null,
  };
}

export async function searchEvents(
  artistName: string,
  artistId: string,
  city?: string,
  radius?: number
): Promise<Omit<Event, 'id' | 'created_at' | 'artist'>[]> {
  try {
    const startDateTime = new Date().toISOString().split('.')[0] + 'Z';
    let url = `${BASE_URL}/events.json?apikey=${API_KEY}&keyword=${encodeURIComponent(artistName)}&classificationName=music&size=50&sort=date,asc&startDateTime=${startDateTime}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (radius) url += `&radius=${radius}&unit=miles`;

    // Retry on rate-limit (429) with simple backoff.
    let res = await fetch(url);
    for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      res = await fetch(url);
    }
    if (!res.ok) throw new Error(`Ticketmaster events error: ${res.status}`);
    const data = await res.json();
    const events: TmEvent[] = data._embedded?.events ?? [];
    return events
      .filter((ev) => eventIsRealArtist(ev, artistName))
      .map((ev) => normalizeTmEvent(ev, artistId));
  } catch (error) {
    console.error(`searchEvents (${artistName}) error:`, error);
    return [];
  }
}

export async function searchAttractions(query: string): Promise<Partial<Artist>[]> {
  try {
    const url = `${BASE_URL}/attractions.json?apikey=${API_KEY}&keyword=${encodeURIComponent(query)}&classificationName=music&size=20`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ticketmaster attractions error: ${res.status}`);
    const data = await res.json();
    const attractions: TmAttraction[] = data._embedded?.attractions ?? [];
    return attractions.map(normalizeTmAttraction);
  } catch (error) {
    console.error('searchAttractions error:', error);
    return [];
  }
}
