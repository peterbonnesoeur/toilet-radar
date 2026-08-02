import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Setup ---
// Environment selection mirrors the Python side (db/config.py):
//   APP_ENV=local (default) -> .env.local, dev -> .env.dev, prd -> .env.prd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ENV = (process.env.APP_ENV || 'local').toLowerCase();
const ENV_FILES = { local: '.env.local', dev: '.env.dev', prd: '.env.prd' };
if (!ENV_FILES[APP_ENV]) {
  console.error(`APP_ENV must be one of ${Object.keys(ENV_FILES).join(', ')}, got '${APP_ENV}'`);
  process.exit(1);
}
dotenv.config({ path: path.resolve(__dirname, '..', ENV_FILES[APP_ENV]) });
console.log(`Environment: ${APP_ENV} (${ENV_FILES[APP_ENV]})`);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// --- Configuration ---
const DB_QUERY_BATCH_SIZE = 100;

// Delay between Nominatim calls. Their usage policy requires >= 1000ms.
const API_CALL_DELAY_MS = 1000;

const NOMINATIM_USER_AGENT =
  'ToiletRadar/1.0 (github.com/peterbonnesoeur/toilet-radar; maxime.bonn@gmail.com)';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(`Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in ${ENV_FILES[APP_ENV]}.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- Reverse Geocoding (Nominatim) ---
/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{address: string | null, city: string | null} | null>}
 */
async function reverseGeocode(lat, lng) {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat,
        lon: lng,
        format: 'json',
        addressdetails: 1,
        'accept-language': 'en',
        zoom: 18,
      },
      headers: { 'User-Agent': NOMINATIM_USER_AGENT },
      timeout: 10000,
    });

    const fullAddress = response.data?.display_name || null;
    const addressData = response.data?.address;
    const city = addressData
      ? addressData.city || addressData.town || addressData.village || addressData.county || null
      : null;

    if (!fullAddress && !city) return null;
    return { address: fullAddress, city };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    console.error(`   Nominatim error${status ? ` (${status})` : ''} for ${lat}, ${lng}: ${error.message}`);
    return null;
  }
}

// --- Main Enrichment Function ---
async function enrichAddresses() {
  console.log('Starting address enrichment (Nominatim, 1 req/s)...');

  let totalProcessed = 0;
  let totalUpdated = 0;
  // Keyset pagination on id: rows updated mid-run drop out of the filter,
  // which would make offset pagination skip rows. The id cursor also
  // guarantees progress past rows whose geocoding fails.
  let lastId = null;

  for (;;) {
    let query = supabase
      .from('toilet_location')
      .select('id, lat, lng, name')
      .or('address.is.null,address.eq.""')
      .order('id', { ascending: true })
      .limit(DB_QUERY_BATCH_SIZE);
    if (lastId) query = query.gt('id', lastId);

    const { data: toilets, error: fetchError } = await query;

    if (fetchError) {
      console.error('Error fetching toilets from database:', fetchError.message);
      process.exit(1);
    }
    if (!toilets || toilets.length === 0) {
      console.log('No more toilets needing address enrichment.');
      break;
    }

    console.log(`Processing ${toilets.length} toilets (cursor: ${lastId ?? 'start'})...`);
    lastId = toilets[toilets.length - 1].id;

    for (const toilet of toilets) {
      totalProcessed++;
      if (toilet.lat == null || toilet.lng == null) continue;

      const result = await reverseGeocode(toilet.lat, toilet.lng);

      if (result) {
        const updateData = {};
        if (result.address) updateData.address = result.address;
        if (result.city) updateData.city = result.city;

        const { error: updateError } = await supabase
          .from('toilet_location')
          .update(updateData)
          .eq('id', toilet.id);

        if (updateError) {
          console.error(`Failed to update toilet ID ${toilet.id}:`, updateError.message);
        } else {
          totalUpdated++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS));
    }

    console.log(`Progress: processed ${totalProcessed}, updated ${totalUpdated}.`);
  }

  console.log(`Finished enrichment. Processed: ${totalProcessed}, Updated: ${totalUpdated}.`);
}

// --- Run ---
// Usage: APP_ENV=prd node scripts/enrichAddresses.mjs
enrichAddresses();
