'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
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

  // Set isClient to true only after component mounts
  useEffect(() => {
    setIsClient(true);
  }, []);

  const supabase = createClient();

  const findNearestToiletsRoute = async () => {
    console.log('[findNearestToiletsRoute] Starting...'); // Log start
    setIsLoading(true);
    setErrorMsg(null);
    setMultiStopUrl(null);
    setNearestToilets([]);
    setUserLocation(null);

    if (!navigator.geolocation) {
      console.error('[findNearestToiletsRoute] Geolocation not supported.');
      setErrorMsg("Geolocation is not supported by your browser.");
      setIsLoading(false);
      return;
    }
    
    console.log('[findNearestToiletsRoute] Requesting geolocation...');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        console.log(`[findNearestToiletsRoute] Geolocation success: lat=${latitude}, lng=${longitude}`);
        setUserLocation({ latitude, longitude });

        console.log('[findNearestToiletsRoute] Calling Supabase RPC find_nearest_toilets...');
        // Call the RPC function
        const { data: fetchedToilets, error: rpcError } = await supabase.rpc(
          'find_nearest_toilets',
          {
            user_lat: latitude,
            user_lng: longitude,
            radius_meters: 20000, // 20km radius
            result_limit: 3        // Limit to 3 results
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
      },
      (error) => {
        console.error("[findNearestToiletsRoute] Geolocation error:", error);
        let msg = "Could not get your location.";
        if (error.code === error.PERMISSION_DENIED) {
          msg = "Please allow location access to find nearby toilets.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          msg = "Location information is unavailable.";
        } else if (error.code === error.TIMEOUT) {
          msg = "Getting your location timed out.";
        }
        setErrorMsg(msg);
        setIsLoading(false);
      },
      { 
        enableHighAccuracy: true, // Request more accurate position
        timeout: 10000, // Set a timeout (10 seconds)
        maximumAge: 0 // Force a fresh location reading
      }
    );
  };

  return (
    <div className="w-full h-full flex flex-col relative"> {/* Ensure wrapper allows positioning */}
       {/* Logo Overlay - Positioned top-right */}
       <Image
         src="/logo.png"
         alt="Toilet Radar Logo"
         width={100} // Adjust size as needed
         height={100}
         className="absolute top-4 right-4 z-[1000] bg-background/50 backdrop-blur-sm p-1 rounded-md shadow-md hidden md:block"
       />
      
      {/* Map takes up most space - Added min-h */}
      <div className="flex-grow min-h-[400px]"> {/* Added min-h-[400px] as a fallback */}
        {/* Only render ToiletMap on the client-side after mount */} 
        {isClient ? (
          <ToiletMap userLocation={userLocation} />
        ) : (
          <p>Initializing map...</p> // Or keep the default loading indicator
        )}
      </div>

      {/* Button and Results Area */}
      <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 p-4 bg-background/80 backdrop-blur-sm rounded-lg shadow-lg max-w-md w-11/12"> 
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
      </div>
    </div>
  )
} 