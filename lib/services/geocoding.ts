// Geocoding Service for location search
export interface GeocodingResult {
  lat: number;
  lng: number;
  display_name: string;
  type?: string;
  address?: {
    city?: string;
    country?: string;
    state?: string;
  };
}

export class GeocodingService {
  private static readonly BASE_URL = 'https://nominatim.openstreetmap.org/search';
  private static readonly DEFAULT_PARAMS = {
    format: 'json',
    addressdetails: '1',
    limit: '5'
  };

  static async searchLocation(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) {
      return [];
    }

    try {
      console.log('[GeocodingService] Searching for:', query);
      
      const params = new URLSearchParams({
        ...this.DEFAULT_PARAMS,
        q: query.trim()
      });

      const response = await fetch(`${this.BASE_URL}?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const results = await response.json();
      
      const formattedResults: GeocodingResult[] = results.map((result: any) => ({
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        display_name: result.display_name,
        type: result.type,
        address: {
          city: result.address?.city || result.address?.town || result.address?.village,
          country: result.address?.country,
          state: result.address?.state
        }
      }));

      console.log(`[GeocodingService] Found ${formattedResults.length} results`);
      return formattedResults;
      
    } catch (error) {
      console.error('[GeocodingService] Search failed:', error);
      return [];
    }
  }

  static async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
    try {
      console.log(`[GeocodingService] Reverse geocoding: ${lat}, ${lng}`);
      
      const params = new URLSearchParams({
        format: 'json',
        lat: lat.toString(),
        lon: lng.toString(),
        addressdetails: '1'
      });

      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        console.log('[GeocodingService] Reverse geocoding failed:', result.error);
        return null;
      }

      const formattedResult: GeocodingResult = {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        display_name: result.display_name,
        type: result.type,
        address: {
          city: result.address?.city || result.address?.town || result.address?.village,
          country: result.address?.country,
          state: result.address?.state
        }
      };

      console.log('[GeocodingService] Reverse geocoding successful');
      return formattedResult;
      
    } catch (error) {
      console.error('[GeocodingService] Reverse geocoding failed:', error);
      return null;
    }
  }
} 