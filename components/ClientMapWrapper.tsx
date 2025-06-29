'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
// No longer need calculateDistance here
// import { calculateDistance } from '@/lib/utils' 
import { Button } from "@/components/ui/button"; // Assuming you use shadcn/ui Button
import Image from "next/image"; // <-- Import Image

// Dynamically import the ToiletMap component with SSR disabled
const ToiletMap = dynamic(() => import('@/components/ToiletMap'), {
  ssr: false,
  loading: () => <p>Loading map...</p> 
})

// Define types for location and toilet data including distance
type UserLocation = {
  latitude: number;
  longitude: number;
}

// Type definition for the data returned by the RPC function
// This MUST match the Toilet type expected by ToiletMap
type NearestToiletResult = {
  id: string;
  name: string | null;
  lat: number; // Should be number after filtering in map
  lng: number; // Should be number after filtering in map
  address: string | null;
  accessible: boolean | null; 
  is_free: boolean | null;    
  type: string | null;        
  status: string | null;       
  notes: string | null;        
  city: string | null;         
  open_hours: string | null;   
  distance: number;          
  created_at: string;        
}

// Function to get location from IP address
const getLocationFromIP = async (): Promise<UserLocation | null> => {
  try {
    console.log('[IP Geolocation] Attempting to get location from IP...');
    
    // Service 1: ipapi.co (free, no API key required, 1000 requests/day)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://ipapi.co/json/', { 
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        if (data.latitude && data.longitude && !data.error) {
          console.log(`[IP Geolocation] Success via ipapi.co: ${data.city}, ${data.country} (${data.latitude}, ${data.longitude})`);
          return {
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude)
          };
        }
      }
    } catch (error) {
      console.log('[IP Geolocation] ipapi.co failed:', error);
    }
    
    // Service 2: ipgeolocation.io (free tier, no API key for basic use)
    try {
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 5000);
      
      const response2 = await fetch('https://api.ipgeolocation.io/ipgeo?apiKey=', { 
        signal: controller2.signal 
      });
      clearTimeout(timeoutId2);
      
      if (response2.ok) {
        const data2 = await response2.json();
        if (data2.latitude && data2.longitude) {
          console.log(`[IP Geolocation] Success via ipgeolocation.io: ${data2.city}, ${data2.country_name} (${data2.latitude}, ${data2.longitude})`);
          return {
            latitude: parseFloat(data2.latitude),
            longitude: parseFloat(data2.longitude)
          };
        }
      }
    } catch (error) {
      console.log('[IP Geolocation] ipgeolocation.io failed:', error);
    }
    
    // Service 3: ipinfo.io (free, 50k requests/month)
    try {
      const controller3 = new AbortController();
      const timeoutId3 = setTimeout(() => controller3.abort(), 5000);
      
      const response3 = await fetch('https://ipinfo.io/json', { 
        signal: controller3.signal 
      });
      clearTimeout(timeoutId3);
      
      if (response3.ok) {
        const data3 = await response3.json();
        if (data3.loc) {
          const [lat, lng] = data3.loc.split(',');
          console.log(`[IP Geolocation] Success via ipinfo.io: ${data3.city}, ${data3.country} (${lat}, ${lng})`);
          return {
            latitude: parseFloat(lat),
            longitude: parseFloat(lng)
          };
        }
      }
    } catch (error) {
      console.log('[IP Geolocation] ipinfo.io failed:', error);
    }
    
    console.log('[IP Geolocation] All services failed or returned invalid data');
    return null;
  } catch (error) {
    console.log('[IP Geolocation] General error:', error);
    return null;
  }
};

