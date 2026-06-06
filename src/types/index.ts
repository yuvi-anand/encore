export interface HomeCity {
  city: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
}

/** Brand colors for streaming-service buttons. */
export const BRAND = {
  spotify: '#1DB954',
  appleMusic: '#FA243C',
} as const;

/** Great-circle distance between two points in miles. */
export function distanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface Profile {
  id: string;
  username: string | null;
  home_cities: HomeCity[];
  notification_radius_miles: number;
  push_token: string | null;
  notify_announcements: boolean;
  notify_week_before: boolean;
  notify_day_before: boolean;
  spotify_token: string | null;
  apple_music_token: string | null;
  created_at: string;
}

export interface Artist {
  id: string;
  name: string;
  bandsintown_id: string | null;
  ticketmaster_id: string | null;
  spotify_id: string | null;
  apple_music_id: string | null;
  genres: string[];
  image_url: string | null;
  thumb_url: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  artist_id: string;
  title: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  venue_country: string | null;
  venue_lat: number | null;
  venue_lng: number | null;
  event_date: string;
  ticket_url: string | null;
  bandsintown_id: string | null;
  ticketmaster_id: string | null;
  source: string | null;
  created_at: string;
  // joined
  artist?: Artist;
}

export interface UserArtist {
  user_id: string;
  artist_id: string;
  source: 'spotify' | 'apple_music' | 'manual';
  added_at: string;
  /** Personal listening rank from Spotify (0 = most listened). Null if unknown. */
  rank: number | null;
  artist?: Artist;
}

export type Genre =
  | 'Electronic'
  | 'Rock'
  | 'Hip-Hop'
  | 'Pop'
  | 'Indie'
  | 'Jazz'
  | 'Metal'
  | 'R&B'
  | 'Country'
  | 'Classical';

export const ALL_GENRES: Genre[] = [
  'Electronic',
  'Rock',
  'Hip-Hop',
  'Pop',
  'Indie',
  'Jazz',
  'Metal',
  'R&B',
  'Country',
  'Classical',
];

// Spotify/Ticketmaster genres are very granular ("bedroom pop", "west coast
// hip hop", "jazz rap"). Each bucket maps to keywords matched on WORD
// boundaries — single words match a whole token, phrases match a substring.
// This avoids "garage rock" landing in Electronic or "alternative hip hop"
// landing in Rock.
export const GENRE_KEYWORDS: Record<Genre, string[]> = {
  Electronic: ['electronic', 'electronica', 'edm', 'house', 'techno', 'trance', 'dubstep', 'idm', 'synthwave', 'ambient', 'drum and bass', 'dnb'],
  Rock: ['rock', 'punk', 'grunge', 'shoegaze', 'garage rock'],
  'Hip-Hop': ['rap', 'trap', 'drill', 'grime', 'hip hop', 'hip-hop', 'boom bap'],
  Pop: ['pop'],
  Indie: ['indie'],
  Jazz: ['jazz', 'bebop', 'swing'],
  Metal: ['metal', 'metalcore', 'deathcore', 'djent', 'hardcore'],
  'R&B': ['soul', 'funk', 'motown', 'r&b', 'rnb'],
  Country: ['country', 'americana', 'bluegrass', 'folk'],
  Classical: ['classical', 'orchestra', 'orchestral', 'baroque', 'opera', 'symphony'],
};

/** True if any of an artist's granular genres falls under the chosen bucket. */
export function artistMatchesGenre(genres: string[] | undefined, genre: Genre): boolean {
  if (!genres || genres.length === 0) return false;
  const keywords = GENRE_KEYWORDS[genre];
  return genres.some((g) => {
    const lower = g.toLowerCase();
    const words = lower.split(/[^a-z0-9&]+/).filter(Boolean);
    return keywords.some((kw) =>
      kw.includes(' ') ? lower.includes(kw) : words.includes(kw)
    );
  });
}

/** Counts how many artists fall into each genre bucket. */
export function genreCounts(
  artistGenres: (string[] | undefined)[]
): Record<Genre, number> {
  const counts = Object.fromEntries(ALL_GENRES.map((g) => [g, 0])) as Record<Genre, number>;
  for (const genres of artistGenres) {
    for (const bucket of ALL_GENRES) {
      if (artistMatchesGenre(genres, bucket)) counts[bucket] += 1;
    }
  }
  return counts;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  event_id: string;
  sent_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      artists: {
        Row: Artist;
        Insert: Omit<Artist, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Artist>;
        Relationships: [];
      };
      user_artists: {
        Row: UserArtist;
        Insert: Omit<UserArtist, 'added_at' | 'artist'> & { added_at?: string };
        Update: Partial<UserArtist>;
        Relationships: [];
      };
      events: {
        Row: Event;
        Insert: Omit<Event, 'id' | 'created_at' | 'artist'> & { id?: string };
        Update: Partial<Event>;
        Relationships: [];
      };
      notification_log: {
        Row: NotificationLog;
        Insert: Omit<NotificationLog, 'id' | 'sent_at'> & { id?: string; sent_at?: string };
        Update: Partial<NotificationLog>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
