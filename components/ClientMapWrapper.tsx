'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
// No longer need calculateDistance here
// import { calculateDistance } from '@/lib/utils' 
import { Button } from "@/components/ui/button"; // Assuming you use shadcn/ui Button

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
type NearestToiletResult = {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  address: string | null;
  distance: number; // Distance is now in meters from the function
}

// This component renders the map AND the "Save Me" feature
export default function ClientMapWrapper() {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [multiStopUrl, setMultiStopUrl] = useState<string | null>(null);
  const [nearestToilets, setNearestToilets] = useState<NearestToiletResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = createClient();

  const findNearestToiletsRoute = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setMultiStopUrl(null);
    setNearestToilets([]);
    setUserLocation(null);

    if (!navigator.geolocation) {
      setErrorMsg("Geolocation is not supported by your browser.");
      setIsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ latitude, longitude });

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
          console.error("Error calling RPC function:", rpcError);
          setErrorMsg("Could not find nearby toilets. Please try again.");
          setIsLoading(false);
          return;
        }

        if (!fetchedToilets || fetchedToilets.length === 0) {
          setErrorMsg("No toilets found within 20km.");
          setIsLoading(false);
          return;
        }

        // The data is already filtered and sorted by the database!
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

        setMultiStopUrl(finalUrl);
        setIsLoading(false);
      },
      (error) => {
        console.error("Geolocation error:", error);
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
      {/* Map takes up most space */}
      <div className="flex-grow">
        <ToiletMap />
      </div>

      {/* Button and Results Area - positioned over the map or below */}
      <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 z-[1000] flex flex-col items-center gap-2 p-4 bg-background/80 backdrop-blur-sm rounded-lg shadow-lg max-w-md w-11/12"> 
        <Button 
          onClick={findNearestToiletsRoute}
          disabled={isLoading}
          variant="destructive" // Make it red
          size="lg"
          className="font-bold text-lg"
        >
          {isLoading ? "Calculating Route..." : "🆘 Save Me Daddy"}
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