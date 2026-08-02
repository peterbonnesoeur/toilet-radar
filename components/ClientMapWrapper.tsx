'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { calculateDistance, walkingTime } from '@/lib/utils'

const ToiletMap = dynamic(() => import('@/components/ToiletMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted/30">
      <p className="text-sm text-muted-foreground animate-pulse">Loading map…</p>
    </div>
  ),
})

type UserLocation = {
  latitude: number
  longitude: number
}

type LocationSource = 'gps' | 'ip' | 'default'

// Row shape returned by the find_nearest_toilets RPC.
type NearestToiletResult = {
  id: string
  name: string | null
  lat: number
  lng: number
  address: string | null
  accessible: boolean | null
  is_free: boolean | null
  type: string | null
  status: string | null
  notes: string | null
  city: string | null
  open_hours: string | null
  distance: number
  created_at: string
}

// IP-based fallback when GPS is unavailable. Tried at most once per session;
// both services are keyless.
const getLocationFromIP = async (): Promise<UserLocation | null> => {
  const services: Array<{ url: string; parse: (data: any) => UserLocation | null }> = [
    {
      url: 'https://ipapi.co/json/',
      parse: data =>
        data.latitude && data.longitude && !data.error
          ? { latitude: parseFloat(data.latitude), longitude: parseFloat(data.longitude) }
          : null,
    },
    {
      url: 'https://ipinfo.io/json',
      parse: data => {
        if (!data.loc) return null
        const [lat, lng] = data.loc.split(',')
        return { latitude: parseFloat(lat), longitude: parseFloat(lng) }
      },
    },
  ]

  for (const service of services) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(service.url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (response.ok) {
        const location = service.parse(await response.json())
        if (location) return location
      }
    } catch {
      // Try the next service.
    }
  }
  return null
}

