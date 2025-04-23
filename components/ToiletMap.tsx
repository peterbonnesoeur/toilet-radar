'use client' // Add this directive for client-side hooks

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client' // Adjusted import path
import L from 'leaflet'; // Import Leaflet library for custom icons if needed
import 'leaflet-defaulticon-compatibility'; // <-- Add this line here

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
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
};

// Define the custom toilet icon
const toiletIcon = L.icon({
    iconUrl: "/toilet-icon.png", // Path to your custom icon in the public folder
    // iconRetinaUrl: "/toilet-icon-2x.png", // Optional: Add if you have a retina version
    iconSize: [32, 32],    // Adjust size as needed [width, height]
    iconAnchor: [16, 32],   // Point of the icon which will correspond to marker's location [width/2, height]
    popupAnchor: [0, -32]   // Point from which the popup should open relative to the iconAnchor [offsetX, offsetY]
    // shadowUrl: "/marker-shadow.png", // Optional: Add shadow if desired
    // shadowSize: [41, 41],
    // shadowAnchor: [12, 41]
});

// Define a custom icon for the user
const userIcon = new L.Icon({
    iconUrl: '/user-location-marker.png', // Use path from /public
    iconSize: [25, 31],
    iconAnchor: [12, 31],
    popupAnchor: [1, -34],
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
    shadowSize: [31, 31]
});

const defaultCenter: L.LatLngExpression = [47.3769, 8.5417]; // Default to Zurich center
const defaultZoom = 13;

// Update component to accept userLocation prop
export default function ToiletMap({ userLocation }: ToiletMapProps) {
  const [toilets, setToilets] = useState<Toilet[]>([])
  const supabase = createClient() // Initialize Supabase client

  useEffect(() => {
    const fetchToilets = async () => {
      const { data, error } = await supabase.from('toilets').select('*')
      if (error) {
        console.error('Error fetching toilets:', error)
      } else if (data) {
        setToilets(data)
      }
    }
    fetchToilets()
  }, [supabase]) // Add supabase as a dependency
  
  // Determine map center and zoom based on user location prop
  const mapCenter: L.LatLngExpression = userLocation
    ? [userLocation.latitude, userLocation.longitude]
    : defaultCenter;
  const mapZoom = userLocation ? 15 : defaultZoom;

  return (
    <MapContainer center={mapCenter} zoom={mapZoom} style={{ height: '90vh', width: '100%' }}>
      <ChangeView center={mapCenter} zoom={mapZoom} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & ZüriWC Data' // Added data attribution
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
        // Construct Google Maps link (only if address exists)
        const googleMapsQuery = toilet.address ? encodeURIComponent(toilet.address) : null;
        const googleMapsLink = googleMapsQuery ? `https://www.google.com/maps/search/?api=1&query=${googleMapsQuery}` : null;

        return toilet.lat && toilet.lng && (
          <Marker key={toilet.id} position={[toilet.lat, toilet.lng]} icon={toiletIcon}> 
            <Popup>
              <div className="font-sans"> 
                <strong className="text-lg">{toilet.name || 'Unnamed Toilet'}</strong><br />
                {/* Display address and link */} 
                {toilet.address && googleMapsLink ? (
                  <a 
                    href={googleMapsLink} 
                    target="_blank" // Open in new tab
                    rel="noopener noreferrer" // Security best practice
                    className="text-xs text-blue-600 hover:underline block mb-1"
                  >
                    {toilet.address}
                  </a>
                ) : toilet.address ? (
                  <span className="text-xs text-gray-700 block mb-1">{toilet.address}</span>
                ) : null}
                <span className="text-sm">
                  {toilet.accessible === null 
                    ? 'Accessibility unknown' 
                    : toilet.accessible 
                      ? '♿ Accessible' 
                      : '🚫 Not Accessible'}
                </span>
                <br />
                <small className="text-xs text-gray-600">
                  Hours: {toilet.open_hours || 'N/A'}
                </small>
              </div>
            </Popup>
          </Marker>
        )
       }
      )}
    </MapContainer>
  )
} 