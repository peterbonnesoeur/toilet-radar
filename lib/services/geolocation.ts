// Geolocation Service
export type UserLocation = {
  latitude: number;
  longitude: number;
};

export type LocationSource = 'gps' | 'ip' | 'default';

export interface GeolocationResult {
  location: UserLocation | null;
  source: LocationSource;
  error?: string;
}

// IP-based geolocation service
export class IPGeolocationService {
  private static async fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  static async getLocationFromIP(): Promise<UserLocation | null> {
    console.log('[IPGeolocationService] Attempting to get location from IP...');
    
    // Service 1: ipapi.co
    try {
      const response = await this.fetchWithTimeout('https://ipapi.co/json/');
      if (response.ok) {
        const data = await response.json();
        if (data.latitude && data.longitude && !data.error) {
          console.log(`[IPGeolocationService] Success via ipapi.co: ${data.city}, ${data.country}`);
          return {
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude)
          };
        }
      }
    } catch (error) {
      console.log('[IPGeolocationService] ipapi.co failed:', error);
    }
    
    // Service 2: ipgeolocation.io
    try {
      const response = await this.fetchWithTimeout('https://api.ipgeolocation.io/ipgeo?apiKey=');
      if (response.ok) {
        const data = await response.json();
        if (data.latitude && data.longitude) {
          console.log(`[IPGeolocationService] Success via ipgeolocation.io: ${data.city}, ${data.country_name}`);
          return {
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude)
          };
        }
      }
    } catch (error) {
      console.log('[IPGeolocationService] ipgeolocation.io failed:', error);
    }
    
    // Service 3: ipinfo.io
    try {
      const response = await this.fetchWithTimeout('https://ipinfo.io/json');
      if (response.ok) {
        const data = await response.json();
        if (data.loc) {
          const [lat, lng] = data.loc.split(',');
          console.log(`[IPGeolocationService] Success via ipinfo.io: ${data.city}, ${data.country}`);
          return {
            latitude: parseFloat(lat),
            longitude: parseFloat(lng)
          };
        }
      }
    } catch (error) {
      console.log('[IPGeolocationService] ipinfo.io failed:', error);
    }
    
    console.log('[IPGeolocationService] All services failed');
    return null;
  }
}

// GPS geolocation service
export class GPSGeolocationService {
  private static watchId: number | null = null;
  private static retryInterval: NodeJS.Timeout | null = null;

  static async getCurrentPosition(): Promise<UserLocation | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          console.log(`[GPSGeolocationService] Success: lat=${latitude}, lng=${longitude}`);
          resolve({ latitude, longitude });
        },
        (error) => {
          console.log(`[GPSGeolocationService] Failed: ${error.code} - ${error.message}`);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0
        }
      );
    });
  }

  static watchPosition(
    onSuccess: (location: UserLocation) => void,
    onError: (error: GeolocationPositionError) => void
  ): void {
    if (!navigator.geolocation) {
      onError(new Error('Geolocation not supported') as any);
      return;
    }

    console.log('[GPSGeolocationService] Starting watchPosition...');
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log(`[GPSGeolocationService] Watch success: lat=${latitude}, lng=${longitude}`);
        onSuccess({ latitude, longitude });
      },
      (error) => {
        console.log(`[GPSGeolocationService] Watch error: ${error.code} - ${error.message}`);
        onError(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  static clearWatch(): void {
    if (this.watchId !== null) {
      console.log('[GPSGeolocationService] Clearing watchPosition...');
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  static startPeriodicRetry(
    onUpgrade: (location: UserLocation) => void,
    checkInterval: number = 30000
  ): void {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
    }

    console.log('[GPSGeolocationService] Starting periodic GPS checks...');
    this.retryInterval = setInterval(async () => {
      const location = await this.getCurrentPosition();
      if (location) {
        console.log('[GPSGeolocationService] GPS upgrade successful!');
        onUpgrade(location);
        this.stopPeriodicRetry();
      }
    }, checkInterval);
  }

  static stopPeriodicRetry(): void {
    if (this.retryInterval) {
      console.log('[GPSGeolocationService] Stopping periodic GPS checks...');
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
  }

  static cleanup(): void {
    this.clearWatch();
    this.stopPeriodicRetry();
  }
}

// Main geolocation manager
export class GeolocationManager {
  private static async tryGPSFirst(): Promise<GeolocationResult> {
    const location = await GPSGeolocationService.getCurrentPosition();
    if (location) {
      return { location, source: 'gps' };
    }
    return { location: null, source: 'gps', error: 'GPS unavailable' };
  }

  private static async tryIPFallback(): Promise<GeolocationResult> {
    const location = await IPGeolocationService.getLocationFromIP();
    if (location) {
      return { location, source: 'ip' };
    }
    return { location: null, source: 'ip', error: 'IP geolocation failed' };
  }

  static async getLocation(): Promise<GeolocationResult> {
    console.log('[GeolocationManager] Attempting to get user location...');
    
    // Try GPS first
    const gpsResult = await this.tryGPSFirst();
    if (gpsResult.location) {
      return gpsResult;
    }

    // Fallback to IP geolocation
    console.log('[GeolocationManager] GPS failed, trying IP geolocation...');
    const ipResult = await this.tryIPFallback();
    if (ipResult.location) {
      return ipResult;
    }

    // Return default
    console.log('[GeolocationManager] All location methods failed, using default');
    return {
      location: null,
      source: 'default',
      error: 'All geolocation methods failed'
    };
  }

  static startLocationWatching(
    onLocationUpdate: (location: UserLocation, source: LocationSource) => void,
    onError: (error: string) => void
  ): () => void {
    let currentSource: LocationSource = 'default';

    // Start GPS watching
    GPSGeolocationService.watchPosition(
      (location) => {
        currentSource = 'gps';
        onLocationUpdate(location, 'gps');
      },
      (error) => {
        console.log('[GeolocationManager] GPS watch failed, trying IP fallback...');
        
        // Try IP geolocation as fallback
        IPGeolocationService.getLocationFromIP().then((ipLocation) => {
          if (ipLocation) {
            currentSource = 'ip';
            onLocationUpdate(ipLocation, 'ip');
            
            // Start periodic GPS retry
            GPSGeolocationService.startPeriodicRetry((gpsLocation) => {
              currentSource = 'gps';
              onLocationUpdate(gpsLocation, 'gps');
            });
          } else {
            currentSource = 'default';
            onError('All geolocation methods failed');
          }
        });
      }
    );

    // Return cleanup function
    return () => {
      GPSGeolocationService.cleanup();
    };
  }
} 