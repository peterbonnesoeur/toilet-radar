import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Setup ---
// Environment selection mirrors the Python side (db/config.py):
//   APP_ENV=local (default) -> .env.local
//   APP_ENV=dev             -> .env.dev
//   APP_ENV=prd             -> .env.prd
// Production is never targeted implicitly.
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

// --- Configuration ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const overpassUrl = 'https://overpass-api.de/api/interpreter';

// Must match the countrycode enum in the database.
const SUPPORTED_COUNTRIES = ['CH', 'FR', 'DE', 'IT', 'AT'];

// --- Argument Parsing ---
const args = process.argv.slice(2);
const countryArg = args.find(arg => arg.startsWith('--country='));
let countryCode = 'CH';
if (countryArg) {
  countryCode = countryArg.split('=')[1]?.toUpperCase();
}
if (!SUPPORTED_COUNTRIES.includes(countryCode)) {
  console.error(
    `Unsupported country '${countryCode}'. Supported: ${SUPPORTED_COUNTRIES.join(', ')} ` +
    `(the database countrycode enum must be extended first for new countries).`
  );
  process.exit(1);
}
console.log(`Country: ${countryCode}`);

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(`Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in ${ENV_FILES[APP_ENV]}.`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- Overpass Query ---
const overpassQuery = `
[out:json][timeout:240];
area["ISO3166-1"="${countryCode}"][admin_level=2]->.searchArea;
(
  node["amenity"="toilets"](area.searchArea);
);
out geom meta;
`;

// --- Helper: Map OSM tags to the toilet_location schema ---
function mapOsmToDb(element) {
  const tags = element.tags || {};
  const lat = element.lat;
  const lng = element.lon;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    console.warn(`Skipping element ID ${element.id} due to missing coordinates.`);
    return null;
  }

  let accessible = null;
  if (tags.wheelchair === 'yes') accessible = true;
  else if (tags.wheelchair === 'no') accessible = false;

  let is_free = null;
  if (tags.fee === 'no') is_free = true;
  else if (tags.fee === 'yes') is_free = false;

  const addressStreet = tags['addr:street'];
  const addressHN = tags['addr:housenumber'];
  const addressPostcode = tags['addr:postcode'];
  const addressCity = tags['addr:city'];
  const addressFull = [addressStreet, addressHN, addressPostcode, addressCity]
    .filter(Boolean).join(' ').trim() || null;

  const notesParts = [];
  if (tags.description) notesParts.push(`Description: ${tags.description}`);
  if (tags.note) notesParts.push(`Note: ${tags.note}`);
  if (tags.charge) notesParts.push(`Charge: ${tags.charge}`);
  if (tags.operator) notesParts.push(`Operator: ${tags.operator}`);
  const notes = notesParts.join('; ') || null;

  return {
    osm_id: element.id,
    name: tags.name || 'Public Toilet',
    lat,
    lng,
    // geom is computed by the BEFORE INSERT/UPDATE trigger from lat/lng.
    accessible,
    open_hours: tags.opening_hours || null,
    address: addressFull,
    is_free,
    type: tags['toilets:position'] ? `Position: ${tags['toilets:position']}` : 'Unknown',
    status: tags['disused:amenity'] === 'toilets' ? 'Disused' : 'in Betrieb',
    notes,
    city: addressCity || null,
    country_code: countryCode,
  };
}

// --- Main Function ---
async function populateFromOsm() {
  console.log(`Querying Overpass API (${overpassUrl}) for country ${countryCode}...`);
  try {
    const response = await axios.post(overpassUrl, `data=${encodeURIComponent(overpassQuery)}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const elements = response.data.elements;
    if (!elements) {
      console.error("No 'elements' array found in Overpass response:", response.data);
      process.exit(1);
    }
    console.log(`Received ${elements.length} elements from Overpass.`);

    const toilets = elements
      .filter(el => el.type === 'node')
      .map(mapOsmToDb)
      .filter(Boolean);

    console.log(`Prepared ${toilets.length} toilets for upsert.`);
    if (toilets.length === 0) return;

    // Idempotent: rows are matched on osm_id, so re-running refreshes
    // existing entries instead of duplicating them.
    const batchSize = 500;
    let upsertedCount = 0;
    let errorCount = 0;
    const totalBatches = Math.ceil(toilets.length / batchSize);

    for (let i = 0; i < toilets.length; i += batchSize) {
      const batch = toilets.slice(i, i + batchSize);
      const batchNo = Math.floor(i / batchSize) + 1;
      console.log(`Upserting batch ${batchNo}/${totalBatches} (${batch.length} toilets)...`);

      const { error } = await supabase
        .from('toilet_location')
        .upsert(batch, { onConflict: 'osm_id' });

      if (error) {
        console.error(`Error upserting batch ${batchNo}:`, error.message);
        errorCount += batch.length;
      } else {
        upsertedCount += batch.length;
      }
    }

    console.log(`Finished. Upserted: ${upsertedCount}, Failed: ${errorCount}.`);
    if (errorCount > 0) process.exit(1);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Axios error fetching data from Overpass:');
      console.error('Status:', error.response?.status);
      console.error('Data:', error.response?.data);
    } else {
      console.error('An unexpected error occurred during the process:', error);
    }
    process.exit(1);
  }
}

// --- Run ---
// Usage: APP_ENV=prd node scripts/populateFromOSM.mjs --country=CH
populateFromOsm();
