# Plan: All-Europe Coverage + OSM Sync

Status: **planned, not executed** (2026-08-02). Prerequisite groundwork
(service key, RLS, `osm_id` upserts) is done.

## Grounding numbers (measured)

- Current DB: 43 MB total, `toilet_location` 23 MB for 57,085 rows
  (≈400 bytes/row including indexes).
- OSM node counts (Overpass, 2026-08-02): DE 24,534 · GB 9,027 · IT 8,121 ·
  ES 5,960 · PL 5,796 · FR timed out (expect ~15–20k).
- Extrapolated all-Europe total: **~130–150k toilets ≈ 60 MB** — comfortably
  inside the 500 MB free tier. Storage is not a blocker.
- ⚠️ 57k current rows vs ~5k real Swiss OSM toilets: the legacy
  non-idempotent imports left mass duplicates. **Run the dedupe before the
  rollout** so the baseline is clean (see README's one-time dedupe SQL).

## Phase E1 — schema + script groundwork (~1 session)

1. **Extend the `countrycode` enum.** Alembic migration adding the ~40
   European ISO 3166-1 codes (AL AD BA BE BG BY CY CZ DK EE ES FI GB GR HR
   HU IE IS LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA VA
   XK + existing CH FR DE IT AT). Note: `ALTER TYPE ... ADD VALUE` cannot
   run inside a transaction — use `op.get_context().autocommit_block()`.
   Update `CountryCode` in `db/models/toilets.py` and `SUPPORTED_COUNTRIES`
   in the script to match (keep the list in one place if possible).
   - Decision needed: RU and TR are excluded by default (mostly
     extra-European, enormous Overpass extracts). XK (Kosovo) exists in OSM
     tagging; include, harmless if empty.
2. **Coverage gap fix while we're in the script:** the Overpass query only
   fetches `node["amenity"="toilets"]`. Toilets mapped as buildings/areas
   are ways/relations and are currently invisible. Add
   `way[...](area.a); relation[...](area.a);` with `out center;` and use the
   center coordinates — expect +20–40% more toilets. OSM way/relation ids
   collide with node ids, so store a namespaced osm_id
   (e.g. negative ids for ways, or a `osm_type` column + composite unique).
3. **Multi-country sweep mode:** `--all-europe` flag → sequential imports,
   30 s courtesy pause between countries, 2 retries with backoff per
   country, fall back to the kumi.systems Overpass mirror on 429/504,
   continue-on-error with a final per-country summary table.

## Phase E2 — staged rollout (~1–2 h wall clock, mostly waiting)

1. Dedupe legacy rows (prerequisite, see above).
2. Import smallest countries first (LI, MT, LU, …) to validate the enum and
   sweep mechanics, then the big ones (DE, FR, GB).
3. After each country: log row count + `pg_total_relation_size`; abort the
   sweep if DB size crosses ~350 MB (safety margin, not expected).
4. Spot-check the map over 3–4 new countries (markers, popups, nearest).

## Phase E3 — sync for new / updated / deprecated toilets

What the upsert already gives us: **new** toilets appear, **changed** ones
(name, hours, fee...) are refreshed. What's missing: toilets **deleted in
OSM** stay in our DB forever.

Design (standard mark-and-sweep):

1. Migration: add `last_seen_at timestamptz` to `toilet_location`.
2. The import script stamps `last_seen_at = <run start>` in every upserted
   row (one value per run).
3. After a country's import **succeeds completely**, sweep:
   ```sql
   DELETE FROM toilet_location
   WHERE country_code = :c
     AND osm_id IS NOT NULL          -- never touch manual/legacy rows
     AND last_seen_at < :run_start;
   ```
   Hard DELETE is fine — the data is fully reproducible from OSM. (If we
   later add user content tied to toilets — ratings, reports — switch to
   soft-delete via `status = 'removed'` so references survive.)
4. Never sweep after a partial/failed import (the guard is: sweep only when
   the country's Overpass fetch and all its batches succeeded).

## Phase E4 — automation

- GitHub Actions workflow `sync-toilets.yml`: monthly cron, matrix or
  sequential loop over the country list, `SUPABASE_SERVICE_KEY` +
  `NEXT_PUBLIC_SUPABASE_URL` as repo secrets, job summary with per-country
  added/updated/removed counts. Manual dispatch for one-off syncs.
- Monitoring hook: if a sync would delete >20% of a country's rows, abort
  and flag instead (protects against a bad Overpass response wiping a
  country).

## Open decisions (owner)

1. Include RU / TR? (default: no)
2. Green-light hard-delete sweeps? (default: yes, until user content exists)
3. Monthly cadence OK? (Overpass etiquette: keep it monthly, not daily)

## Execution checklist when green-lit

- [ ] Dedupe legacy CH rows (README SQL, review first)
- [ ] E1 migration + script changes, commit
- [ ] `make populate COUNTRY=LI APP_ENV=prd` smoke test
- [ ] Full sweep `node scripts/populateFromOSM.mjs --all-europe` (APP_ENV=prd)
- [ ] E3 migration + sweep logic, commit
- [ ] E4 workflow + repo secrets
- [ ] Update supabase.md / CLAUDE.md country list
