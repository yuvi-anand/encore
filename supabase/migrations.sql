-- ============================================================================
-- Run these in the Supabase SQL Editor (in order).
-- ============================================================================

-- 0. Spotify refresh token (for background library re-sync) ------------------
alter table profiles add column if not exists spotify_refresh_token text;

-- 0b. Genre artists (server-seeded top artists per genre for Discover) --------
create table if not exists genre_artists (
  genre text not null,
  spotify_id text not null,
  name text not null,
  image_url text,
  thumb_url text,
  genres text[] default '{}',
  rank int default 0,
  primary key (genre, spotify_id)
);
alter table genre_artists enable row level security;
drop policy if exists "genre_artists are public" on genre_artists;
create policy "genre_artists are public" on genre_artists for select using (true);

-- 1. Account deletion -------------------------------------------------------
-- SECURITY DEFINER so an authenticated user can delete *their own* account
-- (profile data cascades via FKs, then the auth row).
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;


-- 2. Schedule the new-show announcement job ---------------------------------
-- Requires the pg_cron and pg_net extensions (enable in Dashboard → Database →
-- Extensions, or below). Replace <PROJECT_REF> and <SERVICE_ROLE_KEY>.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Runs every 4 hours. Calls the deployed sync-events Edge Function.
select cron.schedule(
  'encore-sync-events',
  '0 */4 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- To remove the job later:
--   select cron.unschedule('encore-sync-events');


-- 3. Per-artist tour-check throttle -----------------------------------------
-- Lets sync-events poll each artist at most every ~2h regardless of how often
-- the cron fires. Without this column the function still works — it just checks
-- every followed artist on every run.
alter table artists add column if not exists last_checked_at timestamptz;
create index if not exists artists_last_checked_at_idx on artists (last_checked_at);

-- Optional: with the throttle in place you can safely run the cron more often
-- (e.g. hourly) for fresher announcements, since each artist is still rate-
-- limited to ~2h. To switch to hourly:
--   select cron.unschedule('encore-sync-events');
--   -- then re-run the cron.schedule above with '0 * * * *' instead of '0 */4 * * *'.

-- 4. Last.fm account link ----------------------------------------------------
-- Without this column every attempt to save a Last.fm connection failed, so the
-- connection never persisted and the background import (which keys off
-- profiles.lastfm_username) never ran.
alter table profiles add column if not exists lastfm_username text;
