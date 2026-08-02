// Geocoding Service for location search (Nominatim).
// Nominatim's usage policy asks browser callers to identify themselves;
// the email parameter serves that purpose since User-Agent cannot be set
// from fetch. Keep request volume low (the search control debounces at
// 500ms with a 3-character minimum).
export interface GeocodingResult {
  lat: number;
  lng: number;
  display_name: string;
  type?: string;
}

const BASE_URL = 'https://nominatim.openstreetmap.org/search';
const CONTACT_EMAIL = 'maxime.bonn@gmail.com';

export class GeocodingService {
  static async searchLocation(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) {
      return [];
    }

    const params = new URLSearchParams({
      format: 'json',
      limit: '5',
      q: query.trim(),
      email: CONTACT_EMAIL,
    });

    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Geocoding failed: HTTP ${response.status}`);
    }

    const results = await response.json();
    return results.map((result: any) => ({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
      type: result.type,
    }));
  }
}
