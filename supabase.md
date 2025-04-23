# Supabase Database Documentation for Toilet Radar

This document outlines the structure of the Supabase database used for the Toilet Radar application.

## Tables

### `toilets` Table

Stores information about individual public toilet locations.

| Column Name  | Type                        | Description                                                                  |
|--------------|-----------------------------|------------------------------------------------------------------------------|
| `id`         | `uuid` (Primary Key)        | Unique identifier for the toilet (auto-generated).                           |
| `name`       | `text`                      | The name or description of the toilet location (e.g., "WC Hauptbahnhof").    |
| `lat`        | `double precision`          | Latitude coordinate of the toilet.                                           |
| `lng`        | `double precision`          | Longitude coordinate of the toilet.                                          |
| `accessible` | `boolean`                   | Indicates if the toilet is wheelchair accessible (`true`/`false`).             |
| `open_hours` | `text`                      | Text description of the opening hours (e.g., "Mo-So 06:00-23:00", "24 h"). |
| `address`    | `text`                      | Street address of the toilet location.                                       |
| `created_at` | `timestamp with time zone`  | Timestamp when the record was created (auto-generated, defaults to `now()`). |
| `geom`       | `geometry(Point, 4326)`     | PostGIS geometry point representing the toilet's location (used for spatial queries). Uses SRID 4326 (WGS84). |

**Indexes:**

*   `toilets_geom_idx`: A GIST spatial index on the `geom` column for efficient location-based querying.

**Row Level Security (RLS):**

*   Enabled.
*   A policy `Public read access` allows anyone (`USING (true)`) to `SELECT` data.
*   *(Optional)* An `INSERT` policy might be added later for authenticated user submissions.

---

## Database Functions (RPC)

### `find_nearest_toilets(user_lat, user_lng, radius_meters, result_limit)`

Finds the nearest toilets to a given user location within a specified radius.

**Parameters:**

| Parameter        | Type               | Default | Description                                       |
|------------------|--------------------|---------|---------------------------------------------------| 
| `user_lat`       | `double precision` | *N/A*   | Latitude of the user's current location.          |
| `user_lng`       | `double precision` | *N/A*   | Longitude of the user's current location.         |
| `radius_meters`  | `double precision` | `20000` | Search radius in meters (defaults to 20km).       |
| `result_limit`   | `integer`          | `3`     | Maximum number of nearest toilets to return (defaults to 3). |

**Returns:**

A table containing rows with the following columns for each toilet found within the radius, ordered by distance (nearest first):

| Column    | Type               | Description                                                |
|-----------|--------------------|------------------------------------------------------------|
| `id`      | `uuid`             | Unique identifier of the toilet.                           |
| `name`    | `text`             | Name/description of the toilet.                            |
| `lat`     | `double precision` | Latitude of the toilet.                                    |
| `lng`     | `double precision` | Longitude of the toilet.                                   |
| `address` | `text`             | Address of the toilet.                                     |
| `accessible` | `boolean`        | Whether the toilet is wheelchair accessible.               |
| `is_free` | `boolean`          | Whether the toilet is free to use (null if unknown).       |
| `type`    | `text`             | The type or category of the toilet.                        |
| `status`  | `text`             | Operational status (e.g., 'in Betrieb', 'geschlossen').    |
| `notes`   | `text`             | Additional notes or comments.                              |
| `city`    | `text`             | The city the toilet is located in.                         |
| `open_hours` | `text`           | Opening hours information.                                 |
| `distance`| `double precision` | Calculated distance in **meters** from the user's location. |
| `created_at`| `timestamp with time zone` | Timestamp when the record was created.                    |

**Usage Example (from Client-Side JS):**

```javascript
const { data, error } = await supabase.rpc(
  'find_nearest_toilets',
  {
    user_lat: position.coords.latitude,
    user_lng: position.coords.longitude,
    radius_meters: 20000, // Optional, defaults to 20000
    result_limit: 3       // Optional, defaults to 3
  }
);
``` 