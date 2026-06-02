-- Users extended profile
create table profiles (
  id uuid references auth.users primary key,
  username text,
  home_cities jsonb default '[]'::jsonb,  -- [{city, state, country, lat, lng}]
  notification_radius_miles integer default 50,
  push_token text,
  notify_announcements boolean default true,
  notify_week_before boolean default true,
  notify_day_before boolean default true,
  spotify_token text,
  apple_music_token text,
  created_at timestamptz default now()
);

-- Artists catalog
create table artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bandsintown_id text unique,
  ticketmaster_id text,
  spotify_id text,
  apple_music_id text,
  genres text[] default '{}',
  image_url text,
  thumb_url text,
  created_at timestamptz default now()
);

-- User <-> artist tracking
create table user_artists (
  user_id uuid references profiles(id) on delete cascade,
  artist_id uuid references artists(id) on delete cascade,
  source text not null, -- 'spotify', 'apple_music', 'manual'
  added_at timestamptz default now(),
  primary key (user_id, artist_id)
);

-- Events / shows
create table events (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references artists(id) on delete cascade,
  title text,
  venue_name text,
  venue_city text,
  venue_state text,
  venue_country text,
  venue_lat numeric,
  venue_lng numeric,
  event_date timestamptz,
  ticket_url text,
  bandsintown_id text unique,
  ticketmaster_id text unique,
  source text,
  created_at timestamptz default now()
);

-- Notifications sent log
create table notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  sent_at timestamptz default now(),
  unique(user_id, event_id)
);

-- RLS
alter table profiles enable row level security;
alter table user_artists enable row level security;
alter table notification_log enable row level security;

create policy "users own their profile" on profiles for all using (auth.uid() = id);
create policy "users own their artists" on user_artists for all using (auth.uid() = user_id);
create policy "users own their notifications" on notification_log for all using (auth.uid() = user_id);
create policy "artists are public" on artists for select using (true);
create policy "events are public" on events for select using (true);

-- Allow authenticated users to insert/update artists (needed for sync)
create policy "authenticated users can upsert artists" on artists
  for insert with check (auth.uid() is not null);
create policy "authenticated users can update artists" on artists
  for update using (auth.uid() is not null);

-- Allow authenticated users to insert events
create policy "authenticated users can upsert events" on events
  for insert with check (auth.uid() is not null);
create policy "authenticated users can update events" on events
  for update using (auth.uid() is not null);
