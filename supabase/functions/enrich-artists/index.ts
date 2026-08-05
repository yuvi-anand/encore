// Supabase Edge Function: enrich-artists
//
// Fills in images + genres for "bare" artists (no image_url) — e.g. anything
// imported from Last.fm, which returns names only. Uses a Spotify APP token
// (client credentials, not any user's token) to search each name and copy over
// artwork + genres. This is what makes Last.fm-imported artists show real photos
// and land in the correct genre buckets, without needing a user's Spotify login.
//
// Deploy:  supabase functions deploy enrich-artists
// Secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
// Call:    supabase.functions.invoke('enrich-artists', { body: { artistIds? } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getAppToken(): Promise<string | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    console.error('spotify token error', await res.text());
    return null;
  }
  return (await res.json()).access_token ?? null;
}

Deno.serve(async (req) => {
  let artistIds: string[] | undefined;
  try {
    artistIds = (await req.json())?.artistIds;
  } catch {
    // no body — enrich globally
  }

  const token = await getAppToken();
  if (!token) return json({ ok: false, error: 'no spotify token' }, 500);

  // Bare artists (missing artwork), bounded per run to keep well under the
  // function time limit and Spotify's shared rate budget.
  let query = supabase
    .from('artists')
    .select('id, name, spotify_id')
    .is('image_url', null)
    .limit(120);
  if (artistIds && artistIds.length) query = query.in('id', artistIds);
  const { data: bare } = await query;

  let enriched = 0;
  for (const a of bare ?? []) {
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(a.name)}&type=artist&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        await sleep(300);
        continue;
      }
      const items: any[] = (await res.json())?.artists?.items ?? [];
      if (items.length === 0) {
        await sleep(150);
        continue;
      }
      const target = norm(a.name);
      const match = items.find((it) => norm(it.name) === target) ?? items[0];
      const image = match.images?.[0]?.url ?? null;
      const thumb = match.images?.[match.images.length - 1]?.url ?? null;
      const genres: string[] = match.genres ?? [];
      if (image || genres.length) {
        await supabase
          .from('artists')
          .update({
            ...(image && { image_url: image, thumb_url: thumb }),
            ...(genres.length && { genres }),
            ...(!a.spotify_id && match.id && { spotify_id: match.id }),
          })
          .eq('id', a.id);
        enriched += 1;
      }
    } catch (e) {
      console.error('enrich error for', a.name, e);
    }
    await sleep(180); // gentle pacing on the shared app rate limit
  }

  return json({ ok: true, scanned: bare?.length ?? 0, enriched });
});
