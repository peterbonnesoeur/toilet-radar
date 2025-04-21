'use client' // Add this directive for client-side hooks

import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
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

export default function ToiletMap() {
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

  // Default center coordinates (Zurich)
  const defaultCenter: [number, number] = [47.3769, 8.5417];

  return (
    <MapContainer center={defaultCenter} zoom={13} style={{ height: '90vh', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & ZüriWC Data' // Added data attribution
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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