import { createClient } from '@supabase/supabase-js';
import axios from 'axios'; // Using axios for HTTP requests
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// --- Configuration ---
// How many toilets to process in each database query batch
const DB_QUERY_BATCH_SIZE = 100;

// How many toilets to process in each Google API batch
const GOOGLE_API_BATCH_SIZE = 10;

// Delay between Google API batches (in milliseconds)
const GOOGLE_API_DELAY = 1000; // 1 second

// Delay between external API calls (in milliseconds) to respect rate limits
const API_CALL_DELAY_MS = 1000; // IMPORTANT: Minimum 1000 for Nominatim

// Define a User-Agent string for Nominatim - PLEASE MODIFY THIS
const NOMINATIM_USER_AGENT = 'ToiletRadarApp/1.0 (github.com/your-repo; your-email@example.com)'; // Replace with your actual info

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are set.');
  process.exit(1);
}


const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- Reverse Geocoding Function (Nominatim Implementation) ---
/**
 * Calls Nominatim reverse geocoding service to get address from lat/lng.
 * @param {number} lat Latitude
 * @param {number} lng Longitude
 * @returns {Promise<{address: string | null, city: string | null} | null>}
 *          Object with address/city or null if failed/not found.
 */
async function reverseGeocode(lat, lng) {
  console.log(`-> Nominatim Geocoding: ${lat}, ${lng}`);
  const nominatimUrl = 'https://nominatim.openstreetmap.org/reverse';
  const params = {
    lat: lat,
    lon: lng,
    format: 'json',
    addressdetails: 1, // Request detailed address components
    'accept-language': 'en', // Optional: Prefer English results
     zoom: 18 // Level of detail (18 is typically building/street level)
  };

  try {
    const response = await axios.get(nominatimUrl, {
      params: params,
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT // **MANDATORY for Nominatim**
      },
      timeout: 10000 // Set a timeout (10 seconds)
    });

    if (response.data && response.data.address) {
      const addressData = response.data.address;
      // Use display_name as the primary address string
      const fullAddress = response.data.display_name || null;

      // Attempt to extract city - priority: city, town, village, county
      const city = addressData.city || addressData.town || addressData.village || addressData.county || null;

      console.log(`   Nominatim Success: Found address for ${lat}, ${lng}`);
      return { address: fullAddress, city: city };
    } else {
      console.log(`   Nominatim Success: No address details found for ${lat}, ${lng}`);
      // Even if address details are missing, display_name might exist
      if (response.data.display_name) {
         return { address: response.data.display_name, city: null };
      }
      return null; // No results found
    }
  } catch (error) {
     if (axios.isAxiosError(error)) {
        console.error(`   Nominatim Error (${error.response?.status}) for ${lat}, ${lng}:`, error.message);
        // Log response data if available for debugging
        if(error.response?.data) {
            console.error('   Nominatim Response Data:', JSON.stringify(error.response.data).substring(0, 200) + '...');
        }
     } else {
        console.error(`   Nominatim Error for ${lat}, ${lng}:`, error.message);
     }
     // Don't overwhelm logs on persistent errors like 429 Too Many Requests
     if (error.response?.status !== 429) {
         // Handle specific errors if needed (e.g., 429 means slow down further)
     }
    return null; // Return null on failure
  }
}

// --- Main Enrichment Function ---
async function enrichAddresses() {
  console.log('Starting address enrichment process (Nominatim)...');
  console.warn(`Using Nominatim with User-Agent: ${NOMINATIM_USER_AGENT}`);
  console.warn(`API Call Delay set to: ${API_CALL_DELAY_MS}ms (MUST be >= 1000ms)`);

  let totalProcessed = 0;
  let totalUpdated = 0;
  let dbQueryOffset = 0;
  let keepFetching = true;

  while (keepFetching) {
    console.log(`Fetching batch of toilets starting from offset ${dbQueryOffset}...`);
    
    // Fetch a batch of toilets where address is null or maybe too short
    const { data: toilets, error: fetchError } = await supabase
      .from('toilet_location')
      .select('id, lat, lng, address, city, name')
      .or('address.is.null,address.eq.""')
      .range(dbQueryOffset, dbQueryOffset + DB_QUERY_BATCH_SIZE - 1)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching toilets from database:', fetchError);
      break;
    }

    if (!toilets || toilets.length === 0) {
      console.log('No more toilets found needing address enrichment.');
      keepFetching = false; // Stop if no more toilets are found
      break;
    }

    console.log(`Processing ${toilets.length} toilets in this batch...`);

    for (const toilet of toilets) {
      totalProcessed++;
      if (!toilet.lat || !toilet.lng) {
        console.log(`Skipping toilet ID ${toilet.id} - missing coordinates.`);
        continue;
      }

      // Call the reverse geocoding function
      const geocodeResult = await reverseGeocode(toilet.lat, toilet.lng);

      // If successful, update the database record
      if (geocodeResult && (geocodeResult.address || geocodeResult.city)) {
        const updateData = {};
        if (geocodeResult.address) updateData.address = geocodeResult.address;
        if (geocodeResult.city) updateData.city = geocodeResult.city;
        
        // Check if there's anything to update
        if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
              .from('toilet_location')
              .update(updateData)
              .eq('id', toilet.id);

            if (updateError) {
              console.error(`Failed to update toilet ID ${toilet.id}:`, updateError.message);
            } else {
              totalUpdated++;
            }
        } else {
             console.log(`Skipping update for toilet ID ${toilet.id} - no valid address/city returned.`);
        }
      } else {
         console.log(`Skipping update for toilet ID ${toilet.id} - geocoding failed or no address found.`);
      }

      // Wait before the next API call to respect rate limits
      await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY_MS)); 
    }

    // Prepare for the next database query batch
    dbQueryOffset += toilets.length; // Advance offset by the number actually processed
    
    // Safety break if we fetched less than the batch size (likely the end)
    if (toilets.length < DB_QUERY_BATCH_SIZE) {
        keepFetching = false;
    }
  }

  console.log(`Finished enrichment. Processed: ${totalProcessed}, Updated: ${totalUpdated}.`);
}

// --- Run ---
enrichAddresses(); 