// This component renders the map AND the "Save Me" feature
export default function ClientMapWrapper() {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationSource, setLocationSource] = useState<'gps' | 'ip' | 'default'>('default'); // Track location source
  const [gpsUpgradeNotification, setGpsUpgradeNotification] = useState(false); // GPS upgrade notification
  const [multiStopUrl, setMultiStopUrl] = useState<string | null>(null);
  const [nearestToilets, setNearestToilets] = useState<NearestToiletResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false); // State to track client-side mount
  const watchIdRef = useRef<number | null>(null); // <-- Ref to store watchId
  const gpsRetryIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for GPS retry interval

  useEffect(() => {
    setIsClient(true);
    let isMounted = true; // Flag to prevent state updates on unmounted component

    // Function to try GPS once (for retry attempts)
    const tryGPSOnce = () => {
      return new Promise<UserLocation | null>((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            console.log(`[GPS Retry] Success: lat=${latitude}, lng=${longitude}`);
            resolve({ latitude, longitude });
          },
          (error) => {
            console.log(`[GPS Retry] Failed: ${error.code} - ${error.message}`);
            resolve(null);
          },
          {
            enableHighAccuracy: true,
            timeout: 8000, // Shorter timeout for retry attempts
            maximumAge: 0
          }
        );
      });
    };

    // Function to start periodic GPS retry when using IP location
    const startGPSRetry = () => {
      if (gpsRetryIntervalRef.current) {
        clearInterval(gpsRetryIntervalRef.current);
      }

      console.log('[GPS Retry] Starting periodic GPS checks every 30 seconds...');
      gpsRetryIntervalRef.current = setInterval(async () => {
        if (!isMounted || locationSource === 'gps') {
          // Stop retrying if component unmounted or GPS already active
          if (gpsRetryIntervalRef.current) {
            clearInterval(gpsRetryIntervalRef.current);
            gpsRetryIntervalRef.current = null;
          }
          return;
        }

        console.log('[GPS Retry] Attempting GPS upgrade...');
        const gpsLocation = await tryGPSOnce();
        
        if (gpsLocation && isMounted) {
          console.log('[GPS Retry] GPS upgrade successful! Switching from IP to GPS.');
          setUserLocation(gpsLocation);
          setLocationSource('gps');
          setErrorMsg(null);
          
          // Show upgrade notification
          setGpsUpgradeNotification(true);
          setTimeout(() => {
            setGpsUpgradeNotification(false);
          }, 3000);
          
          // Start continuous GPS watching now that permission is granted
          if (navigator.geolocation && !watchIdRef.current) {
            watchIdRef.current = navigator.geolocation.watchPosition(
              (position) => {
                if (isMounted) {
                  const { latitude, longitude } = position.coords;
                  console.log(`[Geolocation Watch] GPS Success: lat=${latitude}, lng=${longitude}`);
                  setUserLocation({ latitude, longitude });
                  setLocationSource('gps');
                  setErrorMsg(null);
                }
              },
              (error) => {
                console.log(`[Geolocation Watch] GPS Error: ${error.code} - ${error.message}`);
                // Don't fall back to IP here since we already have it
              },
              {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
              }
            );
          }
          
          // Stop the retry interval
          if (gpsRetryIntervalRef.current) {
            clearInterval(gpsRetryIntervalRef.current);
            gpsRetryIntervalRef.current = null;
          }
        }
      }, 30000); // Retry every 30 seconds
    };

    // Function to try IP geolocation as fallback
    const tryIPGeolocation = async () => {
      if (!isMounted) return;
      
      console.log('[Geolocation] Trying IP-based geolocation as fallback...');
      const ipLocation = await getLocationFromIP();
      
      if (isMounted && ipLocation) {
        console.log(`[Geolocation] IP-based location set: ${ipLocation.latitude}, ${ipLocation.longitude}`);
        setUserLocation(ipLocation);
        setLocationSource('ip');
        setErrorMsg(null);
        
        // Start periodic GPS retry since we're using IP location
        startGPSRetry();
      } else if (isMounted) {
        console.log('[Geolocation] IP-based geolocation also failed, using default location');
        setLocationSource('default');
        setErrorMsg("Using default location (Zurich). For better accuracy, please enable location access.");
        
        // Still try GPS retry even with default location
        startGPSRetry();
      }
    };

    // Start watching location if geolocation is available
    if (navigator.geolocation) {
      console.log('[Geolocation] Starting watchPosition...');
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (isMounted) {
            const { latitude, longitude } = position.coords;
            console.log(`[Geolocation Watch] GPS Success: lat=${latitude}, lng=${longitude}`);
            setUserLocation({ latitude, longitude });
            setLocationSource('gps');
            setErrorMsg(null); // Clear previous errors on success
          }
        },
        (error) => {
          if (isMounted) {
             console.log("[Geolocation Watch] GPS Error details:");
             console.log("- Code:", error.code);
             console.log("- Message:", error.message);
             console.log("- Error type:", error.code === 1 ? "PERMISSION_DENIED" : 
                                          error.code === 2 ? "POSITION_UNAVAILABLE" : 
                                          error.code === 3 ? "TIMEOUT" : "UNKNOWN");
             
             // Stop watching if permission is denied permanently
             if (error.code === error.PERMISSION_DENIED && watchIdRef.current !== null) {
               navigator.geolocation.clearWatch(watchIdRef.current);
               watchIdRef.current = null;
             }
             
             // Try IP geolocation as fallback
             tryIPGeolocation();
           }
        },
        { // Options for watchPosition
          enableHighAccuracy: true,
          timeout: 10000, // Max time to wait for an update
          maximumAge: 0 // Don't use cached position
        }
      );
    } else {
       console.log('[Geolocation] GPS not supported by this browser, trying IP geolocation...');
       tryIPGeolocation();
    }

    // Cleanup function: clear watch on unmount
    return () => {
      isMounted = false;
      if (watchIdRef.current !== null) {
        console.log('[Geolocation] Clearing watchPosition...');
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (gpsRetryIntervalRef.current !== null) {
        console.log('[GPS Retry] Clearing retry interval...');
        clearInterval(gpsRetryIntervalRef.current);
        gpsRetryIntervalRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  const supabase = createClient();

  const findNearestToiletsRoute = async () => {
    console.log('[findNearestToiletsRoute] Starting...'); 
    if (!userLocation) {
        setErrorMsg("Waiting for your location... Please ensure location access is enabled.");
        console.log('[findNearestToiletsRoute] Aborted: No user location available.');
        return;
    }
    
    setIsLoading(true);
    setErrorMsg(null);
    setMultiStopUrl(null);
    setNearestToilets([]);
    
    const { latitude, longitude } = userLocation;
    console.log(`[findNearestToiletsRoute] Using location: lat=${latitude}, lng=${longitude}`);

    console.log('[findNearestToiletsRoute] Calling Supabase RPC find_nearest_toilets...');
    const { data: fetchedToilets, error: rpcError } = await supabase.rpc(
      'find_nearest_toilets',
      {
        user_lat: latitude,
        user_lng: longitude,
        radius_meters: 20000, 
        result_limit: 3      
      }
    );

    if (rpcError) {
      console.log("[findNearestToiletsRoute] RPC Error:", rpcError);
      setErrorMsg("Could not find nearby toilets. Please try again.");
      setIsLoading(false);
      return;
    }

    if (!fetchedToilets || fetchedToilets.length === 0) {
      console.log('[findNearestToiletsRoute] RPC Success: No toilets found within 20km.');
      setErrorMsg("No toilets found within 20km.");
      setIsLoading(false);
      return;
    }
    
    console.log(`[findNearestToiletsRoute] RPC Success: Found ${fetchedToilets.length} toilets.`);
    setNearestToilets(fetchedToilets);

    // Construct the multi-stop Google Maps URL (using fetchedToilets)
    let finalUrl = `https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}`;
    const waypoints = fetchedToilets.slice(0, -1) 
                                 .map((t: NearestToiletResult) => `${t.lat},${t.lng}`)
                                 .join('|');
    const destination = fetchedToilets[fetchedToilets.length - 1]; 
    
    finalUrl += `&destination=${destination.lat},${destination.lng}`;
    if (waypoints) {
      finalUrl += `&waypoints=${waypoints}`;
    }
    finalUrl += `&travelmode=walking`;
    
    console.log('[findNearestToiletsRoute] Multi-stop URL created:', finalUrl);
    setMultiStopUrl(finalUrl);
    setIsLoading(false);
    console.log('[findNearestToiletsRoute] Finished successfully.');
  };

  return (
    <div className="w-full h-full flex flex-col relative"> {/* Ensure wrapper allows positioning */}
       {/* Logo Overlay - Positioned top-left to avoid search control */}
       <Image
         src="/logo.png"
         alt="Toilet Radar Logo"
         width={190} // Adjust size as needed
         height={190}
         className="absolute top-4 left-4 z-[10] hidden md:block opacity-80"
       />
      
       {/* Map takes up most space - Ensure it's below the navbar/dropdown */}
      <div className="relative z-0 flex-grow min-h-[400px]"> {/* Added relative z-0 */}
        {/* Only render ToiletMap on the client-side after mount */} 
        {isClient ? (
          <ToiletMap userLocation={userLocation} />
        ) : (
          <p>Initializing map...</p> // Or keep the default loading indicator
        )}
      </div>

      {/* Button and Results Area - Position changes based on screen size */}
      <div className="absolute top-20 left-1/2 transform -translate-x-1/2 md:top-auto md:bottom-5 z-[1000] flex flex-col items-center gap-2 p-3 bg-background/80 backdrop-blur-sm rounded-lg shadow-lg"> {/* Default: top-20; md and up: bottom-5 */}
        
        {/* GPS Upgrade Notification */}
        {gpsUpgradeNotification && (
          <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded mb-2 flex items-center gap-1">
            <span>✅</span>
            <span>Upgraded to GPS location!</span>
          </div>
        )}
        
        {/* Location Source Indicator */}
        {userLocation && (
          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            {locationSource === 'gps' && (
              <>
                <span className="text-green-600">📍</span>
                <span>GPS Location</span>
              </>
            )}
            {locationSource === 'ip' && (
              <>
                <span className="text-blue-600">🌐</span>
                <span>Approximate Location (IP-based)</span>
                <span className="text-xs text-gray-500 ml-1">• Checking for GPS...</span>
              </>
            )}
          </div>
        )}
        
        {locationSource === 'default' && (
          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
            <span className="text-yellow-600">🏔️</span>
            <span>Default Location • Checking for GPS...</span>
          </div>
        )}
        
        <Button 
          onClick={findNearestToiletsRoute}
          disabled={isLoading}
          variant="destructive" // Make it red
          size="lg"
          className="font-bold text-lg"
        >
          {isLoading ? "Calculating Route..." : "🆘 Save Meeee"}
        </Button>

        {errorMsg && <p className="text-red-500 text-sm mt-2">{errorMsg}</p>}

        {/* Display the single multi-stop link */}
        {multiStopUrl && nearestToilets.length > 0 && (
          <div className="mt-2 w-full text-center">
             <a 
               href={multiStopUrl}
               target="_blank"
               rel="noopener noreferrer"
               className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
             >
               Open Route to Nearest {nearestToilets.length || ''} Toilet(s)
             </a>
             <h3 className="font-semibold mt-2 mb-1 text-center text-xs">Route includes:</h3>
             <ul className="space-y-1 text-xs">
               {nearestToilets.map((toilet, index) => (
                 <li key={toilet.id} className="p-1 border-b last:border-b-0">
                     {index + 1}. {toilet.name || 'Unnamed Toilet'} ({(toilet.distance / 1000).toFixed(2)} km)
                 </li>
               ))}
             </ul>
           </div>
        )}

        {/* Buy Me A Coffee Link - Shows after loading is finished */}
        {!isLoading && (multiStopUrl || errorMsg) && (
          <div className="mt-3 pt-2 border-t border-border/50 w-full text-center">
             <a 
               href="https://buymeacoffee.com/maximebonnesoeur" 
               target="_blank" 
               rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-yellow-400 text-yellow-900 rounded-md hover:bg-yellow-500 transition-colors"
             >
               <span>☕</span> Buy me a coffee?
             </a>
           </div>
        )}
      </div>
    </div>
  )
} 