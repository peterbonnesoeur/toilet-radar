import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path'; // Import path module
import { fileURLToPath } from 'url'; // To get __dirname in ES modules

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local file at the project root
dotenv.config({ path: path.resolve(__dirname, '../.env.local') }); 

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// IMPORTANT: Use the Service Role Key for backend scripts like this!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    'Error: Make sure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in your .env file.'
  );
  process.exit(1);
}

// Adjust the path to your GeoJSON file - assuming it's in the project root
const geojsonPath = path.resolve(__dirname, '../geo/geojson.json'); 

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function populateDatabase() {
  console.log(`Reading GeoJSON file from: ${geojsonPath}`);
  let geojsonData;
  try {
    const rawData = fs.readFileSync(geojsonPath, 'utf-8');
    geojsonData = JSON.parse(rawData);
  } catch (error) {
    console.error(`Error reading or parsing GeoJSON file: ${error.message}`);
    process.exit(1);
  }

  if (!geojsonData || !geojsonData.features || !Array.isArray(geojsonData.features)) {
    console.error('Error: Invalid GeoJSON format. Expected an object with a "features" array.');
    process.exit(1);
  }

  console.log(`Found ${geojsonData.features.length} features (toilets) in the file.`);

  const toiletsToInsert = geojsonData.features.map(feature => {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;

    if (!coords || coords.length < 2) {
      console.warn(`Skipping feature ID ${feature.id || 'unknown'} due to missing coordinates.`);
      return null; // Skip entries without valid coordinates
    }

    const name = props?.name || props?.adresse || 'Unnamed Toilet'; // Use address if name is missing
    const lng = coords[0];
    const lat = coords[1];
    // Check if the category indicates accessibility
    const accessible = props?.kategorie?.toLowerCase().includes('rollstuhlgängig') || false;
    const open_hours = props?.oeffnungsz || null; // Use null if undefined
    const address = props?.adresse || null; // <-- Add this line to get the address
    // Create PostGIS geometry string
    const geomString = (lat && lng) ? `SRID=4326;POINT(${lng} ${lat})` : null;

    return {
      name: name,
      lat: lat,
      lng: lng,
      accessible: accessible,
      open_hours: open_hours,
      address: address, // <-- Add address to the object being inserted
      geom: geomString // <-- Add geom value for insertion
      // id and created_at will be handled by the database defaults
    };
  }).filter(toilet => toilet !== null); // Remove null entries

  if (toiletsToInsert.length === 0) {
      console.log("No valid toilet entries found to insert.");
      return;
  }

  console.log(`Attempting to insert ${toiletsToInsert.length} toilets into the database...`);

  // Insert data in batches (optional, but good practice for large datasets)
  const batchSize = 100;
  for (let i = 0; i < toiletsToInsert.length; i += batchSize) {
    const batch = toiletsToInsert.slice(i, i + batchSize);
    console.log(`Inserting batch ${i / batchSize + 1}...`);
    const { data, error } = await supabase
      .from('toilets')
      .insert(batch);

    if (error) {
      console.error('Error inserting batch:', error);
      // Decide if you want to stop on error or continue with next batch
      // process.exit(1); 
    } else {
      console.log(`Successfully inserted batch ${i / batchSize + 1}.`);
      // console.log('Inserted data:', data); // Optional: log inserted data
    }
  }

  console.log('Database population process finished.');
}

populateDatabase(); 