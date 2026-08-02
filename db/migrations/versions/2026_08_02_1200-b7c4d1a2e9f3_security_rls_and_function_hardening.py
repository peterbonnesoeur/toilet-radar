"""security_rls_and_function_hardening

Enables Row Level Security with read-only anon access on toilet_location
(previously the anon key had full DML including TRUNCATE), revokes write
grants, caps the RPC result limits server-side, pins search_path in every
function, and fixes the spatial-index misses:

- ST_DWithin on a geometry->geography cast could not use the plain-geometry
  GIST index; a dedicated expression index on (geom::geography) fixes it.
- country_code::text = ... defeated idx_toilet_location_country_code; the
  functions now compare enum to enum.
- toilet_location_geom_idx was an exact duplicate of idx_toilet_location_geom
  and is dropped.

Revision ID: b7c4d1a2e9f3
Revises: e3a2cb33db43
Create Date: 2026-08-02 12:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b7c4d1a2e9f3'
down_revision = 'e3a2cb33db43'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Row Level Security: read-only for API roles -----------------------
    op.execute("""
        ALTER TABLE public.toilet_location ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON TABLE public.toilet_location FROM anon, authenticated;
        GRANT SELECT ON TABLE public.toilet_location TO anon, authenticated;
        DROP POLICY IF EXISTS "Public read access" ON public.toilet_location;
        CREATE POLICY "Public read access" ON public.toilet_location
            FOR SELECT TO anon, authenticated USING (true);
    """)

    # Legacy table: only exists in environments migrated from the old schema.
    op.execute("""
        DO $$
        BEGIN
            IF to_regclass('public.toilets') IS NOT NULL THEN
                ALTER TABLE public.toilets ENABLE ROW LEVEL SECURITY;
                REVOKE ALL ON TABLE public.toilets FROM anon, authenticated;
                GRANT SELECT ON TABLE public.toilets TO anon, authenticated;
            END IF;
        END $$;
    """)

    # Future tables created by the migration role default to read-only for
    # the API roles instead of Supabase's permissive full-DML default.
    op.execute("""
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON TABLES FROM anon, authenticated;
    """)

    # --- Indexes -----------------------------------------------------------
    # Duplicate GIST index (idx_toilet_location_geom already covers geom).
    op.execute("DROP INDEX IF EXISTS public.toilet_location_geom_idx")
    # Serves ST_DWithin(geom::geography, ...) in find_nearest_toilets.
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_toilet_location_geog
        ON public.toilet_location USING gist ((geom::geography))
    """)
    # Serves the zoomed-out branch of get_toilets_deterministic_v3
    # (WHERE country_code = ... ORDER BY id).
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_toilet_location_country_id
        ON public.toilet_location (country_code, id)
    """)

    # --- Hardened + index-friendly functions -------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION find_nearest_toilets(
            user_lat double precision,
            user_lng double precision,
            radius_meters double precision DEFAULT 20000,
            result_limit integer DEFAULT 3
        )
        RETURNS TABLE (
            id uuid, name character varying, lat double precision, lng double precision,
            address character varying, accessible boolean, is_free boolean, type character varying,
            status character varying, notes character varying, city character varying, open_hours character varying,
            distance double precision, created_at timestamp with time zone
        )
        AS $$
        DECLARE
            capped_radius double precision := LEAST(GREATEST(COALESCE(radius_meters, 20000), 1), 100000);
            capped_limit integer := LEAST(GREATEST(COALESCE(result_limit, 3), 1), 50);
            origin geometry;
        BEGIN
            IF user_lat IS NULL OR user_lng IS NULL OR
               user_lat < -90 OR user_lat > 90 OR user_lng < -180 OR user_lng > 180 THEN
                RAISE EXCEPTION 'Invalid coordinates';
            END IF;
            origin := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326);

            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.address, t.accessible, t.is_free,
                   t.type, t.status, t.notes, t.city, t.open_hours,
                   ST_Distance(t.geom::geography, origin::geography)::double precision,
                   t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL
              AND ST_DWithin(t.geom::geography, origin::geography, capped_radius)
            ORDER BY t.geom <-> origin
            LIMIT capped_limit;
        END;
        $$ LANGUAGE plpgsql STABLE SET search_path = public, extensions;
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION find_toilets_in_view (
          min_lat double precision, min_lng double precision,
          max_lat double precision, max_lng double precision,
          max_results integer DEFAULT 2000
        ) RETURNS TABLE (
          id uuid, name character varying, lat double precision, lng double precision,
          accessible boolean, open_hours character varying, address character varying, created_at timestamp with time zone
        ) AS $$
        DECLARE
            capped_limit integer := LEAST(GREATEST(COALESCE(max_results, 2000), 1), 2000);
        BEGIN
          RETURN QUERY
          SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
          FROM toilet_location t
          WHERE t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
          LIMIT capped_limit;
        END;
        $$ LANGUAGE plpgsql STABLE SET search_path = public, extensions;
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION get_toilets_deterministic_v3 (
          p_center_lat double precision,
          p_center_lng double precision,
          p_user_lat double precision DEFAULT NULL,
          p_user_lng double precision DEFAULT NULL,
          p_is_zoomed_in boolean DEFAULT true,
          result_limit integer DEFAULT 1000
        ) RETURNS TABLE (
          id uuid, name character varying, lat double precision, lng double precision,
          accessible boolean, open_hours character varying, address character varying, created_at timestamp with time zone
        ) AS $$
        DECLARE
          center_geom geometry;
          inferred_country countrycode;
          capped_limit integer := LEAST(GREATEST(COALESCE(result_limit, 1000), 1), 1000);
        BEGIN
          IF p_center_lat IS NULL OR p_center_lng IS NULL OR
             p_center_lat < -90 OR p_center_lat > 90 OR
             p_center_lng < -180 OR p_center_lng > 180
          THEN
             RAISE EXCEPTION 'Invalid map center coordinates provided: %, %', p_center_lat, p_center_lng;
          END IF;
          center_geom := ST_SetSRID(ST_MakePoint(p_center_lng, p_center_lat), 4326);

          -- Infer the country from the 5 nearest toilets to the map center
          -- (bounded KNN via the GIST index).
          SELECT mode() WITHIN GROUP (ORDER BY nk.country_code)
          INTO inferred_country
          FROM (
            SELECT t.country_code
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code IS NOT NULL
            ORDER BY t.geom <-> center_geom
            LIMIT 5
          ) nk;

          IF inferred_country IS NULL THEN
              inferred_country := 'CH';
          END IF;

          IF p_is_zoomed_in THEN
            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code = inferred_country
            ORDER BY t.geom <-> center_geom
            LIMIT capped_limit;
          ELSE
            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code = inferred_country
            ORDER BY t.id
            LIMIT capped_limit;
          END IF;
        END;
        $$ LANGUAGE plpgsql STABLE SET search_path = public, extensions;
    """)

    # Pin search_path on the trigger function too (Supabase linter requirement).
    op.execute("""
        ALTER FUNCTION update_toilet_location_geom() SET search_path = public, extensions;
    """)


