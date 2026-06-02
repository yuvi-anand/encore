export interface HomeCity {
  city: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
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

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
      };
      artists: {
        Row: Artist;
        Insert: Omit<Artist, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Artist>;
      };
      user_artists: {
        Row: UserArtist;
        Insert: Omit<UserArtist, 'added_at'>;
        Update: Partial<UserArtist>;
      };
      events: {
        Row: Event;
        Insert: Omit<Event, 'id' | 'created_at'> & { id?: string };
        Update: Partial<Event>;
      };
      notification_log: {
        Row: {
          id: string;
          user_id: string;
          event_id: string;
          sent_at: string;
        };
        Insert: {
          user_id: string;
          event_id: string;
        };
        Update: never;
      };
    };
  };
}
