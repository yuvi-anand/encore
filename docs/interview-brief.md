# Encore — Technical Brief (interview prep)

> **Paste this whole document into a fresh Claude conversation, then say:**
> *"This is a technical brief on an app I built. Act as a senior engineering
> interviewer. First quiz me section by section with progressively harder
> questions, starting with architecture and moving to the debugging war stories.
> Push back when my answers are vague, ask 'why' follow-ups, and tell me when an
> answer wouldn't satisfy a real interviewer. Don't let me get away with
> buzzwords — make me explain mechanisms."*

---

## 1. What the product is

**Encore** is an iOS app that tells you when artists you actually listen to
announce tour dates near you.

The competitive thesis: apps like Bandsintown and Songkick require you to
manually add every artist you care about. Almost nobody does that thoroughly, so
their alerts are incomplete. Encore's differentiator is **automatic library
import that keeps updating as taste evolves** — it adds newly-played artists over
time and never silently removes ones you already follow.

Scale: ~7,400 lines of TypeScript across a React Native client and four
serverless functions.

---

## 2. Stack, and why each piece

| Layer | Choice | Rationale |
|---|---|---|
| Client | **React Native 0.81 / React 19 / Expo SDK 54**, TypeScript | One codebase, and Expo's managed native modules (notifications, secure store, web auth) avoid hand-rolling iOS code |
| Routing | **Expo Router v6** | File-based routing with route *groups* — `(auth)` and `(tabs)` group screens without adding URL segments |
| Backend | **Supabase** — Postgres + Auth + RLS + Edge Functions | Postgres with row-level security means authorization lives in the database, not in app code that can be bypassed |
| Serverless | **Supabase Edge Functions (Deno)** | Needed for work that must hold secrets (API shared secrets) or run without a client present |
| Scheduling | **pg_cron + pg_net** | Cron *inside* Postgres calling the edge function over HTTP — no external scheduler to operate |
| Events data | **Ticketmaster Discovery API** | Authoritative for on-sale tour dates |
| Taste data | **Last.fm** (primary), Spotify (limited), Apple Music (built, unshipped) | See §7 — this choice was forced by a platform constraint, and it's the most interesting product decision in the app |
| Delivery | **EAS Build / EAS Submit → TestFlight** | Cloud iOS builds without maintaining a signing setup locally |

**Client state**: two React Context providers — `AuthProvider` (session, profile)
and `ArtistsProvider` (followed artists, imports, sync) — consumed via
`useAuth()` / `useArtists()`, plus a `useEvents()` hook per screen. Deliberately
no Redux: the shared state is small and mostly server-derived.

---

## 3. Data model

```
profiles          id (FK auth.users), full_name, username, home_cities jsonb,
                  notification_radius_miles, push_token, notify_* flags,
                  spotify_token, spotify_refresh_token, lastfm_username,
                  apple_music_token
artists           id, name, spotify_id, ticketmaster_id, apple_music_id,
                  genres text[], image_url, last_checked_at
user_artists      (user_id, artist_id) PK, source, rank, added_at
events            id, artist_id, venue_* , venue_lat/lng, event_date,
                  ticketmaster_id UNIQUE, ticket_url
notification_log  (user_id, event_id) UNIQUE   -- idempotency for pushes
genre_artists     (genre, spotify_id) PK       -- server-seeded discovery cache
```

Design points worth being able to defend:
- `artists` is a **shared global catalog**; `user_artists` is the join carrying
  per-user `source` (spotify/lastfm/apple_music/manual) and `rank` (taste order).
  One artist row serves every user who follows them — so one Ticketmaster lookup
  covers all of them.
- `events.ticketmaster_id UNIQUE` is what makes ingestion **idempotent** —
  upserts on conflict rather than duplicate rows.
- `notification_log` with a unique `(user_id, event_id)` is the dedup key that
  guarantees a user is never notified twice for the same show.
- RLS policies: users can only read/write rows where `auth.uid() = user_id`;
  `artists` and `events` are public-read since they're shared reference data.

---

## 4. Key subsystems

### 4.1 Taste import and ranking (Last.fm)
Last.fm exposes top artists per time window. The app queries four windows —
`7day`, `1month`, `6month`, `overall` — and blends them:

```
score(artist) = Σ over windows ( playcount × weight[window] )
weights: 7day=8, 1month=4, 6month=2, overall=1
```

