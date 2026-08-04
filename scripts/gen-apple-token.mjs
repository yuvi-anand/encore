// Generates an Apple Music (MusicKit) developer token — a signed ES256 JWT.
// Dependency-free (uses Node's built-in crypto). Node 16+.
//
// Usage:
//   APPLE_TEAM_ID=XXXXXXXXXX \
//   APPLE_KEY_ID=YYYYYYYYYY \
//   APPLE_P8_PATH=./AuthKey_YYYYYYYYYY.p8 \
//   node scripts/gen-apple-token.mjs
//
// Prints the token to stdout. Put it in .env as
// EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN and add it to EAS (see
// docs/apple-music-setup.md). Never commit the .p8 or the token.

import crypto from 'node:crypto';
import fs from 'node:fs';

const TEAM_ID = process.env.APPLE_TEAM_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const P8_PATH = process.env.APPLE_P8_PATH;

if (!TEAM_ID || !KEY_ID || !P8_PATH) {
  console.error(
    'Missing env. Set APPLE_TEAM_ID, APPLE_KEY_ID, and APPLE_P8_PATH.\n' +
      'Example:\n  APPLE_TEAM_ID=ABCDE12345 APPLE_KEY_ID=FGHIJ67890 \\\n' +
      '  APPLE_P8_PATH=./AuthKey_FGHIJ67890.p8 node scripts/gen-apple-token.mjs'
  );
  process.exit(1);
}

const privateKey = fs.readFileSync(P8_PATH, 'utf8');
const b64url = (input) => Buffer.from(input).toString('base64url');

const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 60 * 60 * 24 * 180; // Apple's max token lifetime
const payload = { iss: TEAM_ID, iat: now, exp: now + SIX_MONTHS };

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
// dsaEncoding 'ieee-p1363' gives the raw r||s signature JOSE/JWT expects
// (Node otherwise emits DER, which Apple would reject).
const signature = crypto.sign('sha256', Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
});

console.log(`${signingInput}.${signature.toString('base64url')}`);
console.error(
  `\n✓ token generated (expires ${new Date((now + SIX_MONTHS) * 1000).toDateString()}).`
);
