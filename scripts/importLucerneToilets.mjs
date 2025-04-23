import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Path to the JSON file
const jsonPath = path.resolve(__dirname, '../geo/TOILETTE_lucerne.json');

// Initialize Supabase client
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Function to convert Swiss coordinates (LV95/EPSG:2056) to WGS84 (latitude, longitude)
function swissToWGS84(e, n) {
  // Make sure we have numbers
  e = parseFloat(e);
  n = parseFloat(n);
  
  // Check if values are valid
  if (isNaN(e) || isNaN(n)) {
    return { lat: null, lng: null };
  }
  
  // Convert Swiss LV95 coordinates to WGS84
  // Convert LV95 to LV03 first
  const y_LV03 = e - 2000000;
  const x_LV03 = n - 1000000;
  
  // Convert LV03 to WGS84
  // This conversion uses the approximate formulas from swisstopo
  const y_aux = (y_LV03 - 600000) / 1000000;
  const x_aux = (x_LV03 - 200000) / 1000000;
  
  const lat = 16.9023892 
            + 3.238272 * x_aux 
            - 0.270978 * y_aux * y_aux 
            - 0.002528 * x_aux * x_aux 
            - 0.0447 * y_aux * y_aux * x_aux 
            - 0.0140 * x_aux * x_aux * x_aux;
            
  const lng = 2.6779094 
            + 4.728982 * y_aux 
            + 0.791484 * y_aux * x_aux 
            + 0.1306 * y_aux * x_aux * x_aux 
            - 0.0436 * y_aux * y_aux * y_aux;
            
  // Convert to degrees
  return { 
    lat: lat * 100 / 36, 
    lng: lng * 100 / 36 
  };
}

async function importLucerneToilets() {
  console.log(`Reading JSON file from: ${jsonPath}`);
  
  try {
    // Read and parse the JSON file
    const fileContent = fs.readFileSync(jsonPath, 'utf-8');
    const geoJSON = JSON.parse(fileContent);
    
    if (!geoJSON.features || !Array.isArray(geoJSON.features)) {
      console.error('Invalid GeoJSON format: features array not found');
      process.exit(1);
    }
    
    console.log(`Found ${geoJSON.features.length} toilets in the JSON file.`);
    
    // Transform the data
    const toiletsToInsert = geoJSON.features.map(feature => {
      const coordinates = feature.geometry.coordinates;
      const props = feature.properties;
      
      if (!coordinates || coordinates.length < 2) {
        console.warn(`Skipping feature ID ${props?.GlobalID || 'unknown'} due to missing coordinates.`);
        return null; // Skip entries without valid coordinates
      }

      // Convert Swiss coords to WGS84
      const { lat, lng } = swissToWGS84(coordinates[0], coordinates[1]);
      
      if (isNaN(lat) || isNaN(lng)) {
        console.warn(`Skipping feature ID ${props?.GlobalID || 'unknown'} due to invalid converted coordinates.`);
        return null;
      }
      
      // Check if it's accessible based on HINDERNISFREI field
      const accessible = props.HINDERNISFREI === 1;
      
      // Create the name - use NAME property or default
      const name = props.NAME ? `${props.NAME} - Luzern` : 'WC public - Luzern';
      
      // Extract postal code for address
      const address = props.ADRESSE ? props.ADRESSE : (props.PLZ ? `Luzern ${props.PLZ}` : 'Luzern');
      
      // Check if toilet is in operation
      const inOperation = props.IN_BETRIEB === 1;
      
      // Create an open_hours field - we don't have specific hours in this dataset
      const openHours = inOperation ? '24/7' : 'Closed';
      
      // Create PostGIS geometry string
      const geomString = `POINT(${lng} ${lat})`;
      
      // --- Map new fields ---
      const isFree = true; // Assuming free unless specified otherwise in data
      const type = props?.ART_resolved || 'Unbekannt';
      const status = props?.IN_BETRIEB_resolved === 'Ja' ? 'in Betrieb' : 'geschlossen';
      const notes = props?.LINK_ROUTING ? `Link: ${props.LINK_ROUTING}` : null;
      // --- End map new fields ---

      return {
        name,
        lat: lat,
        lng: lng,
        accessible,
        open_hours: openHours,
        address,
        geom: geomString,
        is_free: isFree,
        type: type,
        status: status,
        notes: notes,
        city: 'Luzern', // Add city identifier
      };
    }).filter(toilet => toilet !== null);
    
    if (toiletsToInsert.length === 0) {
      console.log("No valid toilet entries found to insert after coordinate conversion.");
      return;
    }
    
    console.log(`Attempting to insert ${toiletsToInsert.length} toilets into the database...`);
    
    // Insert data in batches
    const batchSize = 100;
    for (let i = 0; i < toiletsToInsert.length; i += batchSize) {
      const batch = toiletsToInsert.slice(i, i + batchSize);
      console.log(`Inserting batch ${Math.floor(i / batchSize) + 1}...`);
      
      const { data, error } = await supabase
        .from('toilets')
        .insert(batch);
      
      if (error) {
        console.error('Error inserting batch:', error);
      } else {
        console.log(`Successfully inserted batch ${Math.floor(i / batchSize) + 1}.`);
      }
    }
    
    console.log('Lucerne toilets import completed successfully.');
    
  } catch (error) {
    console.error(`Error processing the JSON file: ${error.message}`);
    process.exit(1);
  }
}

// Run the import function
importLucerneToilets(); 