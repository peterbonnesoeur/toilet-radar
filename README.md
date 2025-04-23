# 🚽 Toilet Radar

Find nearby public toilets in Switzerland.

This project uses Next.js, Supabase (with PostGIS), and Leaflet to display public toilet locations on a map.

## Features

*   Displays public toilet locations on an interactive map (Leaflet).
*   Option to find the nearest toilets based on the user's current location.
*   Displays details about toilets (address, accessibility, cost, hours, etc.) when available.
*   Data sourced from OpenStreetMap and various Swiss city open data portals.
*   Uses Supabase for the backend database and geospatial queries.
*   Built with Next.js (App Router) and TypeScript.

## Data Sources & Processing

The application aggregates toilet data from multiple sources:

1.  **OpenStreetMap (OSM):**
    *   The primary source for broad coverage.
    *   Data is fetched using the Overpass API (`scripts/populateFromOSM.mjs`).
    *   This script queries for nodes tagged `amenity=toilets` across Switzerland.
    *   Relevant OSM tags (`name`, `wheelchair`, `fee`, `opening_hours`, `description`, etc.) are mapped to the database schema.
2.  **City Open Data:**
    *   Specific datasets provided by Swiss cities (Zurich, Basel, Geneva, Lucerne) are included in the `/geo` directory.
    *   Dedicated scripts in `/scripts` parse these specific formats (GeoJSON, CSV) and import them into the database:
        *   `populateToilets.mjs`: Zurich (GeoJSON)
        *   `importBaselToilets.mjs`: Basel (JSON)
        *   `importGenevaToilets.mjs`: Geneva (CSV with Swiss LV95 coordinates, requires `proj4` for conversion).
        *   `importLucerneToilets.mjs`: Lucerne (JSON)
3.  **Address Enrichment:**
    *   Since OSM data often lacks full addresses for toilets, the `scripts/enrichAddresses.mjs` script can be run *after* the initial import.
    *   This script queries the database for toilets missing address information.
    *   It uses the free [Nominatim (OSM) reverse geocoding service](https://nominatim.org/release-docs/latest/api/Reverse/) to find the nearest address based on latitude/longitude.
    *   **Important:** This script respects Nominatim's usage policy (max 1 request/second) and requires a valid `User-Agent` to be set within the script.

## Database (Supabase)

*   A PostgreSQL database hosted on Supabase.
*   Uses the **PostGIS** extension for storing geographic locations (`geom` column) and performing spatial queries.
*   The main table is `toilets`, storing details about each location.
*   A database function (RPC) `find_nearest_toilets(user_lat, user_lng, radius_meters, result_limit)` is used to efficiently find toilets near a given point, calculating the distance on the server.
*   See `supabase.md` for detailed schema and function definitions (ensure this file is kept up-to-date).

## Frontend (Next.js/React)

*   The map interface is built using React and the `react-leaflet` library.
*   `components/ClientMapWrapper.tsx` handles:
    *   Requesting user geolocation.
    *   Calling the `find_nearest_toilets` Supabase RPC function.
    *   Managing state for user location, nearby toilets, loading, and errors.
*   `components/ToiletMap.tsx` handles:
    *   Rendering the Leaflet map container and tile layer.
    *   Displaying markers for the user's location and nearby toilets (passed as props from `ClientMapWrapper`).
    *   Displaying popups with toilet details when markers are clicked.

## Local Development Setup

1.  **Clone the Repository:**
    ```bash
    git clone <your-repo-url>
    cd toilet-radar
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    ```

3.  **Set up Supabase Project:**
    *   Create a project on [Supabase](https://supabase.com/).
    *   In the Supabase dashboard, go to `Database` -> `Extensions` and enable `postgis`.
    *   Go to the `SQL Editor` and run the SQL commands found in `supabase.md` (or your setup script) to create the `toilets` table and the `find_nearest_toilets` function.

4.  **Configure Environment Variables:**
    *   Rename `.env.local.example` to `.env.local`.
    *   Find your Supabase project's URL and `anon` key in `Project Settings` -> `API`.
    *   Find your Supabase project's `service_role` key in `Project Settings` -> `API` (keep this secret!).
    *   Update `.env.local`:
        ```dotenv
        NEXT_PUBLIC_SUPABASE_URL=[INSERT SUPABASE PROJECT URL]
        NEXT_PUBLIC_SUPABASE_ANON_KEY=[INSERT SUPABASE PROJECT ANON KEY]
        SUPABASE_SERVICE_KEY=[INSERT SUPABASE SERVICE ROLE KEY]
        # Optional: Add API key if using a commercial geocoder in enrichAddresses.mjs
        # REVERSE_GEOCODING_API_KEY=
        ```

5.  **Populate the Database (Optional but Recommended):**
    *   Ensure the `toilets` table is empty if you want a clean import.
        ```sql
        -- Run in Supabase SQL Editor
        DELETE FROM toilets;
        ```
    *   Run the import scripts. Start with OSM data:
        ```bash
        node scripts/populateFromOSM.mjs
        ```
    *   Optionally run city-specific scripts (check scripts for dependencies like `proj4`):
        ```bash
        # node scripts/importGenevaToilets.mjs 
        # node scripts/importBaselToilets.mjs
        # ...etc
        ```
    *   Optionally run the address enrichment script (requires configuring User-Agent within the script):
        ```bash
        # Ensure User-Agent is set in enrichAddresses.mjs first!
        # node scripts/enrichAddresses.mjs 
        ```

6.  **Run the Development Server:**
    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    ```
    The application should now be running on [http://localhost:3000](http://localhost:3000).
