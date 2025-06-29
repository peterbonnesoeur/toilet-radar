-- SQL Functions for Toilet Radar Database
-- Updated to use toilet_location table

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create Country Code enum type
CREATE TYPE COUNTRY_CODE AS ENUM ('CH', 'FR', 'DE', 'IT', 'AT');

-- Function 1: Find nearest toilets within a radius
CREATE OR REPLACE FUNCTION find_nearest_toilets(
    user_lat double precision,
    user_lng double precision,
    radius_meters double precision,
    result_limit integer
)
RETURNS TABLE (
    id uuid, name text, lat double precision, lng double precision,
    address text, distance double precision
)
AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.name, t.lat, t.lng, t.address,
           ST_Distance(t.geom, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography)::double precision
    FROM toilet_location t
    WHERE ST_DWithin(t.geom, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_meters)
    ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function 2: Find toilets within a bounding box (map view)
CREATE OR REPLACE FUNCTION find_toilets_in_view (
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  max_results integer DEFAULT 4000
) RETURNS TABLE (
  id uuid, name text, lat double precision, lng double precision,
  accessible boolean, open_hours text, address text, created_at timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
  FROM toilet_location t
  WHERE t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function 3: Get toilets with deterministic behavior based on zoom level
CREATE OR REPLACE FUNCTION get_toilets_deterministic_v3 (
  p_center_lat double precision, p_center_lng double precision,
  p_user_lat double precision DEFAULT NULL, p_user_lng double precision DEFAULT NULL,
  p_is_zoomed_in boolean DEFAULT true, result_limit integer DEFAULT 1000
) RETURNS TABLE (
  id uuid, name text, lat double precision, lng double precision,
  accessible boolean, open_hours text, address text, created_at timestamp with time zone
) AS $$
DECLARE
  center_geom geometry;
  inferred_country_code text := 'CH';
BEGIN
  center_geom := ST_SetSRID(ST_MakePoint(p_center_lng, p_center_lat), 4326);
  
  -- Infer country from nearest toilets
  WITH nearest_k_toilets AS (
    SELECT t.country_code FROM toilet_location t
    WHERE t.geom IS NOT NULL AND t.country_code IS NOT NULL
    ORDER BY t.geom <-> center_geom LIMIT 5
  )
  SELECT (mode() WITHIN GROUP (ORDER BY nk.country_code))::text
  INTO inferred_country_code FROM nearest_k_toilets nk;
  
  IF inferred_country_code IS NULL THEN inferred_country_code := 'CH'; END IF;
  
  IF p_is_zoomed_in THEN
    RETURN QUERY
    SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
    FROM toilet_location t
    WHERE t.geom IS NOT NULL AND t.country_code::text = inferred_country_code
    ORDER BY t.geom <-> center_geom LIMIT result_limit;
  ELSE
    RETURN QUERY
    SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
    FROM toilet_location t
    WHERE t.geom IS NOT NULL AND t.country_code::text = inferred_country_code
    ORDER BY t.id LIMIT result_limit;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create necessary indexes
CREATE INDEX IF NOT EXISTS idx_toilet_location_country_code ON toilet_location (country_code);
CREATE INDEX IF NOT EXISTS toilet_location_geom_idx ON toilet_location USING gist (geom); 