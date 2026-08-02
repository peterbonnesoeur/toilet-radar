# Next Steps

State as of 2026-08-02: the security/perf/UX overhaul is merged (RLS live,
keep-alive in place, clustered map, bottom sheet, filters, PWA). What remains,
in priority order.

## Now — owner actions (dashboard access required)

1. **Fix `SUPABASE_SERVICE_KEY`**: `.env.prd` and `.env.local` currently hold
   the *publishable* key in that slot. Paste the `sb_secret_...` key
   (Dashboard → API Keys → Secret keys). Until then `make populate` /
   `make enrich` cannot write (verified: writes → 401).
2. **Disable the legacy JWT keys** (Dashboard → API Keys → Legacy tab) — the
   old anon/service_role JWTs lived in several on-disk files; disabling them
   completes the rotation.
3. **Vercel env**: set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the publishable key
   and redeploy. The deploy also activates the daily keep-alive cron.
4. Optionally reset the DB password (it sat in the same files) and update
   `DB_PASSWORD` everywhere.

## Then — data quality (Claude can run these once #1 is done)

5. `make populate COUNTRY=CH APP_ENV=prd` (repeat per country) — populates
   `osm_id` and refreshes stale attributes.
6. Run the one-time legacy dedupe from README (review first!) — removes
   pre-osm_id duplicates like the "ShopVille ×2" seen in nearest results.
7. `make enrich APP_ENV=prd` for the remaining NULL addresses (1 req/s —
   budget hours, resumable thanks to keyset pagination).

## Verification debt

8. Offline end-to-end test (service worker + localStorage cache under
   airplane mode) was implemented but its browser test was interrupted —
   run it before relying on the offline story.

## Feature backlog (UX axioms not yet implemented)

- **A9 — desktop list panel**: left sidebar of visible toilets sorted by
  walking time, hover ↔ marker highlight sync. Desktop's biggest win.
- **A6 — progressive disclosure**: detail view (notes, type, status already
  in the DB, unshown); popup stays minimal.
- **A8 — report-a-problem**: one-tap "closed/missing" feedback. First real
  use of the auth stack; needs a write path (authenticated RPC or edge
  function + a reports table with its own RLS).
- **A10 — keyboard**: `/` focuses search, Enter opens directions.
- **A11 — install nudge**: add-to-home-screen prompt after 2nd visit +
  manifest shortcut "Nearest toilet now".

## Planned: all-Europe coverage + OSM sync

Full plan with measured storage/count numbers, the mark-and-sweep design for
OSM deletions, and an execution checklist: see `docs/EUROPE_EXPANSION.md`.
Prerequisite: run the legacy dedupe first (the 57k current rows vs ~5k real
Swiss OSM toilets implies mass duplicates from the old non-idempotent
imports).

## The big one — new amenity kinds (faucets, bike pumps)

Deferred by choice; design is settled:
- Migration: `amenity_kind` enum (`toilet | drinking_water | bike_pump`) on
  `toilet_location` (default `toilet`), extend RPCs with a `kinds text[]`
  filter param.
- Ingest: same Overpass script, parameterized query — OSM tags
  `amenity=drinking_water` and `amenity=compressed_air`.
- Frontend: per-kind icons (public/faucet.png and bike_pump.png are already
  resized and waiting) + kind toggles next to the filter chips.

## Infrastructure hygiene

- Separate free Supabase project for dev (currently dev = prd, same creds).
- Open-hours parsing server-side (structured `opening_hours` column) to make
  the "Open now" filter authoritative instead of best-effort.
- sharp/libvips CVEs come via Next's bundled image pipeline; no fix within
  Next 15 yet — revisit on the next Next.js major.
- `rating` column + premium_toilet icon hint at an unbuilt quality tier —
  decide to build or drop.
