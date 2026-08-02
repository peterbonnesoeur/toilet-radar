'use client'

import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import L from 'leaflet'
import { useTheme } from 'next-themes'
import 'leaflet-defaulticon-compatibility'
import { LocationSearchControl, RecenterControl } from '@/components/map-controls'
import { ToiletClusterLayer } from '@/components/ToiletClusterLayer'
import { isOpenNow } from '@/lib/utils'
import debounce from 'lodash.debounce'

// Row shape returned by the find_toilets_in_view RPC.
export type Toilet = {
  id: string
  name: string | null
  lat: number | null
  lng: number | null
  accessible: boolean | null
  is_free: boolean | null
  open_hours: string | null
  address: string | null
  created_at: string
}

type UserLocation = {
  latitude: number
  longitude: number
} | null

interface ToiletMapProps {
  userLocation: UserLocation
  locationSource: 'gps' | 'ip' | 'default'
}

type Filters = {
  accessible: boolean
  free: boolean
  openNow: boolean
}

const userIcon = L.icon({
  iconUrl: '/user.png',
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40],
})

const defaultCenter: L.LatLngExpression = [47.3769, 8.5417] // Zurich
const defaultZoom = 13

// Offline resilience: the last successful fetch is kept so the map still
// shows toilets when the network drops (common in basements/parks).
const CACHE_KEY = 'tr:lastToilets'

function readToiletCache(): Toilet[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.toilets) ? parsed.toilets : []
  } catch {
    return []
  }
}

function writeToiletCache(toilets: Toilet[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), toilets: toilets.slice(0, 500) }))
  } catch {
    // Storage full/blocked — cache is best-effort.
  }
}

function MapEvents({ onMapViewChange }: { onMapViewChange: (map: L.Map) => void }) {
  const map = useMapEvents({
    moveend: () => onMapViewChange(map),
    zoomend: () => onMapViewChange(map),
  })
  return null
}

