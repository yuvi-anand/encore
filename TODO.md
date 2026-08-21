# Encore — TODO

## Next up
- [ ] **Apple Music — validate and ship.** Code is COMPLETE on the
      `apple-musickit` branch (module, provider, connect + library import), the
      developer token is generated, and MusicKit is enabled on the App ID — so
      nothing is left to build. It is blocked purely on testing: MusicKit auth
      and library reads require a device with an ACTIVE Apple Music
      subscription, which we don't have. Options: a tester who has one, or a
      1-month free trial. Until then main keeps it as "Coming soon".
      See docs/apple-music-setup.md.

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
- [x] Feed radius — the feed now filters by real distance against the radius
      setting instead of city-name matching, so nearby-suburb shows appear and
      the slider actually does something.
- [x] Last.fm artist enrichment — `enrich-artists` edge function fills artwork +
      genres via a Spotify app token (works for users with no Spotify login, and
      never spends a user's own rate limit). Runs after every import until done.
- [x] Last.fm sign-in fix — the redirect token was parsed with URL/searchParams,
      which React Native doesn't handle for custom schemes, so sign-in failed
      silently. Same latent bug fixed in the Spotify code exchange.
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
