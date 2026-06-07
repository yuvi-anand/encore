// Supabase Edge Function: seed-genres
//
// Fetches top artists per genre from Spotify (using an APP token via client
// credentials — not any user's token) and stores them in the genre_artists
// table. The app reads from that table, so genre browsing needs ZERO Spotify
// calls from clients = no per-user rate limits, scales to all testers.
//
// Deploy:   supabase functions deploy seed-genres --no-verify-jwt
// Secrets:  supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...
// Run:      curl -X POST .../functions/v1/seed-genres -H "Authorization: Bearer <anon>"
// Refresh:  schedule weekly via pg_cron (optional).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Genre bucket -> Spotify genre search term.
const GENRES: Record<string, string> = {
  Electronic: 'electronic',
  Rock: 'rock',
  'Hip-Hop': 'hip hop',
  Pop: 'pop',
  Indie: 'indie',
  Jazz: 'jazz',
  Metal: 'metal',
  'R&B': 'r&b',
  Country: 'country',
  Classical: 'classical',
};

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
    console.error('token error', await res.text());
    return null;
  }
  return (await res.json()).access_token ?? null;
}

function normalize(a: any) {
  return {
    spotify_id: a.id,
    name: a.name,
    image_url: a.images?.[0]?.url ?? null,
    thumb_url: a.images?.[a.images.length - 1]?.url ?? null,
    genres: a.genres ?? [],
  };
}

Deno.serve(async () => {
  const token = await getAppToken();
  if (!token) return new Response(JSON.stringify({ ok: false, error: 'no token' }), { status: 500 });

  const summary: Record<string, number> = {};
  for (const [bucket, term] of Object.entries(GENRES)) {
    const q = term.includes(' ') ? `genre:"${term}"` : `genre:${term}`;
    let res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=artist&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    let items: any[] = res.ok ? (await res.json()).artists?.items ?? [] : [];
    if (items.length === 0) {
      // Fallback to plain keyword search.
      res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}&type=artist&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      items = res.ok ? (await res.json()).artists?.items ?? [] : [];
    }

    const rows = items.slice(0, 40).map((a, i) => ({ genre: bucket, rank: i, ...normalize(a) }));
    // Replace this genre's set.
    await supabase.from('genre_artists').delete().eq('genre', bucket);
    if (rows.length > 0) {
      await supabase.from('genre_artists').upsert(rows, { onConflict: 'genre,spotify_id' });
    }
    summary[bucket] = rows.length;
    await new Promise((r) => setTimeout(r, 300)); // gentle pacing
  }

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
