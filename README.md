# 🚽 Toilet Radar

Find nearby public toilets. An interactive map of ~57,000 public toilet locations across Switzerland, France, Germany, Italy, and Austria, sourced from OpenStreetMap.

## Features

*   Interactive map (react-leaflet 5) showing public toilet locations.
*   "Nearest toilets" lookup from the user's current location, with distances computed server-side in PostGIS.
*   Toilet details when available: address, accessibility, cost (free/paid), opening hours, notes.
*   Country-aware, deterministic map queries so the same view always returns the same markers.
*   Data pipeline that imports and refreshes data from OpenStreetMap (Overpass API) and enriches addresses via Nominatim reverse geocoding.

## Stack & Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS + shadcn/ui, react-leaflet 5 |
| Backend | Supabase (Postgres + PostGIS), accessed via RPC functions |
| Schema migrations | Python: uv + SQLModel + Alembic (in `db/`) |
| Data ingest | Node scripts (in `scripts/`) using the Supabase service key |
| Hosting | Vercel |

Responsibilities are split deliberately:

*   **Python (`db/`)** manages the database schema only — Alembic migrations, run via the Makefile.
*   **Node (`scripts/`)** handles data ingest only — Overpass imports and Nominatim enrichment, authenticated with the Supabase service key.
*   **The app** talks to the database read-only through the anon key and RPC functions (RLS allows `SELECT` only; all writes go through the service key or direct Postgres).

A daily Vercel cron (defined in `vercel.json`) hits `/api/health`, which performs a 1-row database read via the anon key to keep the Supabase free-tier project from being paused for inactivity.

## Data Sources

*   **OpenStreetMap** via the Overpass API: `scripts/populateFromOSM.mjs` queries `amenity=toilets` for a whole country and upserts rows on `osm_id`, so re-running refreshes existing data instead of creating duplicates. Supported countries: CH, FR, DE, IT, AT (limited by the database's `countrycode` enum).
*   **Nominatim reverse geocoding**: `scripts/enrichAddresses.mjs` fills in missing addresses at 1 request/second with a proper `User-Agent` (per Nominatim's usage policy), using keyset pagination to walk the table.

## Environments

Configuration comes from env files selected by `APP_ENV`:

| `APP_ENV` | Env file | Notes |
|---|---|---|
| `local` (default) | `.env.local` | Used when `APP_ENV` is unset |
| `dev` | `.env.dev` | |
| `prd` | `.env.prd` | Production — never targeted implicitly |

The same convention is shared by `db/config.py` (migrations) and `scripts/*.mjs` (ingest). `.env.example` documents the required variables. **Never commit real env files.**

## Local Setup

```bash
git clone <your-repo-url>
cd toilet-radar
make install                  # uv sync + npm install
cp .env.example .env.local    # then fill in your Supabase values
npm run dev
```

To create the schema, run the migrations against your database:

```bash
make migrate-up               # local by default
make migrate-up APP_ENV=prd   # production, only when deliberate
```

## Workflows (Makefile)

All targets accept `APP_ENV=...` passthrough (e.g. `make migrate-up APP_ENV=prd`).

| Command | What it does |
|---|---|
| `make install` | `uv sync` + `npm install` |
| `make migrate MSG="..."` | Generate a new Alembic migration |
| `make migrate-up` / `migrate-down` | Apply / roll back migrations |
| `make migrate-history` / `migrate-current` | Inspect migration state |
| `make test-db` | Test the database connection |
| `make populate COUNTRY=CH` | Import/refresh toilets from OSM for a country (CH, FR, DE, IT, AT) |
| `make enrich` | Reverse-geocode missing addresses via Nominatim |

### Cleaning up legacy rows

Rows imported before the `osm_id` column existed have `osm_id NULL`. After the first upsert re-import for a country, near-duplicate legacy rows can be removed with a one-time SQL pass. This is a manual step — review what it matches before running it:

```sql
DELETE FROM toilet_location old
WHERE old.osm_id IS NULL
  AND EXISTS (
    SELECT 1 FROM toilet_location new
    WHERE new.osm_id IS NOT NULL
      AND ST_DWithin(new.geom::geography, old.geom::geography, 25)
  );
```

## Database

A single live table, `public.toilet_location` (~57k rows), with a PostGIS `geom` column maintained automatically by trigger from `lat`/`lng`, GIST spatial indexes, and RLS allowing public read only. The app queries it through three RPC functions:

*   `find_nearest_toilets` — nearest toilets to a point, with distance in meters.
*   `find_toilets_in_view` — toilets within a bounding box.
*   `get_toilets_deterministic_v3` — country-aware, deterministic marker selection for the map view.

See [`supabase.md`](./supabase.md) for the full schema, index, RLS, and RPC reference.
