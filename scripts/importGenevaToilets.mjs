import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import proj4 from 'proj4';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local file
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    'Error: Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are set in your .env.local file.'
  );
  process.exit(1);
}

// Path to the CSV file
const csvPath = path.resolve(__dirname, '../geo/VDG_WC_PUBLIC.csv');

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Define coordinate systems for proj4
// LV95 (EPSG:2056) - Swiss CH1903+
proj4.defs("EPSG:2056", "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs");
// WGS84 (EPSG:4326) - Standard Lat/Lng
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

// Conversion function using proj4
function swissLV95toWGS84(easting, northing) {
  try {
    const e = parseFloat(easting);
    const n = parseFloat(northing);
    if (isNaN(e) || isNaN(n)) {
        throw new Error('Invalid coordinate input');
    }
    // Define the source and destination CRS
    const sourceCRS = "EPSG:2056";
    const destCRS = "EPSG:4326";

    // Perform the conversion
    const [lng, lat] = proj4(sourceCRS, destCRS, [e, n]);
    return { lat, lng };
  } catch (error) {
      console.error(`Coordinate conversion error for E=${easting}, N=${northing}: ${error.message}`);
      return { lat: NaN, lng: NaN }; // Return NaN on error
  }
}

// Function to determine if toilet is accessible based on USAGER and ACCESSIBILITE fields
function isAccessible(usager, accessibilite) {
  // Check if "Handicapés" is mentioned in the USAGER field
  const handicapMentioned = usager && usager.includes('Handicapés');
  
  // Check if accessibility mentions wheelchair or PMR
  const wheelchairAccessible = accessibilite && (
    accessibilite.toLowerCase().includes('pmr') || 
    accessibilite.toLowerCase().includes('plain-pied')
  );
  
  // Return true or false explicitly to ensure boolean type
  return handicapMentioned && wheelchairAccessible ? true : false;
}

async function importGenevaToilets() {
  console.log(`Reading CSV file from: ${csvPath}`);
  
  try {
    // Read and parse the CSV file using csv-parse
    const csvData = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvData, {
      columns: true, // Treat the first row as headers
      delimiter: ';', // Specify the delimiter
      skip_empty_lines: true,
      trim: true, // Trim whitespace from values
      relax_column_count: true // Allow variable number of columns if needed
    });

    console.log(`Parsed ${records.length} toilet entries from ${csvPath}`);

    // Prepare data for Supabase insertion
    const toiletsToInsert = records
      .map((record, index) => {
        // Extract data using header names
        const statusRaw = record.STATUT;
        const typeRaw = record.TYPE;
        const nameRaw = record.INTITULE;
        const addressRaw = record.ADRESSE;
        const quartierRaw = record.QUARTIER;
        const situationRaw = record.SITUATION;
        const usagerRaw = record.USAGER;
        const accessibiliteRaw = record.ACCESSIBILITE;
        const ouvertureRaw = record.OUVERTURE;
        const photoLinkRaw = record.LIEN_PHOTO;
        const remarquesRaw = record.REMARQUES;
        const eastingRaw = record.E; // E
        const northingRaw = record.N; // N

        // Convert coordinates using the corrected function
        const { lat, lng } = swissLV95toWGS84(eastingRaw, northingRaw);

        if (isNaN(lat) || isNaN(lng)) {
            console.warn(`Skipping record ${index + 1} (ID: ${record.ID_LOM || 'N/A'}) due to invalid/unconvertible coordinates: E=${eastingRaw}, N=${northingRaw}`);
            return null;
        }

        // Map fields
        const name = nameRaw || 'Unnamed Toilet';
        // Combine address and quartier more robustly
        const addressParts = [addressRaw, quartierRaw].filter(Boolean); // Filter out empty parts
        const address = addressParts.join(', ') || null;

        const geomString = `POINT(${lng} ${lat})`;
        const accessible = accessibiliteRaw?.toLowerCase().includes('handicap') || accessibiliteRaw?.toLowerCase().includes('pmr') || accessibiliteRaw?.toLowerCase().includes('plain-pied');

        // --- Map new fields ---
        const isFree = true; // Defaulting to true as no fee info available
        const type = typeRaw || 'Unbekannt';
        const status = statusRaw === 'Actif' ? 'in Betrieb' : (statusRaw || 'Unbekannt');

        const notesParts = [];
        if (situationRaw) notesParts.push(`Situation: ${situationRaw}`);
        if (usagerRaw) notesParts.push(`Usager: ${usagerRaw}`);
        // Keep Ouverture separate for open_hours if possible, or include here if not
        // if (ouvertureRaw) notesParts.push(`Ouverture: ${ouvertureRaw}`); 
        if (remarquesRaw) notesParts.push(`Remarques: ${remarquesRaw}`);
        if (photoLinkRaw) notesParts.push(`Photo: ${photoLinkRaw}`);
        const notes = notesParts.join('; ') || null;
        // --- End map new fields ---

        // Attempt to map opening hours
        let open_hours = null;
        if (ouvertureRaw?.toLowerCase() === 'annuelle') {
            open_hours = 'Annual (assumed 24/7 unless specified)'; 
        } else if (ouvertureRaw?.toLowerCase().includes('mai') && ouvertureRaw?.toLowerCase().includes('octobre')) {
            open_hours = 'May - October';
        } else if (ouvertureRaw?.toLowerCase().includes('mai') && ouvertureRaw?.toLowerCase().includes('septembre')) {
            open_hours = 'May - September';
        } else if (ouvertureRaw?.toLowerCase().includes('mars') && ouvertureRaw?.toLowerCase().includes('octobre')) {
            open_hours = 'March - October';
        } else if (ouvertureRaw?.toLowerCase().includes('juillet') && ouvertureRaw?.toLowerCase().includes('septembre')) {
            open_hours = 'July - September';
        } else if (ouvertureRaw) {
            open_hours = ouvertureRaw; // Keep original if specific pattern not matched
        }


        return {
          name: name,
          lat: lat,
          lng: lng,
          accessible: accessible,
          address: address,
          geom: geomString,
          open_hours: open_hours, 
          is_free: isFree,
          type: type,
          status: status,
          notes: notes,
          city: 'Geneva',
          // Add original E/N as notes for reference if needed
          // notes: notes ? `${notes}; E:${eastingRaw}, N:${northingRaw}` : `E:${eastingRaw}, N:${northingRaw}`,
        };
      })
      .filter(Boolean); // Remove null entries

    console.log(`Prepared ${toiletsToInsert.length} valid toilets for insertion.`);

    if (toiletsToInsert.length === 0) {
        console.log("No valid toilets to insert after filtering.");
        return;
    }

    // Insert data into Supabase in batches
    const batchSize = 100;
    for (let i = 0; i < toiletsToInsert.length; i += batchSize) {
      const batch = toiletsToInsert.slice(i, i + batchSize);
      console.log(`Inserting batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(toiletsToInsert.length / batchSize)}...`);
      const { error } = await supabase.from('toilets').insert(batch);

      if (error) {
        console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error);
        // Optional: break or continue on error
        // break; 
      } else {
        console.log(
          `Successfully inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} toilets)`
        );
      }
    }

    console.log('Finished importing Geneva toilets.');
  } catch (error) {
    console.error('Error importing Geneva toilets:', error);
    process.exit(1);
  }
}

// Run the import function
importGenevaToilets(); 