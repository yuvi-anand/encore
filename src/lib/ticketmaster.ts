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
    let url = `${BASE_URL}/events.json?apikey=${API_KEY}&keyword=${encodeURIComponent(artistName)}&classificationName=music&size=50&sort=date,asc`;
    if (city) url += `&city=${encodeURIComponent(city)}`;
    if (radius) url += `&radius=${radius}&unit=miles`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ticketmaster events error: ${res.status}`);
    const data = await res.json();
    const events: TmEvent[] = data._embedded?.events ?? [];
    return events.map((ev) => normalizeTmEvent(ev, artistId));
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
