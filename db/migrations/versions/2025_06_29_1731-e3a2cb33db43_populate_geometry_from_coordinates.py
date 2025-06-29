"""populate_geometry_from_coordinates

Revision ID: e3a2cb33db43
Revises: 0e002d492d08
Create Date: 2025-06-29 17:31:50.495407

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import geoalchemy2


# revision identifiers, used by Alembic.
revision = 'e3a2cb33db43'
down_revision = '0e002d492d08'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update geometry data from existing lat/lng coordinates
    op.execute("""
        UPDATE toilet_location 
        SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326) 
        WHERE lng IS NOT NULL AND lat IS NOT NULL AND geom IS NULL;
    """)
    
    # Create a trigger to automatically update geometry when lat/lng changes
    op.execute("""
        CREATE OR REPLACE FUNCTION update_toilet_location_geom()
        RETURNS TRIGGER AS $$
        BEGIN
            -- Update geometry when lat/lng is set
            IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
                NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
            ELSE
                NEW.geom = NULL;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    
    # Create trigger on toilet_location table
    op.execute("""
        DROP TRIGGER IF EXISTS trigger_update_toilet_location_geom ON toilet_location;
        CREATE TRIGGER trigger_update_toilet_location_geom
            BEFORE INSERT OR UPDATE OF lat, lng ON toilet_location
            FOR EACH ROW
            EXECUTE FUNCTION update_toilet_location_geom();
    """)
    
    # Ensure the spatial index exists for performance
    op.execute("""
        CREATE INDEX IF NOT EXISTS toilet_location_geom_idx 
        ON toilet_location USING gist (geom);
    """)


def downgrade() -> None:
    # Remove the trigger and function
    op.execute("DROP TRIGGER IF EXISTS trigger_update_toilet_location_geom ON toilet_location")
    op.execute("DROP FUNCTION IF EXISTS update_toilet_location_geom()")
    
    # Clear geometry data (optional - you might want to keep it)
    op.execute("UPDATE toilet_location SET geom = NULL")
    
    # Drop the spatial index
    op.execute("DROP INDEX IF EXISTS toilet_location_geom_idx") 