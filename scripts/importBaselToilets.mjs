import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';


// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Debug: Log loaded environment variables
console.log('Loaded ENV Vars:', {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Loaded' : 'Missing',
  key: process.env.SUPABASE_SERVICE_KEY ? 'Loaded' : 'Missing',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Supabase URL or Service Role Key is missing. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are set in your .env.local file.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const jsonFilePath = path.resolve(__dirname, '../geo/wc_basel.json');

async function importBaselToilets() {
  try {
    // Read the JSON file
    const jsonData = fs.readFileSync(jsonFilePath, 'utf-8');
    const toiletsData = JSON.parse(jsonData);

    console.log(`Read ${toiletsData.length} toilet entries from ${jsonFilePath}`);

    // Prepare data for Supabase insertion
    const toiletsToInsert = toiletsData
      .map((toilet) => {
        const lat = toilet.geo_point_2d?.lat;
        const lon = toilet.geo_point_2d?.lon;

        // Skip entries without valid coordinates
        if (typeof lat !== 'number' || typeof lon !== 'number') {
          console.warn(`Skipping toilet due to missing coordinates: ${toilet.bezeichnug}`);
          return null;
        }

        // Map fields to your 'toilets' table schema
        const feeString = toilet.gebuehr?.toLowerCase() ?? 'unbekannt';
        const isFree = feeString === 'kostenlos';

        const wheelchairAccessible = toilet.eurokey?.toLowerCase() === 'ja' || toilet.typ?.toLowerCase().includes('rollstuhl');

        const notesParts = [];
        if (toilet.kategorie) notesParts.push(`Kategorie: ${toilet.kategorie}`);
        if (toilet.zusatz && toilet.zusatz !== '-') notesParts.push(`Zusatz: ${toilet.zusatz}`);
        if (toilet.www_link) notesParts.push(`Link: ${toilet.www_link}`);
        // map_links seems less useful for general notes

        return {
          name: toilet.bezeichnug || 'Unbekannt',
          address: `${toilet.strasse || ''}, ${toilet.plz || ''} ${toilet.ort || 'Basel'}`,
          lat: lat,
          lng: lon,
          is_free: isFree,
          accessible: wheelchairAccessible,
          type: toilet.typ || 'Unbekannt',
          status: toilet.status || 'Unbekannt',
          notes: notesParts.join('; ') || null,
          city: 'Basel',
          geom: `POINT(${lon} ${lat})`,
        };
      })
      .filter(Boolean); // Remove null entries (skipped toilets)

    console.log(`Prepared ${toiletsToInsert.length} toilets for insertion.`);

    // Insert data into Supabase in batches (optional, but good practice for large datasets)
    const batchSize = 100; // Adjust batch size as needed
    for (let i = 0; i < toiletsToInsert.length; i += batchSize) {
      const batch = toiletsToInsert.slice(i, i + batchSize);
      const { error } = await supabase.from('toilets').insert(batch);

      if (error) {
        console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
        // Decide if you want to stop on error or continue with next batch
        // process.exit(1);
      } else {
        console.log(
          `Successfully inserted batch ${i / batchSize + 1} (${batch.length} toilets)`
        );
      }
    }

    console.log('Finished importing Basel toilets.');
  } catch (error) {
    console.error('Error importing Basel toilets:', error);
    process.exit(1);
  }
}

importBaselToilets(); 