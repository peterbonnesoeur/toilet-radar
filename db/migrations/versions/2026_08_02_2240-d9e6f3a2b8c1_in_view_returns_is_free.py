"""in_view_returns_is_free

find_toilets_in_view now also returns is_free so the frontend "Free" filter
and popups have fee information. Changing a RETURNS TABLE signature requires
DROP + CREATE. Old clients simply ignore the extra column.

Revision ID: d9e6f3a2b8c1
Revises: c8d5e2f1a4b7
Create Date: 2026-08-02 22:40:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd9e6f3a2b8c1'
down_revision = 'c8d5e2f1a4b7'
branch_labels = None
depends_on = None

_PARAMS = """
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  max_results integer DEFAULT 2000
"""


def upgrade() -> None:
    op.execute("""
        DROP FUNCTION IF EXISTS find_toilets_in_view(
            double precision, double precision, double precision, double precision, integer
        )
    """)
    op.execute(f"""
        CREATE FUNCTION find_toilets_in_view ({_PARAMS})
        RETURNS TABLE (
          id uuid, name character varying, lat double precision, lng double precision,
          accessible boolean, is_free boolean, open_hours character varying,
          address character varying, created_at timestamp with time zone
        ) AS $$
        DECLARE
            capped_limit integer := LEAST(GREATEST(COALESCE(max_results, 2000), 1), 2000);
        BEGIN
          RETURN QUERY
          SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.is_free, t.open_hours, t.address, t.created_at
          FROM toilet_location t
          WHERE t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
          LIMIT capped_limit;
        END;
        $$ LANGUAGE plpgsql STABLE SET search_path = public, extensions;
    """)


def downgrade() -> None:
    op.execute("""
        DROP FUNCTION IF EXISTS find_toilets_in_view(
            double precision, double precision, double precision, double precision, integer
        )
    """)
    op.execute(f"""
        CREATE FUNCTION find_toilets_in_view ({_PARAMS})
        RETURNS TABLE (
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
