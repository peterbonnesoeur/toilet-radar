# Supabase Database Reference — Toilet Radar

Detailed reference for the Supabase (Postgres + PostGIS) backend. Schema changes are managed exclusively through Alembic migrations in `db/` (see the README's Workflows section); data writes go exclusively through the Node scripts in `scripts/` using the service key.

## Tables

### `public.toilet_location`

The single live table (~57k rows). Stores every public toilet location.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` (PK) | Primary key, default `gen_random_uuid()`. |
| `osm_id` | `bigint` (UNIQUE, nullable) | OpenStreetMap element id. Unique constraint enables idempotent upserts from the OSM import; NULL for legacy rows imported before this column existed. |
| `name` | `varchar` | Name/description of the location. |
| `open_hours` | `varchar` | Opening hours text. |
| `address` | `varchar` | Street address (may be filled by the Nominatim enrichment script). |
| `type` | `varchar` | Type/category of the toilet. |
| `status` | `varchar` | Operational status. |
| `notes` | `varchar` | Free-form notes. |
| `city` | `varchar` | City name. |
| `lat` | `double precision` | Latitude (WGS84). |
| `lng` | `double precision` | Longitude (WGS84). |
| `accessible` | `boolean` | Wheelchair accessible. |
| `is_free` | `boolean` | Free to use. |
| `rating` | `integer` | Rating (unused so far). |
| `country_code` | `countrycode` enum | One of `CH`, `FR`, `DE`, `IT`, `AT`. |
| `created_at` | `timestamptz` | Default `now()`. |
| `geom` | `geometry(Point, 4326)` | PostGIS point. **Maintained automatically** from `lat`/`lng` by the trigger `trigger_update_toilet_location_geom` — never write it directly. |

> The legacy `toilets` table was dropped in migration `c8d5e2f1a4b7`.

### Indexes

| Index | Definition | Purpose |
|---|---|---|
| `idx_toilet_location_geom` | GIST on `geom` | General spatial queries (bounding box, KNN). |
| `idx_toilet_location_geog` | GIST on `(geom::geography)` (expression index) | Serves `ST_DWithin` distance searches in meters. |
| `idx_toilet_location_country_code` | btree on `country_code` | Country filtering. |
| `idx_toilet_location_country_id` | btree on `(country_code, id)` | Deterministic-by-id pagination within a country. |
| `toilet_location_osm_id_key` | unique on `osm_id` | Idempotent OSM upserts. |

### Row Level Security

RLS is **enabled** on `toilet_location`:

*   Policy `"Public read access"` grants `SELECT` only, to the `anon` and `authenticated` roles.
*   All write grants (`INSERT`/`UPDATE`/`DELETE`) are **revoked** from `anon` and `authenticated`.
*   Writes happen only through the Supabase **service key** (ingest scripts in `scripts/`) or direct Postgres connections (Alembic migrations).

## RPC Functions

All three functions are `plpgsql`, marked `STABLE`, have `search_path` pinned, and enforce server-side caps on their parameters so clients cannot request unbounded result sets.

### `find_nearest_toilets(user_lat, user_lng, radius_meters, result_limit)`

Returns the nearest toilets to a point, ordered by distance.

| Parameter | Type | Default | Cap |
|---|---|---|---|
| `user_lat` | `double precision` | — | |
| `user_lng` | `double precision` | — | |
| `radius_meters` | `double precision` | `20000` | `100000` |
| `result_limit` | `integer` | `3` | `50` |

Returns toilet rows plus a `distance` column in **meters**, nearest first. Uses `ST_DWithin` on `geom::geography`, served by `idx_toilet_location_geog`.

### `find_toilets_in_view(min_lat, min_lng, max_lat, max_lng, max_results)`

Returns toilets inside a bounding box (the current map viewport).

| Parameter | Type | Default | Cap |
|---|---|---|---|
| `min_lat`, `min_lng`, `max_lat`, `max_lng` | `double precision` | — | |
| `max_results` | `integer` | `2000` | `2000` |

### `get_toilets_deterministic_v3(p_center_lat, p_center_lng, p_user_lat, p_user_lng, p_is_zoomed_in, result_limit)`

Country-aware, deterministic marker selection for the map:

1.  Infers the relevant country from the 5 toilets nearest the map center.
2.  When `p_is_zoomed_in` is true, returns the rows nearest to the center.
3.  When zoomed out, returns a deterministic-by-id selection for that country (served by `idx_toilet_location_country_id`), so the same view always shows the same markers.

`result_limit` is capped at `1000`.

## Usage from client-side JS

```javascript
const { data, error } = await supabase.rpc('find_nearest_toilets', {
  user_lat: position.coords.latitude,
  user_lng: position.coords.longitude,
  radius_meters: 20000, // optional, default 20000, capped at 100000
  result_limit: 3,      // optional, default 3, capped at 50
});
```

The anon key is sufficient — RLS allows public reads, and the RPCs are read-only (`STABLE`).

## Keep-alive

`vercel.json` defines a daily cron that requests `/api/health`. That route performs a 1-row read from the database via the anon key, preventing Supabase's free tier from pausing the project for inactivity.