const directionsUrl = (from: UserLocation, to: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.lat},${to.lng}&travelmode=walking`

export default function ClientMapWrapper() {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [locationSource, setLocationSource] = useState<LocationSource>('default')
  const [locationDenied, setLocationDenied] = useState(false)
  const [nearest, setNearest] = useState<NearestToiletResult | null>(null)
  const [multiStopUrl, setMultiStopUrl] = useState<string | null>(null)
  const [nearestToilets, setNearestToilets] = useState<NearestToiletResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [sheetCollapsed, setSheetCollapsed] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const watchIdRef = useRef<number | null>(null)
  const ipTriedRef = useRef(false)
  const isMountedRef = useRef(true)
  const nearestFetchPosRef = useRef<UserLocation | null>(null)

  const supabase = createClient()

  const tryIPGeolocation = useCallback(async () => {
    if (ipTriedRef.current) return
    ipTriedRef.current = true

    const ipLocation = await getLocationFromIP()
    if (!isMountedRef.current) return

    // GPS may have succeeded while the IP lookup was in flight — never
    // downgrade a GPS fix.
    setUserLocation(prev => (prev ? prev : ipLocation))
    setLocationSource(prev => (prev === 'gps' ? prev : ipLocation ? 'ip' : 'default'))
  }, [])

  const startWatch = useCallback(() => {
    if (!navigator.geolocation || watchIdRef.current !== null) return

    watchIdRef.current = navigator.geolocation.watchPosition(
      position => {
        if (!isMountedRef.current) return
        const { latitude, longitude } = position.coords
        setUserLocation({ latitude, longitude })
        setLocationSource('gps')
        setLocationDenied(false)
        setErrorMsg(null)
      },
      error => {
        if (!isMountedRef.current) return
        if (error.code === error.PERMISSION_DENIED) {
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
          }
          setLocationDenied(true)
        }
        tryIPGeolocation()
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    )
  }, [tryIPGeolocation])

  useEffect(() => {
    setIsClient(true)
    isMountedRef.current = true

    if (navigator.geolocation) {
      startWatch()
    } else {
      tryIPGeolocation()
    }

    return () => {
      isMountedRef.current = false
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [startWatch, tryIPGeolocation])

  // A2 — answer before asked: as soon as a location is known (and again
  // after moving >150 m), quietly fetch the single nearest toilet so the
  // sheet can show "Nearest: X min walk" without any button press.
  useEffect(() => {
    if (!userLocation) return
    const last = nearestFetchPosRef.current
    if (
      last &&
      calculateDistance(last.latitude, last.longitude, userLocation.latitude, userLocation.longitude) * 1000 < 150
    ) {
      return
    }
    nearestFetchPosRef.current = userLocation

    let cancelled = false
    supabase
      .rpc('find_nearest_toilets', {
        user_lat: userLocation.latitude,
        user_lng: userLocation.longitude,
        radius_meters: 5000,
        result_limit: 1,
      })
      .then(({ data, error }: { data: NearestToiletResult[] | null; error: any }) => {
        if (cancelled || error || !data || data.length === 0) return
        setNearest(data[0])
      })
    return () => {
      cancelled = true
    }
  }, [userLocation, supabase])

  // User-gesture retry: a fresh getCurrentPosition re-prompts on browsers
  // that allow it.
  const requestPreciseLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      position => {
        if (!isMountedRef.current) return
        const { latitude, longitude } = position.coords
        setUserLocation({ latitude, longitude })
        setLocationSource('gps')
        setLocationDenied(false)
        setErrorMsg(null)
        startWatch()
      },
      () => {
        if (!isMountedRef.current) return
        setLocationDenied(true)
        setErrorMsg('Location is blocked for this site — enable it in your browser settings, then try again.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const findNearestToiletsRoute = async () => {
    if (!userLocation) {
      setErrorMsg('Waiting for your location… Please ensure location access is enabled.')
      return
    }

    setIsLoading(true)
    setErrorMsg(null)
    setMultiStopUrl(null)
    setNearestToilets([])
    setSheetCollapsed(false)

    const { latitude, longitude } = userLocation

    try {
      const { data: fetchedToilets, error: rpcError } = await supabase.rpc('find_nearest_toilets', {
        user_lat: latitude,
        user_lng: longitude,
        radius_meters: 20000,
        result_limit: 3,
      })

      if (rpcError) {
        console.error('[findNearestToiletsRoute] RPC Error:', rpcError.message)
        setErrorMsg('Could not find nearby toilets. Please try again.')
        return
      }

      if (!fetchedToilets || fetchedToilets.length === 0) {
        setErrorMsg('No toilets found within 20km.')
        return
      }

      setNearestToilets(fetchedToilets)

      let finalUrl = `https://www.google.com/maps/dir/?api=1&origin=${latitude},${longitude}`
      const waypoints = fetchedToilets
        .slice(0, -1)
        .map((t: NearestToiletResult) => `${t.lat},${t.lng}`)
        .join('|')
      const destination = fetchedToilets[fetchedToilets.length - 1]
      finalUrl += `&destination=${destination.lat},${destination.lng}`
      if (waypoints) finalUrl += `&waypoints=${waypoints}`
      finalUrl += `&travelmode=walking`

      setMultiStopUrl(finalUrl)
    } catch (err) {
      console.error('[findNearestToiletsRoute] Unexpected error:', err)
      setErrorMsg('Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const clearResults = () => {
    setMultiStopUrl(null)
    setNearestToilets([])
    setErrorMsg(null)
  }

  const hasResults = multiStopUrl !== null && nearestToilets.length > 0

  return (
    <div className="w-full h-full flex flex-col relative">
      {/* Decorative logo — clear of all controls; pointer-events-none so it
          can never block map interactions. */}
      <Image
        src="/logo.png"
        alt=""
        width={120}
        height={120}
        priority
        className="absolute bottom-8 left-4 z-[10] hidden md:block opacity-80 pointer-events-none select-none"
      />

      <div className="relative z-0 flex-grow min-h-0">
        {isClient ? (
          <ToiletMap userLocation={userLocation} locationSource={locationSource} />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/30">
            <p className="text-sm text-muted-foreground animate-pulse">Loading map…</p>
          </div>
        )}
      </div>

      {/* A1 — bottom sheet: full-width and bottom-anchored on phones,
          compact centered card on md+. */}
      <div className="absolute bottom-0 inset-x-0 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-4 md:w-[24rem] z-[1000]">
        <div className="bg-background/95 backdrop-blur-sm shadow-[0_-4px_16px_rgba(0,0,0,0.15)] md:shadow-xl rounded-t-2xl md:rounded-2xl border-t md:border border-border/60 px-4 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:pb-3 flex flex-col items-center gap-2">
          {/* Handle */}
          <button
            onClick={() => setSheetCollapsed(c => !c)}
            aria-label={sheetCollapsed ? 'Expand panel' : 'Collapse panel'}
            aria-expanded={!sheetCollapsed}
            className="w-full flex flex-col items-center py-0.5 text-muted-foreground"
          >
            <span className="w-10 h-1 rounded-full bg-muted-foreground/30 mb-0.5" aria-hidden="true" />
            {sheetCollapsed ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
          </button>

          {/* A2 — nearest toilet, always visible (even collapsed): the answer
              before the question. */}
          {nearest && userLocation && nearest.lat != null && nearest.lng != null && (
            <a
              href={directionsUrl(userLocation, nearest)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground hover:opacity-90 min-h-[44px]"
            >
              <span className="text-sm truncate">
                <span className="font-semibold">Nearest:</span> {nearest.name || 'Public toilet'}
              </span>
              <span className="text-sm font-bold whitespace-nowrap">{walkingTime(nearest.distance)} →</span>
            </a>
          )}

          {!sheetCollapsed && (
            <>
              {/* Location status */}
              <div role="status" className="text-xs text-muted-foreground flex items-center gap-1.5">
                {locationSource === 'gps' && (
                  <>
                    <span aria-hidden="true">📍</span>
                    <span>GPS location</span>
                  </>
                )}
                {locationSource === 'ip' && (
                  <>
                    <span aria-hidden="true">🌐</span>
                    <span>Approximate location</span>
                    <button onClick={requestPreciseLocation} className="underline font-medium">
                      Use precise location
                    </button>
                  </>
                )}
                {locationSource === 'default' && (
                  <>
                    <span aria-hidden="true">🗺️</span>
                    <span>{locationDenied ? 'Location blocked' : 'Locating…'}</span>
                    <button onClick={requestPreciseLocation} className="underline font-medium">
                      Use my location
                    </button>
                  </>
                )}
              </div>

              <Button
                onClick={findNearestToiletsRoute}
                disabled={isLoading}
                variant="destructive"
                size="lg"
                className="font-bold text-lg min-h-[48px] w-full md:w-auto"
              >
                {isLoading ? 'Finding toilets…' : '🆘 Save Meeee'}
              </Button>

              {errorMsg && (
                <p role="alert" className="text-destructive text-sm text-center max-w-xs">
                  {errorMsg}
                </p>
              )}

              {hasResults && (
                <div className="w-full text-center">
                  <div className="flex items-center gap-2">
                    <a
                      href={multiStopUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:opacity-90 text-sm font-medium min-h-[44px] flex items-center justify-center"
                    >
                      Open route to nearest {nearestToilets.length} toilet{nearestToilets.length > 1 ? 's' : ''}
                    </a>
                    <button
                      onClick={clearResults}
                      aria-label="Dismiss route results"
                      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  <ul className="space-y-1 text-xs mt-2">
                    {nearestToilets.map((toilet, index) => (
                      <li key={toilet.id} className="p-1.5 border-b border-border/50 last:border-b-0 flex justify-between gap-2">
                        <span className="truncate text-left">
                          {index + 1}. {toilet.name || 'Unnamed Toilet'}
                        </span>
                        <span className="whitespace-nowrap font-medium">{walkingTime(toilet.distance)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!isLoading && (hasResults || errorMsg) && (
                <div className="pt-2 border-t border-border/50 w-full text-center">
                  <a
                    href="https://buymeacoffee.com/maximebonnesoeur"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-yellow-400 text-yellow-900 rounded-md hover:bg-yellow-500 transition-colors"
                  >
                    <span aria-hidden="true">☕</span> Buy me a coffee?
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
