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

// This component renders the map AND the "Save Me" feature
export default function ClientMapWrapper() {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [multiStopUrl, setMultiStopUrl] = useState<string | null>(null);
  const [nearestToilets, setNearestToilets] = useState<NearestToiletResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false); // State to track client-side mount
  const watchIdRef = useRef<number | null>(null); // <-- Ref to store watchId

  useEffect(() => {
    setIsClient(true);
    let isMounted = true; // Flag to prevent state updates on unmounted component

    // Start watching location if geolocation is available
    if (navigator.geolocation) {
      console.log('[Geolocation] Starting watchPosition...');
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (isMounted) {
            const { latitude, longitude } = position.coords;
            console.log(`[Geolocation Watch] Success: lat=${latitude}, lng=${longitude}`);
            setUserLocation({ latitude, longitude });
             setErrorMsg(null); // Clear previous errors on success
          }
        },
        (error) => {
          if (isMounted) {
             console.error("[Geolocation Watch] Error:", error);
             let msg = "Could not get real-time location.";
             if (error.code === error.PERMISSION_DENIED) {
               msg = "Please allow location access for live updates.";
               // Stop watching if permission is denied permanently
               if (watchIdRef.current !== null) {
                 navigator.geolocation.clearWatch(watchIdRef.current);
                 watchIdRef.current = null;
               }
             } else if (error.code === error.POSITION_UNAVAILABLE) {
               msg = "Location information is temporarily unavailable.";
             } else if (error.code === error.TIMEOUT) {
               msg = "Getting location timed out.";
             }
             setErrorMsg(msg);
             setUserLocation(null); // Clear location on error
           }
        },
        { // Options for watchPosition
          enableHighAccuracy: true,
          timeout: 10000, // Max time to wait for an update
          maximumAge: 0 // Don't use cached position
        }
      );
    } else {
       console.error('[Geolocation] Not supported.');
       setErrorMsg("Geolocation is not supported by your browser.");
    }

    // Cleanup function: clear watch on unmount
    return () => {
      isMounted = false;
      if (watchIdRef.current !== null) {
        console.log('[Geolocation] Clearing watchPosition...');
        navigator.geolocation.clearWatch(watchIdRef.current);
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
      console.error("[findNearestToiletsRoute] RPC Error:", rpcError);
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
       {/* Logo Overlay - Positioned top-right */}
       <Image
         src="/logo.png"
         alt="Toilet Radar Logo"
         width={190} // Adjust size as needed
         height={190}
         className="absolute top-4 right-4 z-[1000] hidden opacity-80"
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