Recent listening is weighted 8× all-time, so the resulting order reflects
*current* taste while long-standing favourites still surface. That order is
persisted as `user_artists.rank` and drives sort order in the UI. Paginated
(200/page, 3 pages/window), capped at 500 artists because every followed artist
costs a recurring Ticketmaster lookup.

### 4.2 Cross-source artist resolution
An import must map incoming artists onto catalog rows without creating
duplicates, in bulk:
1. Match by `spotify_id` (chunked `in()` queries)
2. Match remaining by **normalized name** — lowercase, strip diacritics, `&`→`and`,
   collapse non-alphanumerics — first exact, then case-insensitive
3. Bulk-insert whatever is genuinely new
4. Upgrade rows that lack artwork/genres when the import carries better data
5. Bulk-upsert the user↔artist links with rank

Measured on real data: **358 artists resolved in 15 queries** (previously ~1,400).

### 4.3 Enrichment (why it's server-side)
Last.fm returns names only — no images, no genres. Enrichment runs in an edge
function using a Spotify **client-credentials (app) token**, searching each name
and copying artwork + genres onto the catalog row. Server-side because:
- it works for users who never connected Spotify,
- it spends the *app's* rate budget, not a user's personal one,
- the client secret never ships in the bundle.

### 4.4 Tour detection (the scheduled job)
`pg_cron` fires every 4h → `sync-events` edge function:
1. Load every followed artist (throttled: only those not checked in ~2h,
   oldest-first, capped per run via `artists.last_checked_at`)
2. Query Ticketmaster per artist; filter out tribute acts by requiring an exact
   attraction-name match
3. Upsert events on `ticketmaster_id`
4. Diff against known events to find genuinely new shows
5. Fan out Expo push notifications, deduped against `notification_log`

Safety layers: first-sync baseline (an artist's pre-existing tours never
notify), a 24h settle window after following, a per-user cap per run, and a
`?dry=1` mode that computes exactly what *would* send without sending.

### 4.5 Location filtering
Home cities are geocoded to lat/lng. Feed and Touring filter with the
**haversine formula** against the user's radius setting, falling back to
city-name matching only when coordinates are missing on either side.

### 4.6 Notifications
Two kinds: **push** (server → Expo Push API, for tour announcements) and
**local scheduled** (on-device, for "1 week / 1 day before" reminders). Local
reminders are capped below iOS's **64 pending notification limit**, soonest shows
first.

---

## 5. Debugging war stories — *the most valuable interview material*

Be able to tell each of these as: **symptom → hypothesis → how I isolated it →
root cause → fix → verification.**

### A. The notification flood (best story)
**Symptom:** users got ~100 "X is touring" pushes in two days, including at 3am.

**Two independent root causes, stacked:**
1. **PostgREST silently caps responses at 1,000 rows.** The "which events do we
   already know?" query returned only the first 1,000 of 2,196 rows — so ~1,200
   shows were invisible to the dedup check and re-flagged as new *every run*.
   Fixed by paginating with `.order('id').range(...)` — note the ordering
   matters, because `range()` without a stable sort can skip rows.
2. A brief attempt to key dedup on `artist_id|date|city` **made it worse**: one
   Ticketmaster event can map to several artists (festivals, co-headliners), so
   the stored `artist_id` differed from the one being searched and those shows
   looked new forever. Reverted to `ticketmaster_id`, which is unique and stable.

**Verification:** built a dry-run mode that reports what *would* send without
sending. False positives went **59 → 0**, stable across repeated runs, and a live
run confirmed 0 sends when nothing was new.

**Talking point:** the fix wasn't the interesting part — building an observation
tool so the system could be *proven* correct before re-enabling it was.

### B. The N+1 import
Artists without a `spotify_id` (i.e. *every* Last.fm artist) fell into a
per-artist path that ran 3–4 queries **plus a full list refetch each**. ~1,400
round trips for a 358-artist import. Rewrote as bulk resolution → **15 queries**.
Classic N+1, but with a UI-thrash multiplier because of the refetch.

### C. `maybeSingle()` on duplicate names
Supabase's `.maybeSingle()` **errors when more than one row matches**. The
catalog legitimately contained same-named artists (`Kendrick Lamar` ×3). The
error was swallowed, the code concluded "not found," and inserted *another*
duplicate — self-compounding. Fixed with `.limit(1)` plus preferring the row that
already has a `spotify_id`, so duplicates converge instead of multiply.