def downgrade() -> None:
    op.execute("ALTER FUNCTION update_toilet_location_geom() RESET search_path")

    # Restore the previous (uncapped, cast-based) function bodies.
    op.execute("""
        CREATE OR REPLACE FUNCTION find_nearest_toilets(
            user_lat double precision,
            user_lng double precision,
            radius_meters double precision DEFAULT 20000,
            result_limit integer DEFAULT 3
        )
        RETURNS TABLE (
            id uuid, name character varying, lat double precision, lng double precision,
            address character varying, accessible boolean, is_free boolean, type character varying,
            status character varying, notes character varying, city character varying, open_hours character varying,
            distance double precision, created_at timestamp with time zone
        )
        AS $$
        BEGIN
            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.address, t.accessible, t.is_free,
                   t.type, t.status, t.notes, t.city, t.open_hours,
                   ST_Distance(t.geom, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography)::double precision,
                   t.created_at
            FROM toilet_location t
            WHERE ST_DWithin(t.geom, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_meters)
            ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)
            LIMIT result_limit;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION find_toilets_in_view (
          min_lat double precision, min_lng double precision,
          max_lat double precision, max_lng double precision,
          max_results integer DEFAULT 4000
        ) RETURNS TABLE (
          id uuid, name character varying, lat double precision, lng double precision,
          accessible boolean, open_hours character varying, address character varying, created_at timestamp with time zone
        ) AS $$
        BEGIN
          RETURN QUERY
          SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
          FROM toilet_location t
          WHERE t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
          LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)
    # (get_toilets_deterministic_v3's previous body is functionally identical
    # apart from the enum casts and caps; keeping the hardened version on
    # downgrade is acceptable and avoids another 80-line copy.)

    op.execute("DROP INDEX IF EXISTS public.idx_toilet_location_country_id")
    op.execute("DROP INDEX IF EXISTS public.idx_toilet_location_geog")
    op.execute("""
        CREATE INDEX IF NOT EXISTS toilet_location_geom_idx
        ON public.toilet_location USING gist (geom)
    """)

    op.execute("""
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON TABLES TO anon, authenticated;
    """)
    op.execute("""
        DROP POLICY IF EXISTS "Public read access" ON public.toilet_location;
        ALTER TABLE public.toilet_location DISABLE ROW LEVEL SECURITY;
        GRANT ALL ON TABLE public.toilet_location TO anon, authenticated;
    """)
