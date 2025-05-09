'use client' // Add this directive for client-side hooks

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { useEffect, useState, useCallback, useRef } from 'react' // Import useCallback and useRef
import { createClient } from '@/utils/supabase/client' // Adjusted import path
import L from 'leaflet'; // Import Leaflet library for custom icons if needed
import { useTheme } from 'next-themes'; // Import useTheme
import 'leaflet-defaulticon-compatibility'; // <-- Add this line here
import { Button } from '@/components/ui/button'; // Import Button
import { Crosshair } from 'lucide-react'; // Import icon
import debounce from 'lodash.debounce'; // Re-add debounce

// Define the Toilet type based on your Supabase table
type Toilet = {
  id: string
  name: string | null // Allow null based on schema
  lat: number | null
  lng: number | null
  accessible: boolean | null
  open_hours: string | null
  address: string | null // <-- Add address field to the type
  created_at: string
}

// Define UserLocation type
type UserLocation = {
  latitude: number;
  longitude: number;
} | null;

// Define props interface including userLocation
interface ToiletMapProps {
  userLocation: UserLocation;
}

// Component to update map view when center or zoom changes
const ChangeView = ({ center, zoom }: { center: L.LatLngExpression, zoom: number }) => {
  const map = useMap();
  useEffect(() => {
    // This only runs once on mount
    map.setView(center, zoom); 
  }, [map]);
  return null;
};

// Define the custom toilet icon
const toiletIcon = L.icon({
    iconUrl: "/toilet.png", // Path to your custom icon in the public folder
    // iconRetinaUrl: "/toilet-icon-2x.png", // Optional: Add if you have a retina version
    iconSize: [32, 32],    // Adjust size as needed [width, height]
    iconAnchor: [16, 32],   // Point of the icon which will correspond to marker's location [width/2, height]
    popupAnchor: [0, -32],  // Point from which the popup should open relative to the iconAnchor [offsetX, offsetY]
    className: 'map-pin'    // Add class name
    // shadowUrl: "/marker-shadow.png", // Optional: Add shadow if desired
    // shadowSize: [41, 41],
    // shadowAnchor: [12, 41]
});

// Define a larger version of the toilet icon for the selected state
const selectedToiletIcon = L.icon({
    iconUrl: "/premium_toilet.png",
    iconSize: [48, 48], // Larger size
    iconAnchor: [24, 48], // Adjusted anchor
    popupAnchor: [0, -48], // Adjusted popup anchor
    className: 'map-pin selected-pin' // Add class names (add specific selected class if needed)
    // Include shadow properties if you used them in the original icon
});

// Define a custom icon for the user
const userIcon = new L.Icon({
    iconUrl: '/user.png', // Use path from /public
    iconSize: [40, 40],
    iconAnchor: [12, 31],
    popupAnchor: [1, -34],
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    shadowSize: [31, 31],
    className: 'map-pin user-pin' // Add class names
});

const defaultCenter: L.LatLngExpression = [47.3769, 8.5417]; // Default to Zurich center
const defaultZoom = 13;

// Component to handle map click events for deselecting markers
function MapClickHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({
    click: () => {
      onMapClick();
    },
  });
  return null;
}

// --- Re-introduce MapEvents Component ---
function MapEvents({ onMapViewChange }: { onMapViewChange: (map: L.Map) => void }) {
  const map = useMapEvents({
    moveend: () => {
        onMapViewChange(map);
    },
    zoomend: () => {
        onMapViewChange(map);
    },
    // Fetch on initial load as well
    load: () => {
        onMapViewChange(map);
    }
  });
  return null;
}
// --- End MapEvents Component ---

// --- RecenterControl Component ---
function RecenterControl({ userLocation }: { userLocation: UserLocation }) {
  const map = useMap();
  console.log('[RecenterControl] Rendering. userLocation:', userLocation); // Log location on render

  const recenterMap = () => {
    console.log('[RecenterControl] recenterMap called. userLocation:', userLocation); // Log on click
    if (userLocation) {
      console.log(`[RecenterControl] Setting view to: [${userLocation.latitude}, ${userLocation.longitude}]`); // Log before setView
      map.setView([userLocation.latitude, userLocation.longitude], 15); // Recenter to user location with zoom 15
    }
  };

  if (!userLocation) {
    console.log('[RecenterControl] Not rendering button because userLocation is null.'); // Log if not rendering
    return null;
  }

  return (
    // Position bottom-right, offset slightly
     <div className="leaflet-bottom leaflet-right" style={{ zIndex: 1000 }}> 
       <div className="leaflet-control leaflet-bar" style={{ marginBottom: '22px' }}> {/* Offset from bottom */}
          <Button
            variant="outline"
            size="icon"
            className="w-8 h-8 bg-background hover:bg-muted"
            onClick={recenterMap}
            title="Recenter map on your location"
          >
            <Crosshair className="w-4 h-4" />
          </Button>
        </div>
      </div>
  );
}
// --- End RecenterControl Component ---

