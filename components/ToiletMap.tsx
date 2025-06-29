'use client' // Add this directive for client-side hooks

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { useEffect, useState, useCallback, useRef } from 'react' // Import useCallback and useRef
import { createClient } from '@/utils/supabase/client' // Adjusted import path
import L from 'leaflet'; // Import Leaflet library for custom icons if needed
import { useTheme } from 'next-themes'; // Import useTheme
import 'leaflet-defaulticon-compatibility'; // <-- Add this line here
import { Button } from '@/components/ui/button'; // Import Button
import { Crosshair, Search, MapPin } from 'lucide-react'; // Import icons
import { Input } from '@/components/ui/input'; // Import Input for search
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

// --- Manual Recenter Control Component ---
function RecenterControl({ userLocation }: { userLocation: UserLocation }) {
  const map = useMap();

  const recenterMap = () => {
    console.log('[RecenterControl] Manual recenter requested. userLocation:', userLocation);
    if (userLocation && map && map.getContainer && map.getContainer()) {
      try {
        console.log(`[RecenterControl] Setting view to: [${userLocation.latitude}, ${userLocation.longitude}]`);
        map.setView([userLocation.latitude, userLocation.longitude], 15); // Recenter to user location with zoom 15
      } catch (error) {
        console.log('[RecenterControl] Error setting view:', error);
      }
    }
  };

  if (!userLocation) {
    return null; // Don't show button if no location
  }

  return (
    <div className="leaflet-bottom leaflet-right" style={{ zIndex: 1000 }}> 
      <div className="leaflet-control leaflet-bar" style={{ marginBottom: '22px' }}>
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
// --- End Recenter Control Component ---

// --- Location Search Component ---
function LocationSearch() {
  const map = useMap();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // Track if search bar is expanded

  // Geocoding function using free Nominatim service (OpenStreetMap)
  const searchLocation = async (query: string) => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
      );
      
      if (response.ok) {
        const results = await response.json();
        setSearchResults(results);
        setShowResults(true);
        console.log('[LocationSearch] Found', results.length, 'results for:', query);
      }
    } catch (error) {
      console.log('[LocationSearch] Error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Debounced search to avoid too many requests
  const debouncedSearch = useCallback(
    debounce((query: string) => {
      searchLocation(query);
    }, 500),
    []
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    
    if (value.length > 2) {
      debouncedSearch(value);
    } else {
      setShowResults(false);
      setSearchResults([]);
    }
  };

  const selectLocation = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    
    console.log(`[LocationSearch] Centering map on: ${result.display_name} (${lat}, ${lng})`);
    
    if (map && map.getContainer && map.getContainer()) {
      try {
        map.setView([lat, lng], 14); // Center with good zoom level
      } catch (error) {
        console.log('[LocationSearch] Error setting view:', error);
      }
    }
    
    // Clear search but keep expanded state
    setSearchQuery('');
    setShowResults(false);
    setSearchResults([]);
  };

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
    if (!isExpanded) {
      // Clear search when collapsing
      setSearchQuery('');
      setShowResults(false);
      setSearchResults([]);
    }
  };

  return (
    <div className="leaflet-top leaflet-right" style={{ zIndex: 1000, marginTop: '10px', marginRight: '10px' }}>
      <div className="leaflet-control leaflet-bar bg-background rounded-md shadow-lg">
        <div className="relative">
          {/* Collapsed State - Just the Search Icon */}
          {!isExpanded && (
            <Button
              variant="ghost"
              size="icon"
              className="w-10 h-10 rounded-md"
              onClick={toggleExpanded}
              title="Search for a location"
            >
              <Search className="w-4 h-4" />
            </Button>
          )}
          
          {/* Expanded State - Full Search Bar */}
          {isExpanded && (
            <div className="flex items-center gap-1 p-1">
              <div className="relative flex-1 min-w-[200px] sm:min-w-[280px]">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search location..."
                    value={searchQuery}
                    onChange={handleInputChange}
                    className="pl-8 pr-4 text-sm h-8"
                    disabled={isSearching}
                    autoFocus
                  />
                </div>
                
                {/* Search Results Dropdown */}
                {showResults && searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto z-20">
                    {searchResults.map((result, index) => (
                      <button
                        key={index}
                        onClick={() => selectLocation(result)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b last:border-b-0 flex items-start gap-2"
                      >
                        <MapPin className="w-3 h-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-xs sm:text-sm">{result.display_name}</div>
                          {result.type && (
                            <div className="text-xs text-muted-foreground capitalize">{result.type}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* No Results Message */}
                {showResults && searchResults.length === 0 && !isSearching && searchQuery.length > 2 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg p-3 z-20">
                    <div className="text-sm text-muted-foreground text-center">
                      No locations found for "{searchQuery}"
                    </div>
                  </div>
                )}
                
                {/* Loading Indicator */}
                {isSearching && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg p-3 z-20">
                    <div className="text-sm text-muted-foreground text-center">
                      Searching...
                    </div>
                  </div>
                )}
              </div>
              
              {/* Close Button */}
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-md flex-shrink-0"
                onClick={toggleExpanded}
                title="Close search"
              >
                <span className="text-lg leading-none">×</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// --- End Location Search Component ---

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

  // Direct table query as absolute last resort
  const fetchToiletsDirectly = useCallback(async (map: L.Map | null, signal: AbortSignal) => {
    if (!map || signal.aborted) return;

    const bounds = map.getBounds();
    console.log('[ToiletMap Direct] Trying direct table query...');

    try {
      // Try toilet_location table first
      let { data, error } = await supabase
        .from('toilet_location')
        .select('*')
        .gte('lat', bounds.getSouth())
        .lte('lat', bounds.getNorth())
        .gte('lng', bounds.getWest())
        .lte('lng', bounds.getEast())
        .limit(1000);

      if (signal.aborted) return;

      if (error || !data || data.length === 0) {
        console.log('[ToiletMap Direct] toilet_location failed or empty, trying legacy toilets table...');
        // Try legacy toilets table
        const result = await supabase
          .from('toilets')
          .select('*')
          .gte('lat', bounds.getSouth())
          .lte('lat', bounds.getNorth())
          .gte('lng', bounds.getWest())
          .lte('lng', bounds.getEast())
          .limit(1000);

        data = result.data;
        error = result.error;
      }

      if (signal.aborted) return;

      if (error) {
        console.log('[ToiletMap Direct] Direct query error:', error);
        setIsLoading(false);
      } else if (data) {
        console.log(`[ToiletMap Direct] Direct query success: ${data.length} toilets found`);
        setToilets(data);
        setIsLoading(false);
        console.log(`🚽 DIRECT SUCCESS: Map now displaying ${data.length} toilets via direct table query!`);
      } else {
        console.log('[ToiletMap Direct] No toilets found in direct query');
        setIsLoading(false);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.log('[ToiletMap Direct] Direct query exception:', error);
        setIsLoading(false);
      }
    }
  }, [supabase]);

  // Fallback fetch function using find_toilets_in_view
  const fetchToiletsWithFallback = useCallback(async (map: L.Map | null, signal: AbortSignal) => {
    if (!map || signal.aborted) return;

    const bounds = map.getBounds();
    const fallbackParams = {
      min_lat: bounds.getSouth(),
      min_lng: bounds.getWest(),
      max_lat: bounds.getNorth(),
      max_lng: bounds.getEast(),
      max_results: 1000
    };

    console.log('[ToiletMap Fallback] Calling find_toilets_in_view with params:', JSON.stringify(fallbackParams));

    try {
      const { data, error: fallbackError } = await supabase.rpc(
        'find_toilets_in_view',
        fallbackParams
      );

      if (signal.aborted) {
        console.log('[ToiletMap Fallback] Fetch aborted after RPC call returned.');
        return;
      }

      if (fallbackError) {
        console.log('[ToiletMap Fallback] RPC Error:', fallbackError);
        // Try direct table query as last resort
        console.log('[ToiletMap Fallback] Trying direct table query as last resort...');
        await fetchToiletsDirectly(map, signal);
      } else if (data) {
        console.log(`[ToiletMap Fallback] Received ${data.length} toilets.`);
        setToilets(data);
        setIsLoading(false);
        console.log(`🚽 FALLBACK SUCCESS: Map now displaying ${data.length} toilets via find_toilets_in_view!`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.log('[ToiletMap Fallback] Unexpected error:', error);
        // Try direct table query as last resort
        console.log('[ToiletMap Fallback] Trying direct table query due to exception...');
        await fetchToiletsDirectly(map, signal);
      }
    }
  }, [supabase, fetchToiletsDirectly]);

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
      p_center_lat: center.lat, // Add back p_ prefix
      p_center_lng: center.lng, // Add back p_ prefix
      p_user_lat: userLocation?.latitude ?? null, // Add back p_ prefix
      p_user_lng: userLocation?.longitude ?? null, // Add back p_ prefix
      p_is_zoomed_in: isZoomedIn, // Add back p_ prefix
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
           console.log('[ToiletMap V3] Error fetching toilets:', rpcError);
           console.log('[ToiletMap V3] Error details:', JSON.stringify(rpcError, null, 2));
           console.log('[ToiletMap V3] Error message:', rpcError.message);
           console.log('[ToiletMap V3] Error code:', rpcError.code);
           console.log('[ToiletMap V3] Error hint:', rpcError.hint);
           
           // Fallback to find_toilets_in_view if v3 function fails
           console.log('[ToiletMap V3] Attempting fallback to find_toilets_in_view...');
           await fetchToiletsWithFallback(map, signal);
      } else if (data) {
        console.log(`[ToiletMap V3] Received ${data.length} toilets.`);
        setToilets(data);
        console.log(`🚽 SUCCESS: Map now displaying ${data.length} toilets!`);
      }
    } catch (error: any) {
        if (error.name !== 'AbortError') { 
            setIsLoading(false); 
            console.log('[ToiletMap V3] Unexpected error during fetch:', error);
            // Try fallback on unexpected errors too
            console.log('[ToiletMap V3] Attempting fallback due to exception...');
            await fetchToiletsWithFallback(map, signal);
        } else {
             console.log('[ToiletMap V3] Fetch aborted via catch.');
        }
    }
  }, [supabase, userLocation, fetchToiletsWithFallback]); 

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

  // Run database test on mount
  // useEffect(() => {
  //   testDatabaseConnection();
  // }, [testDatabaseConnection]);

  return (
    <MapContainer 
        center={mapCenter} 
        zoom={mapZoom} 
        style={{ height: '85vh', width: '100%' }}
    >
       {/* Add MapEvents to trigger fetch on move/zoom/load */}
       {/* MapEvents needs the map instance, which it gets via useMapEvents hook internally */} 
       <MapEvents onMapViewChange={(map) => debouncedFetchToilets(map)} />
      <MapClickHandler onMapClick={() => setSelectedToiletId(null)} />
      <RecenterControl userLocation={userLocation} />
      <LocationSearch />
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