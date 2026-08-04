# Apple Music (MusicKit) setup

Apple Music import needs **two** tokens. The API layer in `src/lib/appleMusic.ts`
is ready — this is the credential + native work required to feed it.

---

## 1. Developer token (you can do this today)

A JWT signed with an Apple private key. Same for every user, valid up to 6 months.

1. [developer.apple.com](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Keys** → **+**
2. Name it (e.g. "Encore MusicKit"), check **MusicKit**, **Continue** → **Register**.
3. **Download the `.p8` key** (one-time download). Note the **Key ID** and your **Team ID** (top-right of the portal).
4. Generate the JWT with the included script (dependency-free, Node 16+):

```bash
APPLE_TEAM_ID=XXXXXXXXXX \
APPLE_KEY_ID=YYYYYYYYYY \
APPLE_P8_PATH=./AuthKey_YYYYYYYYYY.p8 \
node scripts/gen-apple-token.mjs
```

   (`XXXXXXXXXX` = your Apple Team ID, `YYYYYYYYYY` = the MusicKit Key ID, and
   the `.p8` path is the key file you downloaded.) It prints the token to stdout.

5. Put the output in `.env` as `EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN=...`, and add it to EAS:
   `npx eas env:create --environment preview --name EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN --value "<token>" --visibility sensitive --type string --force`
6. **Never commit the `.p8` or the token.** (`.p8` is already gitignored.)

⚠️ The token expires — set a calendar reminder to regenerate before 6 months.

---

## 2. Music User Token (needs a native module + rebuild)

This is the blocker for a JS-only Expo app: reading a user's library requires a
**Music User Token**, which only the native MusicKit SDK can mint after the user
authorizes. `connectAppleMusic()` in `appleMusic.ts` is a non-working placeholder.

Path:
1. Add a native MusicKit module. Either a community package
   (`react-native-apple-music` or similar — verify it's maintained) or a small
   custom Expo **config plugin** wrapping Swift MusicKit.
2. The native side calls `MusicAuthorization.request()` then
   `MusicUserTokenProvider().userToken(...)` (or `SKCloudServiceController`), and
   returns the Music User Token string to JS.
3. Add `NSAppleMusicUsageDescription` to `app.json` → `ios.infoPlist`.
4. This is a native change, so it needs a new dev/preview build (`eas build`),
   not just a JS reload.

---

## 3. Wiring (once both tokens exist)

In `settings.tsx` (mirroring the Spotify/Last.fm flow):

```ts
import { getAppleMusicLibraryArtists } from '../../src/lib/appleMusic';
// const userToken = await NativeMusicKit.authorize();
// await updateProfile({ apple_music_token: userToken });
// const artists = await getAppleMusicLibraryArtists(userToken);
// await importArtists(artists, 'apple_music', 'replace');
```

`importArtists` already accepts `'apple_music'`, and the background re-sync
pattern from Last.fm/Spotify can be copied for keep-in-sync behavior.

---

**Bottom line:** Part 1 is a 15-minute Apple-portal task you can do now. Part 2
is the real lift (native module + rebuild). Until Part 2 is done, Apple Music
stays "Coming soon" in the UI — which is exactly how it's labeled.