// Update component to accept userLocation prop
export default function ToiletMap({ userLocation }: ToiletMapProps) {
  const [toilets, setToilets] = useState<Toilet[]>([])
  const [selectedToiletId, setSelectedToiletId] = useState<string | null>(null); // State for selected toilet
  const [isLoading, setIsLoading] = useState(true); // Add loading state, initially true
  const supabase = createClient() // Initialize Supabase client
  const { theme } = useTheme(); // Get the current theme
  // Ref to store the AbortController for the current fetch operation
  const currentFetchControllerRef = useRef<AbortController | null>(null);

  // Define the zoom threshold
  const ZOOM_THRESHOLD = 12; // Adjust as needed

  // --- V3 Fetch Function (Deterministic Sampling) --- 
  const fetchToiletsV3 = useCallback(async (map: L.Map | null, signal: AbortSignal) => {
    if (!map) return; // Don't fetch if map isn't ready

    const currentZoom = map.getZoom();
    const isZoomedIn = currentZoom >= ZOOM_THRESHOLD;
    const center = map.getCenter(); // Get map center
    
    console.log(`[ToiletMap V3] Fetching. Zoom: ${currentZoom}, Zoomed In: ${isZoomedIn}, Center: ${center.lat},${center.lng}, User:`, userLocation);

    if (signal.aborted) {
        console.log('[ToiletMap V3] Fetch aborted before RPC call.');
        return; 
    }

    const params = {
      p_center_lat: center.lat, // Pass map center lat
      p_center_lng: center.lng, // Pass map center lng
      p_user_lat: userLocation?.latitude ?? null,
      p_user_lng: userLocation?.longitude ?? null,
      p_is_zoomed_in: isZoomedIn,
      result_limit: 1000 
    };

    console.log('[ToiletMap V3] Calling get_toilets_deterministic_v3 with params:', JSON.stringify(params));

    try {
      // Call the new V3 function
      const { data, error: rpcError } = await supabase.rpc(
          'get_toilets_deterministic_v3', 
          params
      );

      if (signal.aborted) {
        console.log('[ToiletMap V3] Fetch aborted after RPC call returned.');
        return; 
      }
      if (!signal.aborted) {
           setIsLoading(false);
      }

      if (rpcError) {
           console.error('[ToiletMap V3] Error fetching toilets:', rpcError);
      } else if (data) {
        console.log(`[ToiletMap V3] Received ${data.length} toilets.`);
        setToilets(data);
      }
    } catch (error: any) {
        if (error.name !== 'AbortError') { 
            setIsLoading(false); 
            console.error('[ToiletMap V3] Unexpected error during fetch:', error);
        } else {
             console.log('[ToiletMap V3] Fetch aborted via catch.');
        }
    }
  }, [supabase, userLocation]); 

  // Debounced fetch, handling AbortController - uses V3 fetch now
  const debouncedFetchToilets = useCallback(
    debounce((map: L.Map | null) => {
      if (!map) return;
      if (currentFetchControllerRef.current) {
        currentFetchControllerRef.current.abort();
        console.log('[ToiletMap V3] Aborting previous fetch...');
      }
      const controller = new AbortController();
      currentFetchControllerRef.current = controller;
      setIsLoading(true); 
      fetchToiletsV3(map, controller.signal); // Call V3 fetch
    }, 500), 
    [fetchToiletsV3] // Dependency is now fetchToiletsV3
  );

  // Determine map center and zoom based on user location prop
  const mapCenter: L.LatLngExpression = userLocation
    ? [userLocation.latitude, userLocation.longitude]
    : defaultCenter;
  const mapZoom = userLocation ? 15 : defaultZoom;

  // Define tile layer URLs and attributions
  const lightTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const lightAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  const darkTileUrl = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  const darkAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  // Select tile layer based on theme
  const tileUrl = theme === 'dark' ? darkTileUrl : lightTileUrl;
  const attribution = theme === 'dark' ? darkAttribution : lightAttribution;

  // Force re-render of TileLayer when theme changes by using a key
  const tileLayerKey = theme; 

  return (
    <MapContainer 
        center={mapCenter} 
        zoom={mapZoom} 
        style={{ height: '85vh', width: '100%' }} 
        whenReady={() => { // Correct prop name: whenReady
            // The map instance is available via useMap() hook within children,
            // or we can set it via a ref if preferred. Let's use a ref for simplicity here.
            // Need to define mapRef: const mapRef = useRef<L.Map | null>(null);
            // And assign it: ref={mapRef}
            // Then call handleMapCreated(mapRef.current) if mapRef.current exists.
            // However, a simpler approach is to leverage the fact that MapEvents runs on 'load'.
            // Let's remove whenReady and handleMapCreated, and rely on MapEvents 'load' trigger.
        }}
    >
       {/* Add MapEvents to trigger fetch on move/zoom/load */}
       {/* MapEvents needs the map instance, which it gets via useMapEvents hook internally */} 
       <MapEvents onMapViewChange={(map) => debouncedFetchToilets(map)} />
      <ChangeView center={mapCenter} zoom={mapZoom} />
      <MapClickHandler onMapClick={() => setSelectedToiletId(null)} />
      <RecenterControl userLocation={userLocation} /> {/* Add Recenter button */}
      <TileLayer
        key={tileLayerKey} 
        attribution={attribution} 
        url={tileUrl}             
      />
      {userLocation && (
        <Marker
          position={[userLocation.latitude, userLocation.longitude]}
          icon={userIcon}
        >
          <Popup>Your current location</Popup>
        </Marker>
      )}
      {toilets.map(toilet => {
        // Construct Google Maps link for Address Search
        const googleMapsAddressLink = toilet.address 
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toilet.address)}` 
            : null;
            
        // Construct Google Maps link for Lat/Lng Coordinates
        const googleMapsCoordsLink = `https://www.google.com/maps?q=${toilet.lat},${toilet.lng}`;

        return toilet.lat && toilet.lng && (
          <Marker 
            key={toilet.id} 
            position={[toilet.lat, toilet.lng]} 
            icon={selectedToiletId === toilet.id ? selectedToiletIcon : toiletIcon} // Conditional icon
            eventHandlers={{ // Add click handler
              click: () => {
                setSelectedToiletId(toilet.id);
              },
            }}
          >
             <Popup>
               <div className="text-sm font-sans max-w-xs"> 
                 <h3 className="font-bold text-base mb-1">{toilet.name || 'Public Toilet'}</h3>
                 
                 {/* Address Link (if address exists) */}
                 {toilet.address && googleMapsAddressLink && (
                     <a 
                       href={googleMapsAddressLink} 
                       target="_blank" 
                       rel="noopener noreferrer"
                       title="Search Address on Google Maps"
                       className="text-xs text-blue-600 hover:underline block mb-1 break-words"
                     >
                       {toilet.address}
                     </a>
                 )}
                 
                 {/* Coordinates Link */} 
                 <a 
                   href={googleMapsCoordsLink} 
                   target="_blank" 
                   rel="noopener noreferrer"
                   title="View exact coordinates on Google Maps"
                   className="text-xs text-blue-600 hover:underline block mb-1"
                 >
                   View Coordinates ({toilet.lat.toFixed(5)}, {toilet.lng.toFixed(5)})
                 </a>
                 
                 {/* ... (rest of the info: city, type, status, etc.) ... */}
                 {toilet.address && 
                   <p className="text-xs text-gray-600"><span className="font-semibold">Address:</span> {toilet.address}</p>}
                 {toilet.accessible === null 
                   ? <p className="text-xs text-gray-600"><span className="font-semibold">Accessibility:</span> Unknown</p>
                   : toilet.accessible 
                     ? <p className="text-xs text-gray-600"><span className="font-semibold">Accessibility:</span> ♿ Accessible</p>
                     : <p className="text-xs text-gray-600"><span className="font-semibold">Accessibility:</span> 🚫 Not Accessible</p>}
                 {toilet.open_hours && 
                   <p className="text-xs text-gray-600"><span className="font-semibold">Hours:</span> {toilet.open_hours}</p>}
               </div>
             </Popup>
           </Marker>
        )
       }
      )}
    </MapContainer>
  )
} 