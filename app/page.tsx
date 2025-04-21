// Remove the dynamic import from here
// import dynamic from 'next/dynamic'
import HeaderAuth from "@/components/header-auth";
import ClientMapWrapper from '@/components/ClientMapWrapper'; // Import the new client wrapper

// Remove the dynamic import definition
// const ToiletMap = dynamic(() => import('@/components/ToiletMap'), {
//   ssr: false,
//   loading: () => <p>Loading map...</p> // Optional: Add a loading indicator
// })

export default function Home() {
  return (
    // Ensure the main container allows the map wrapper to fill height
    <div className="flex flex-col items-center w-full flex-grow">
      {/* Header (optional) */}
      {/* <HeaderAuth /> */}
      
      {/* Title */}
      {/* <h1 className="text-3xl font-bold my-4">🚽 Toilet Radar Zurich</h1> */}
      {/* Removed the title to give more space to the map/button */}

      {/* Render the map and button wrapper - Make it take available vertical space */}
      <div className="w-full flex-grow"> 
        <ClientMapWrapper /> 
      </div>

    </div>
  )
}
