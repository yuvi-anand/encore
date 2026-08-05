# Encore — TODO

## Next up
- [ ] **Last.fm artist enrichment (images + genres).** Last.fm returns name-only
      artists, and the existing backfill uses the *user's Spotify token* — which
      Last.fm-only users don't have. So imported artists show letter avatars AND
      have no genres, which breaks the genre tabs/filtering for Last.fm users.
      Fix: enrich via a Spotify **client-credentials** app token (search each
      name → image + genres), ideally in an edge function so the secret stays
      server-side. Highest-value gap now that Last.fm is the primary import.
- [ ] **Apple Music — Part 2 (library import).** Part 1 (developer token) is
      done. Needs a native MusicKit module for the Music User Token + a rebuild.
      See docs/apple-music-setup.md. `getAppleMusicLibraryArtists()` is ready.
- [ ] **Feed radius fix.** The feed filters by home-city *name match*, not the
      radius slider (Touring tab uses real distance). Make the feed use
      distance/radius so nearby-suburb shows appear.

## Backlog
- [ ] **Concert tracking + achievements** (one unified feature) — mark shows
      attended → builds concert history and unlocks achievements. Profile page
      already has the scaffolding (Shows seen, Achievements, Your Concerts).
- [ ] **Genre-filtered suggestions** in Discover (depends on enrichment above).
- [ ] **Sub-2h tour detection** — track `last_checked_at` per artist so the cron
      can fire often while each artist is polled at a bounded Ticketmaster rate.
- [ ] **Remove the `?dry=1` diagnostics** from sync-events once notifications are
      proven stable in the wild (keep the kill-switch pattern).

## Done recently
- [x] Notification floods fixed (1000-row pagination cap + ticketmaster_id dedup
      + baseline/settle/cap); dry-run verified; re-enabled.
- [x] Last.fm **web login flow** (opens Last.fm sign-in) + import + 12h re-sync.
- [x] Apple Music **Part 1** — developer token generated, validated, in EAS.
- [x] Spotify/Apple Music gated as "Coming soon"; Spotify login still works.
- [x] Touring tab date/city/distance consistency; Spotify-login auto-import.

## Your actions (not code)
- [ ] Rotate the Spotify client secret (the one shared in chat is still active),
      update it in Supabase → Auth → Providers → Spotify.
- [ ] Back up the MusicKit `.p8` (can't be re-downloaded).
- [ ] Allowlist Spotify friends (<=25) in the Spotify dashboard if you want them
      using "Continue with Spotify".

## Notes / known limits
- New-tour notifications come from **Ticketmaster listings**, fire on the cron
  interval (every 4h), location-independent.
- Push delivery requires a real device + EAS/TestFlight build (not simulator).
- Spotify can't scale (250k-MAU + business-only Extended Quota wall) — Last.fm
  and Apple Music are the growth channels.
