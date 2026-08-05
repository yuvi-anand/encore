// Supabase Edge Function: lastfm-auth
//
// Exchanges a Last.fm web-auth token for the account username, signing the
// auth.getSession call with the shared secret (which stays server-side — it is
// never shipped in the app). Called by the client after the user authorizes on
// Last.fm's page.
//
// Deploy: supabase functions deploy lastfm-auth
// Secrets: LASTFM_API_KEY, LASTFM_API_SECRET (already set)

import { crypto } from 'https://deno.land/std@0.224.0/crypto/mod.ts';

const API_KEY = Deno.env.get('LASTFM_API_KEY')!;
const API_SECRET = Deno.env.get('LASTFM_API_SECRET')!;

async function md5Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('MD5', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  try {
    const { token } = await req.json();
    if (!token) return json({ error: 'missing token' }, 400);

    // api_sig = md5 of the params sorted alphabetically by name and concatenated
    // as name+value, followed by the shared secret. Sorted names here:
    // api_key, method, token.
    const sigBase = `api_key${API_KEY}methodauth.getSessiontoken${token}${API_SECRET}`;
    const apiSig = await md5Hex(sigBase);

    const url =
      `${'https://ws.audioscrobbler.com/2.0/'}?method=auth.getSession` +
      `&api_key=${API_KEY}&token=${encodeURIComponent(token)}&api_sig=${apiSig}&format=json`;

    const res = await fetch(url);
    const data = await res.json();

    if (data?.session?.name) {
      return json({ username: data.session.name, sessionKey: data.session.key });
    }
    return json({ error: data?.message ?? 'auth failed', code: data?.error }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