// Fetches once as soon as the map exists — Leaflet's `load` event has
// already fired by the time react-leaflet children mount, so relying on it
// leaves the map empty until the first pan.
function InitialFetch({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return null
}

// Fly to the user once per location-source change (null -> ip -> gps), not
// on every GPS tick.
function FlyToUser({
  userLocation,
  locationSource,
}: {
  userLocation: UserLocation
  locationSource: 'gps' | 'ip' | 'default'
}) {
  const map = useMap()
  const lastSourceRef = useRef<string | null>(null)
  useEffect(() => {
    if (!userLocation || locationSource === 'default') return
    if (lastSourceRef.current === locationSource) return
    lastSourceRef.current = locationSource
    map.flyTo([userLocation.latitude, userLocation.longitude], locationSource === 'gps' ? 15 : 13)
  }, [map, userLocation, locationSource])
  return null
}

function FilterChip({
  label,
  active,
  onToggle,
}: {
  label: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      aria-pressed={active}
      onClick={onToggle}
      className={`px-3 py-1.5 rounded-full text-xs font-medium shadow border transition-colors min-h-[32px] ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background/90 text-muted-foreground border-border hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

export default function ToiletMap({ userLocation, locationSource }: ToiletMapProps) {
  const [toilets, setToilets] = useState<Toilet[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [usingCache, setUsingCache] = useState(false)
  const [filters, setFilters] = useState<Filters>({ accessible: false, free: false, openNow: false })
  const supabase = createClient()
  const { resolvedTheme } = useTheme()
  const abortRef = useRef<AbortController | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  // Hydrate from the offline cache so the map is never empty at startup.
  useEffect(() => {
    const cached = readToiletCache()
    if (cached.length > 0) {
      setToilets(prev => (prev.length === 0 ? cached : prev))
      setUsingCache(true)
    }
    const goOnline = () => setIsOffline(false)
    const goOffline = () => setIsOffline(true)
    setIsOffline(!navigator.onLine)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const fetchToilets = useCallback(
    async (map: L.Map) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsLoading(true)
      // Pad the viewport by 20% so small pans are already covered.
      const bounds = map.getBounds().pad(0.2)

      try {
        const { data, error } = await supabase
          .rpc('find_toilets_in_view', {
            min_lat: bounds.getSouth(),
            min_lng: bounds.getWest(),
            max_lat: bounds.getNorth(),
            max_lng: bounds.getEast(),
            max_results: 2000,
          })
          .abortSignal(controller.signal)

        if (controller.signal.aborted) return

        if (error) {
          console.error('[ToiletMap] find_toilets_in_view failed:', error.message)
          if (!navigator.onLine) setIsOffline(true)
          else setFetchError(true)
        } else {
          setToilets(data ?? [])
          setFetchError(false)
          setUsingCache(false)
          if ((data ?? []).length > 0) writeToiletCache(data)
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !controller.signal.aborted) {
          console.error('[ToiletMap] Unexpected fetch error:', err)
          if (!navigator.onLine) setIsOffline(true)
          else setFetchError(true)
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    },
    [supabase]
  )

  // Stable debounce: the debounced function is created once and always calls
  // the latest fetchToilets via a ref, so pending calls are never orphaned.
  const fetchRef = useRef(fetchToilets)
  fetchRef.current = fetchToilets
  const debouncedFetch = useMemo(
    () => debounce((map: L.Map) => fetchRef.current(map), 400),
    []
  )
  useEffect(
    () => () => {
      debouncedFetch.cancel()
      abortRef.current?.abort()
    },
    [debouncedFetch]
  )

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map
    fetchRef.current(map)
  }, [])

  // Filters are conjunctive; "Open now" keeps unknown hours visible and only
  // drops toilets whose hours parse as currently closed.
  const visibleToilets = useMemo(() => {
    if (!filters.accessible && !filters.free && !filters.openNow) return toilets
    return toilets.filter(t => {
      if (filters.accessible && t.accessible !== true) return false
      if (filters.free && t.is_free !== true) return false
      if (filters.openNow && isOpenNow(t.open_hours) === false) return false
      return true
    })
  }, [toilets, filters])

  const hiddenCount = toilets.length - visibleToilets.length

  const isDark = resolvedTheme === 'dark'
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const attribution = isDark
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

  return (
    <div className="relative w-full h-full" role="region" aria-label="Map of public toilets">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: '100%', width: '100%' }}
      >
        <InitialFetch onReady={handleMapReady} />
        <MapEvents onMapViewChange={debouncedFetch} />
        <FlyToUser userLocation={userLocation} locationSource={locationSource} />

        <RecenterControl
          id="recenter-control"
          userLocation={userLocation}
          position="bottom-right"
          mobilePosition="bottom-right"
          priority={1}
        />
        <LocationSearchControl
          id="location-search"
          position="top-right"
          mobilePosition="top-right"
          priority={2}
        />

        <TileLayer key={isDark ? 'dark' : 'light'} attribution={attribution} url={tileUrl} />

        {userLocation && (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={userIcon}
            alt="Your location"
          >
            <Popup>Your current location</Popup>
          </Marker>
        )}

        <ToiletClusterLayer toilets={visibleToilets} />
      </MapContainer>

      {/* Filter chips */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2" role="group" aria-label="Toilet filters">
        <FilterChip
          label="♿ Accessible"
          active={filters.accessible}
          onToggle={() => setFilters(f => ({ ...f, accessible: !f.accessible }))}
        />
        <FilterChip
          label="Free"
          active={filters.free}
          onToggle={() => setFilters(f => ({ ...f, free: !f.free }))}
        />
        <FilterChip
          label="Open now"
          active={filters.openNow}
          onToggle={() => setFilters(f => ({ ...f, openNow: !f.openNow }))}
        />
      </div>

      {/* Fetch status overlays */}
      <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-1.5 pointer-events-none">
        {isLoading && (
          <div
            role="status"
            className="px-3 py-1.5 rounded-full bg-background/90 shadow text-xs text-muted-foreground flex items-center gap-2"
          >
            <span className="inline-block w-3 h-3 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin" aria-hidden="true" />
            Loading toilets…
          </div>
        )}
        {isOffline && (
          <div role="status" className="px-3 py-1.5 rounded-md bg-amber-500/90 text-amber-950 shadow text-xs font-medium">
            Offline — showing last loaded toilets
          </div>
        )}
        {fetchError && !isLoading && !isOffline && (
          <div
            role="alert"
            className="px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground shadow text-xs flex items-center gap-2 pointer-events-auto"
          >
            Couldn&apos;t load toilets.
            <button
              className="underline font-medium"
              onClick={() => mapRef.current && fetchRef.current(mapRef.current)}
            >
              Retry
            </button>
          </div>
        )}
        {!isLoading && !fetchError && toilets.length === 0 && !usingCache && (
          <div role="status" className="px-3 py-1.5 rounded-full bg-background/90 shadow text-xs text-muted-foreground">
            No toilets known in this area
          </div>
        )}
        {hiddenCount > 0 && (
          <div role="status" className="px-3 py-1.5 rounded-full bg-background/90 shadow text-xs text-muted-foreground">
            {hiddenCount} hidden by filters
          </div>
        )}
      </div>
    </div>
  )
}
