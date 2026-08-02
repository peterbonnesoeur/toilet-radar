# CLAUDE.md — Toilet Radar

Find nearby public toilets, fast. The design premise for every UX decision:
**the user is uncomfortable, possibly desperate, walking, one-handed.**

Next.js 15 (App Router, TS) + Supabase (Postgres + PostGIS) + react-leaflet 5,
deployed on Vercel (toilet-radar.ch). Python (`db/`, uv + SQLModel + Alembic)
manages **schema migrations only**; Node scripts (`scripts/`) do data ingest
with the service key. ~57k toilets, OSM-sourced, CH/FR/DE/IT/AT enum.

## Commands

```bash
make install                     # uv sync + npm install
make migrate MSG="..."           # alembic autogenerate
make migrate-up [APP_ENV=prd]    # apply migrations
make populate COUNTRY=CH APP_ENV=prd   # OSM import (idempotent, upserts on osm_id)
make enrich APP_ENV=prd          # Nominatim reverse-geocode missing addresses (1 req/s)
make test-db                     # connectivity check
npm run build && npx tsc --noEmit
```

**APP_ENV selects the env file** (`local`→`.env.local` default, `dev`, `prd`) in
BOTH `db/config.py` and `scripts/*.mjs`. Production is never targeted
implicitly — always pass `APP_ENV=prd` deliberately.

## Database (all verified live 2026-08-02)

- Single table `public.toilet_location`: id uuid PK, **osm_id bigint UNIQUE**
  (upsert key; legacy rows have NULL until re-import), name/address/city/type/
  status/notes varchar, lat/lng float, accessible/is_free bool, rating int
  (unused), country_code enum `countrycode`, created_at, `geom` Point 4326.
- **`geom` is owned by the DB trigger** `trigger_update_toilet_location_geom`
  (recomputes from lat/lng). Never write geom from app code.
- **RLS enabled**: SELECT-only policy for anon/authenticated; all writes
  revoked (verified: anon INSERT/DELETE → 401). Writes go through the service
  key (scripts) or direct Postgres (Alembic). Default privileges for future
  tables also revoke API-role DML — new tables need explicit policy work.
- RPCs (plpgsql STABLE, `SET search_path = public, extensions`, server-side
  caps — never trust client limits):
  - `find_toilets_in_view(min/max lat/lng, max_results≤2000)` → the map's
    ONLY fetch path; returns is_free since d9e6f3a2b8c1.
  - `find_nearest_toilets(lat, lng, radius≤100km, limit≤50)` → Save Meeee +
    nearest chip; uses the `(geom::geography)` gist expression index.
  - `get_toilets_deterministic_v3(...)` → legacy, still in DB, frontend no
    longer calls it.
- Alembic head must match prod; migrations run via `env.py` → `db/config.py`.
  The legacy `toilets` table was dropped (c8d5e2f1a4b7).

## Frontend architecture

- `app/page.tsx` → `ClientMapWrapper` (geolocation, bottom sheet, nearest
  chip, Save Meeee) → `ToiletMap` (fetch, filters, status chips, overlays) →
  `ToiletClusterLayer` (imperative leaflet.markercluster markers).
- **Marker invariant: diff by id, never `clearLayers()`** — popup auto-pan
  fires `moveend` → refetch, and a rebuild would close the popup the user
  just opened.
- Popup content is built with DOM APIs + `textContent` (DB strings come from
  OSM = untrusted; no innerHTML ever).
- Fetch: debounced 400ms (stable via ref), aborted via `.abortSignal()`,
  viewport padded 20%. Last result cached in localStorage (`tr:lastToilets`)
  for offline; `public/sw.js` caches the app shell (registered in prod only).
- Layout is `h-dvh` flex — the map must never cause page scroll on phones.
  Distances are shown as walking minutes (`walkingTime`, ~80 m/min).
  `isOpenNow()` parses free-text hours; unknown ≠ closed.
- Theme: use `resolvedTheme` (not `theme`) — defaultTheme is "system".
- Auth exists but is not linked from the UI; `/protected` is a minimal
  account page. Middleware fails closed for `/protected`.

## Keys & env

- New-style Supabase keys: `sb_publishable_...` (browser, maps to anon role)
  and `sb_secret_...` (scripts only, bypasses RLS). Same env var names:
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.
- `DB_PASSWORD` (direct Postgres for Alembic) is independent of API keys.
- `NEXT_PUBLIC_*` values are baked at **build** time — changing them requires
  a rebuild/redeploy.
- dev and prd are currently the SAME Supabase project/credentials (schema
  split via search_path is historical and inert; everything lives in
  `public`).

## Gotchas that have bitten before

- `npm run build | grep ✓` hides failures — the type-check error appears
  AFTER "Compiled successfully". Check `.next/BUILD_ID` exists or read full
  output. tsconfig targets old ES: no `for..of` over Map/Set (use forEach).
- react-leaflet children mount after Leaflet's `load` event — initial fetch
  must be triggered from a child's mount effect, not the `load` event.
- Supabase pauses free-tier projects after ~7 days of DB inactivity.
  Countermeasures: `/api/health` does a real 1-row DB read; scheduled by
  vercel.json (daily) AND .github/workflows/keep-alive.yml (3-daily backup).
- Nominatim: browser calls need the `email=` param; server scripts need a
  real User-Agent and ≥1s delay, or OSM blocks by IP.
- Killing `next start`: `lsof -ti:3000 | xargs kill -9` (pkill by name is
  unreliable and stale servers serve old build hashes → phantom 400s).

## Verification recipes

```bash
# RLS holds (expect 200 / 401 / 401):
set -a; source .env.prd; set +a
B="$NEXT_PUBLIC_SUPABASE_URL/rest/v1"; A=(-H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY")
curl -s -o /dev/null -w '%{http_code}\n' "${A[@]}" "$B/toilet_location?select=id&limit=1"
curl -s -o /dev/null -w '%{http_code}\n' "${A[@]}" -H "Content-Type: application/json" -X POST "$B/toilet_location" -d '{"name":"x","lat":0,"lng":0}'
```

UI checks: Playwright headless against `npm run start`, contexts for
iPhone 13 + desktop, `geolocation` + `permissions: ['geolocation']` mocked to
Zurich (47.3769, 8.5417). Assert: no page scroll, nearest chip, filter chips
reduce marker count, popup survives auto-pan, Save Meeee produces a valid
google.com/maps/dir URL.

Roadmap and open items: see `docs/NEXT_STEPS.md`.
