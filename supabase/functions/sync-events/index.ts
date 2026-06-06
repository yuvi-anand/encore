// Supabase Edge Function: sync-events
//
// Runs on a schedule. For every artist any user follows, it fetches upcoming
// Ticketmaster shows, stores them, detects NEW shows, and sends a push
// notification to each follower whose home city is within their radius.
//
// Deploy:   supabase functions deploy sync-events --no-verify-jwt
// Secrets:  supabase secrets set TICKETMASTER_API_KEY=...
// Schedule: see supabase/schema_cron.sql

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TM_KEY = Deno.env.get('TICKETMASTER_API_KEY')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const TM_BASE = 'https://app.ticketmaster.com/discovery/v2';

// ---- helpers (mirrored from the app) -------------------------------------

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
  'tribute', 'cover band', 'covers', 'karaoke', 'experience', 'celebration of',
  'songs of', 'music of', 'reimagined', 'as performed by', 'salute', 'homage', 'a night of',
];

function eventIsRealArtist(ev: any, artistName: string): boolean {
  const target = normalizeName(artistName);
  const attractions = ev._embedded?.attractions ?? [];
  const hay = [ev.name, ...attractions.map((a: any) => a.name)]
    .filter(Boolean)
    .map((s: string) => s.toLowerCase());
  if (hay.some((h: string) => TRIBUTE_TERMS.some((t) => h.includes(t)))) return false;
  if (attractions.length === 0) return false;
  return attractions.some((a: any) => normalizeName(a.name) === target);
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeEvent(ev: any, artistId: string) {
  const venue = ev._embedded?.venues?.[0];
  const dt =
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
    event_date: dt ?? new Date().toISOString(),
    ticket_url: ev.url ?? null,
    bandsintown_id: null,
    ticketmaster_id: ev.id,
    source: 'ticketmaster',
  };
}

async function fetchArtistEvents(name: string, artistId: string) {
  const start = new Date().toISOString().split('.')[0] + 'Z';
  const url =
    `${TM_BASE}/events.json?apikey=${TM_KEY}&keyword=${encodeURIComponent(name)}` +
    `&classificationName=music&size=50&sort=date,asc&startDateTime=${start}`;
  let res = await fetch(url);
  for (let i = 0; res.status === 429 && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    res = await fetch(url);
  }
  if (!res.ok) return [];
  const data = await res.json();
  const events = data._embedded?.events ?? [];
  return events.filter((e: any) => eventIsRealArtist(e, name)).map((e: any) => normalizeEvent(e, artistId));
}

async function sendPush(messages: any[]) {
  // Expo push API accepts batches of up to 100.
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

// ---- main ----------------------------------------------------------------

Deno.serve(async () => {
  // 1. All artists any user follows.
  const { data: links } = await supabase.from('user_artists').select('user_id, artist_id');
  const artistIds = [...new Set((links ?? []).map((l) => l.artist_id))];
  if (artistIds.length === 0) return new Response(JSON.stringify({ ok: true, new: 0 }));

  const { data: artists } = await supabase.from('artists').select('id, name').in('id', artistIds);

  // 2. Which Ticketmaster events do we already know about?
  const { data: existing } = await supabase
    .from('events')
    .select('ticketmaster_id')
    .not('ticketmaster_id', 'is', null);
  const knownIds = new Set((existing ?? []).map((e) => e.ticketmaster_id));

  // 3. Fetch + store; collect the brand-new ticketmaster ids.
  const newTmIds = new Set<string>();
  for (const artist of artists ?? []) {
    const evs = await fetchArtistEvents(artist.name, artist.id);
    if (evs.length === 0) continue;
    const deduped = new Map<string, any>();
    for (const e of evs) deduped.set(e.ticketmaster_id, e);
    const rows = [...deduped.values()];
    await supabase.from('events').upsert(rows, { onConflict: 'ticketmaster_id' });
    for (const e of rows) if (!knownIds.has(e.ticketmaster_id)) newTmIds.add(e.ticketmaster_id);
    await new Promise((r) => setTimeout(r, 200)); // gentle throttle
  }

  if (newTmIds.size === 0) return new Response(JSON.stringify({ ok: true, new: 0 }));

  // 4. Load the new events (with their DB ids) and the data needed to target users.
  const { data: newEvents } = await supabase
    .from('events')
    .select('*')
    .in('ticketmaster_id', [...newTmIds]);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, push_token, notify_announcements, notification_radius_miles, home_cities');

  const followersByArtist = new Map<string, string[]>();
  for (const l of links ?? []) {
    const arr = followersByArtist.get(l.artist_id) ?? [];
    arr.push(l.user_id);
    followersByArtist.set(l.artist_id, arr);
  }

  const messages: any[] = [];
  const logRows: { user_id: string; event_id: string }[] = [];

  for (const ev of newEvents ?? []) {
    if (ev.venue_lat == null || ev.venue_lng == null) continue;
    const followers = followersByArtist.get(ev.artist_id) ?? [];
    for (const uid of followers) {
      const p = (profiles ?? []).find((x) => x.id === uid);
      if (!p?.push_token || p.notify_announcements === false) continue;
      const homes = (p.home_cities ?? []).filter((c: any) => c.lat || c.lng);
      const radius = p.notification_radius_miles ?? 50;
      const inRange = homes.some(
        (c: any) => distanceMiles(c.lat, c.lng, ev.venue_lat, ev.venue_lng) <= radius
      );
      if (!inRange) continue;

      const { data: artistRow } = await supabase
        .from('artists')
        .select('name')
        .eq('id', ev.artist_id)
        .single();
      const artistName = artistRow?.name ?? 'An artist you follow';

      messages.push({
        to: p.push_token,
        title: `${artistName} just announced a show`,
        body: `${ev.venue_city ? `${ev.venue_city} — ` : ''}tap for tickets and details.`,
        data: { eventId: ev.id, artistId: ev.artist_id },
        sound: 'default',
      });
      logRows.push({ user_id: uid, event_id: ev.id });
    }
  }

  // 5. Dedupe against notification_log, send, and record.
  if (logRows.length > 0) {
    const { data: alreadySent } = await supabase
      .from('notification_log')
      .select('user_id, event_id')
      .in(
        'event_id',
        logRows.map((r) => r.event_id)
      );
    const sentKey = new Set((alreadySent ?? []).map((r) => `${r.user_id}:${r.event_id}`));

    const toSend: any[] = [];
    const toLog: { user_id: string; event_id: string }[] = [];
    messages.forEach((m, i) => {
      const key = `${logRows[i].user_id}:${logRows[i].event_id}`;
      if (!sentKey.has(key)) {
        toSend.push(m);
        toLog.push(logRows[i]);
      }
    });

    if (toSend.length > 0) {
      await sendPush(toSend);
      await supabase.from('notification_log').upsert(toLog, { onConflict: 'user_id,event_id' });
    }

    return new Response(JSON.stringify({ ok: true, new: newTmIds.size, pushed: toSend.length }));
  }

  return new Response(JSON.stringify({ ok: true, new: newTmIds.size, pushed: 0 }));
});
