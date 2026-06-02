import { Artist, Event } from '../types';

const APP_ID = process.env.EXPO_PUBLIC_BANDSINTOWN_APP_ID ?? 'encore_app';
const BASE_URL = 'https://rest.bandsintown.com';

interface BandsintownEvent {
  id: string;
  title?: string;
  artist: {
    id: string;
    name: string;
    image_url?: string;
    thumb_url?: string;
  };
  venue: {
    name: string;
    city: string;
    region: string;
    country: string;
    latitude: string;
    longitude: string;
  };
  datetime: string;
  offers?: { type: string; url: string; status: string }[];
}

interface BandsintownArtist {
  id: string;
  name: string;
  image_url?: string;
  thumb_url?: string;
  facebook_page_url?: string;
  mbid?: string;
  tracker_count?: number;
}

function normalizeBandsintownEvent(
  ev: BandsintownEvent,
  artistId: string
): Omit<Event, 'id' | 'created_at' | 'artist'> {
  const ticketOffer = ev.offers?.find((o) => o.type === 'Tickets');
  return {
    artist_id: artistId,
    title: ev.title ?? null,
    venue_name: ev.venue.name ?? null,
    venue_city: ev.venue.city ?? null,
    venue_state: ev.venue.region ?? null,
    venue_country: ev.venue.country ?? null,
    venue_lat: ev.venue.latitude ? parseFloat(ev.venue.latitude) : null,
    venue_lng: ev.venue.longitude ? parseFloat(ev.venue.longitude) : null,
    event_date: ev.datetime,
    ticket_url: ticketOffer?.url ?? null,
    bandsintown_id: ev.id,
    ticketmaster_id: null,
    source: 'bandsintown',
  };
}

export async function getArtistEvents(
  artistName: string,
  artistId: string,
  location?: string,
  radius?: number
): Promise<Omit<Event, 'id' | 'created_at' | 'artist'>[]> {
  try {
    let url = `${BASE_URL}/artists/${encodeURIComponent(artistName)}/events?app_id=${APP_ID}&date=upcoming`;
    if (location) url += `&location=${encodeURIComponent(location)}`;
    if (radius) url += `&radius=${radius}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bandsintown events error: ${res.status}`);
    const data: BandsintownEvent[] = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((ev) => normalizeBandsintownEvent(ev, artistId));
  } catch (error) {
    console.error(`getArtistEvents (${artistName}) error:`, error);
    return [];
  }
}

export async function searchArtists(query: string): Promise<Partial<Artist>[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/artists/${encodeURIComponent(query)}?app_id=${APP_ID}`
    );
    if (!res.ok) return [];
    const artist: BandsintownArtist = await res.json();
    if (!artist?.id) return [];

    return [
      {
        name: artist.name,
        bandsintown_id: artist.id,
        image_url: artist.image_url ?? null,
        thumb_url: artist.thumb_url ?? null,
        genres: [],
        spotify_id: null,
        ticketmaster_id: null,
        apple_music_id: null,
      },
    ];
  } catch (error) {
    console.error('searchArtists (Bandsintown) error:', error);
    return [];
  }
}