### D. `URL.searchParams` doesn't work on custom schemes in React Native
OAuth redirect `encore://auth/lastfm?token=...` parsed via
`new URL(...).searchParams` returned `null`. RN's `URL` polyfill doesn't parse
query strings for custom schemes. Every caller treated null as "user cancelled,"
so sign-in failed **silently**. Fixed with direct regex extraction — and the
same latent bug existed in the Spotify code exchange.

### E. An auth ordering race
Sign-up created the anonymous account *before* opening the OAuth browser. The new
session fired `onAuthStateChange` → the auth gate navigated into the app → the
navigation **tore down the web auth session**. Users landed on an empty account.
Fixed by inverting the order: authenticate first, create the account only once
there's a verified identity — which also means backing out leaves nothing behind.

### F. The types lied
`Profile.lastfm_username` existed in TypeScript but **the column was never added
to Postgres**. Every write failed at runtime against a non-existent column while
the compiler was perfectly happy. **Lesson:** TypeScript types over a remote
schema are an assertion, not a guarantee — generated types or a migration check
would have caught it.

### G. Infinite render loop
`profile?.home_cities ?? []` allocates a **new array every render**. That array
was in a `useCallback` dependency list, so the callback was rebuilt each render,
its `useEffect` re-ran, called `setState`, re-rendered — "Maximum update depth
exceeded." Fixed by depending on *content* (a derived key) rather than identity,
plus memoizing at the call sites.

### H. A destructive sync that could resurrect the flood
Pull-to-refresh **deleted all stored events before rebuilding**. Any show
Ticketmaster didn't return at that instant vanished — and the cron decides "is
this new?" by looking it up there. So a refresh could re-trigger the notification
flood. Made it purely additive. It would also have exceeded URL length limits
once a user followed hundreds of artists (fixed by batching every `in()` filter).

---

## 6. Third-party API lessons
- **Spotify silently reduced `search` max `limit` from 50 to 10** — requests
  started returning 400 "Invalid limit." Fixed with offset pagination.
- **Spotify's `/artists` batch endpoint 403s** for newer apps entirely.
- **Last.fm returns a bare object instead of an array** when exactly one result
  exists — a classic JSON-shape trap.
- **Ticketmaster re-issues event IDs** for re-listed shows, and tribute bands
  pollute keyword search (filtered by exact attraction-name match).

---

## 7. The strategic constraint (product + engineering judgment)

Spotify's **Extended Quota Mode** requires ~250,000 MAU *and* a registered
business entity; without it an app is capped at ~25 manually-allowlisted users.
That's a **catch-22**: you can't reach 250k users on a 25-user cap.

The response was to re-architect the growth path rather than fight it:
- **Last.fm** became the primary import (no cap, no business requirement)
- **Spotify** stays behind a tester-code gate for allowlisted users
- **Apple Music** is code-complete but unshipped — its library API requires a
  native MusicKit module *and* an active subscription to test, so it's labeled
  "coming soon" rather than shipping unverified

**Interview framing:** the useful answer isn't "Spotify was annoying," it's
recognizing a hard external constraint early, and choosing a different data
source instead of building on a dependency that can't scale.

---

## 8. Likely interview questions to prepare

1. Why Supabase over a custom backend? What does RLS actually buy you?
2. How do you guarantee a user is never notified twice for the same show?
3. Walk me through the dedup key choice — why `ticketmaster_id` over
   artist+date+city?
4. How do you keep one user's 500 artists from exhausting a shared API quota?
5. Why is enrichment server-side rather than in the client?
6. How would you scale tour detection from 5 users to 500k?
7. What breaks first at scale, and how would you find out before users do?
8. How do you test a scheduled job that sends irreversible notifications?
9. What would you do differently if you started over?

**Good answers to have ready for #6/#7:** the artist catalog is shared, so
Ticketmaster load scales with *distinct artists*, not users; the per-artist
`last_checked_at` throttle decouples cron frequency from API load; the current
bottleneck is Spotify's app-token rate limit used by enrichment, which would need
caching or a non-Spotify image source.

**For #9:** generate DB types instead of hand-writing them (see story F); build
the dry-run harness *before* shipping the notification path, not after.
