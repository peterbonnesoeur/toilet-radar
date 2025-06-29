"""Create toilet_location table

Revision ID: 839328d06171
Revises: 
Create Date: 2025-06-22 15:03:45.285681

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import geoalchemy2
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '839328d06171'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostGIS should be installed globally in public schema
    # Just ensure it exists (this should be a no-op if already installed)
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    
    # Create the enum type if it doesn't exist
    op.execute("""
        DO $$ BEGIN 
            CREATE TYPE countrycode AS ENUM ('CH', 'FR', 'DE', 'IT', 'AT'); 
        EXCEPTION WHEN duplicate_object THEN 
            null; 
        END $$;
    """)
    
    # Create toilet_location table
    op.create_table(
        'toilet_location',
        sa.Column('id', sa.UUID(), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.VARCHAR(), nullable=True),
        sa.Column('lat', sa.FLOAT(), nullable=True),
        sa.Column('lng', sa.FLOAT(), nullable=True),
        sa.Column('accessible', sa.BOOLEAN(), nullable=True),
        sa.Column('open_hours', sa.VARCHAR(), nullable=True),
        sa.Column('address', sa.VARCHAR(), nullable=True),
        sa.Column('rating', sa.INTEGER(), nullable=True),
        sa.Column('is_free', sa.BOOLEAN(), nullable=True),
        sa.Column('type', sa.VARCHAR(), nullable=True),
        sa.Column('status', sa.VARCHAR(), nullable=True),
        sa.Column('notes', sa.VARCHAR(), nullable=True),
        sa.Column('city', sa.VARCHAR(), nullable=True),
        sa.Column('country_code', postgresql.ENUM('CH', 'FR', 'DE', 'IT', 'AT', name='countrycode', create_type=False), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), nullable=True, server_default=sa.text('now()')),
        sa.Column('geom', geoalchemy2.Geometry(geometry_type='POINT', srid=4326), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes if they don't exist
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_toilet_location_country_code') THEN
                CREATE INDEX idx_toilet_location_country_code ON toilet_location (country_code);
            END IF;
        END $$;
    """)
    
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_toilet_location_geom') THEN
                CREATE INDEX idx_toilet_location_geom ON toilet_location USING gist (geom);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    # Drop toilet_location table and its indexes
    op.drop_table('toilet_location')
    
    # Note: We don't drop the enum type in downgrade since it might be used by other tables 