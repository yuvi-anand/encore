# Encore — TODO

## Next up
- [ ] **Concert badges and tracking** — let users mark shows they've attended,
      track concert history, and earn badges/milestones.
- [ ] **Genre-filtered suggestions** in Discover — show top suggested artists per
      genre. Spotify `genre:` search works but returns "popular in genre" (not
      personalized) and adds `/search` load; needs careful throttling/caching so
      it doesn't reintroduce rate-limit issues.
- [ ] **Apple Music integration** — connect + import. Needs a MusicKit developer
      token (Apple Developer account) and the native MusicKit module; bigger lift.

## Backlog
- [ ] **Sub-2h tour detection (smarter per-artist throttle).** The sync-events
      Edge Function makes 1 Ticketmaster call per followed artist per run.
      Ticketmaster allows ~5,000 calls/day, so with ~376 artists the safe max is
      every 2h. To run hourly (or faster) without blowing the quota, track a
      `last_checked_at` per artist and only re-fetch artists not checked in the
      last N hours — decouples cron frequency from per-artist API load. Lets the
      cron fire often while each artist is polled at a bounded rate.
- [ ] Real artist photos on the suggestion feed (blocked: Spotify `/artists`
      batch endpoint 403s for new apps; per-artist `/search` doesn't scale on the
      shared app rate limit). Currently letter avatars.

## Notes / known limits
- New-tour notifications come from **Ticketmaster listings**, not social media,
  and fire on the cron interval (currently every 2h), location-independent.
- Push delivery requires a real device + EAS/TestFlight build (not simulator).
- Spotify `/artists` batch endpoint returns 403 for this app; image hydration
  uses `/search` (rate-limited) + the local catalog cache.
