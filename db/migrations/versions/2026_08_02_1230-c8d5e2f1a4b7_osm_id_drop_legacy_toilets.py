"""osm_id_drop_legacy_toilets

- Adds osm_id (unique, nullable) to toilet_location so OSM imports can
  upsert idempotently instead of duplicating rows on every run.
- Removes leftover 'Test Toilet (DELETE ME)' rows that ranked first in
  nearest-toilet results around Zurich HB.
- Drops the legacy toilets table: it was a full 1:1 copy of toilet_location
  (verified 57,087 = 57,087 rows, matching ids, all osm_id values NULL) kept
  only as a fallback query target.

Revision ID: c8d5e2f1a4b7
Revises: b7c4d1a2e9f3
Create Date: 2026-08-02 12:30:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'c8d5e2f1a4b7'
down_revision = 'b7c4d1a2e9f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE public.toilet_location
        ADD COLUMN IF NOT EXISTS osm_id bigint
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'toilet_location_osm_id_key'
            ) THEN
                ALTER TABLE public.toilet_location
                ADD CONSTRAINT toilet_location_osm_id_key UNIQUE (osm_id);
            END IF;
        END $$;
    """)

    op.execute("""
        DELETE FROM public.toilet_location
        WHERE name = 'Test Toilet (DELETE ME)'
    """)

    op.execute("DROP TABLE IF EXISTS public.toilets")


def downgrade() -> None:
    # The legacy toilets table and its data are intentionally not restored.
    op.execute("""
        ALTER TABLE public.toilet_location
        DROP CONSTRAINT IF EXISTS toilet_location_osm_id_key
    """)
    op.execute("""
        ALTER TABLE public.toilet_location
        DROP COLUMN IF EXISTS osm_id
    """)
