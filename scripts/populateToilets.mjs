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

    const name = props?.name || props?.adresse || 'Unnamed Toilet';
    const lng = coords[0];
    const lat = coords[1];
    const accessible = props?.kategorie?.toLowerCase().includes('rollstuhlgängig') || false;
    const open_hours = props?.oeffnungsz || null;
    const address = props?.adresse || null;
    const geomString = (lat && lng) ? `POINT(${lng} ${lat})` : null;

    const gebuehrenText = (props?.gebuehren || '').toLowerCase();
    let isFree = null; 
    if (gebuehrenText.includes('kostenlos') || gebuehrenText.includes('gratis')) {
      isFree = true;
    } else if (gebuehrenText.includes('gebühr') || gebuehrenText.includes('fr.')) {
      isFree = false;
    }

    const type = props?.kategorie || 'Unbekannt'; 
    
    let status = 'in Betrieb'; // Default to active
    const oeffnungszText = (props?.oeffnungsz || '').toLowerCase();
    if (oeffnungszText.includes('winterbetrieb') || oeffnungszText.includes('geschlossen')) {
        status = 'Eingeschränkt' // Or 'geschlossen' depending on interpretation
    }

    const notesParts = [];
    if (props?.bemerkung) notesParts.push(`Bemerkung: ${props.bemerkung}`);
    if (props?.kommentar) notesParts.push(`Kommentar: ${props.kommentar}`);
    if (props?.infrastruktur && props.infrastruktur !== ';NULL') notesParts.push(`Infrastruktur: ${props.infrastruktur.replace(/^;/,'')}`); // Clean leading ;
    if (props?.standort) notesParts.push(`Standort: ${props.standort}`);
    if (props?.www) notesParts.push(`WWW: ${props.www}`);
    const notes = notesParts.join(' | ') || null;

    return {
      name: name,
      lat: lat,
      lng: lng,
      accessible: accessible,
      open_hours: open_hours,
      address: address,
      geom: geomString,
      is_free: isFree,
      type: type,
      status: status,
      notes: notes,
      city: 'Zurich',
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