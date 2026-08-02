'use client'

import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { Toilet } from './ToiletMap'

const toiletIcon = L.icon({
  iconUrl: '/toilet.png',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
})

const selectedToiletIcon = L.icon({
  iconUrl: '/premium_toilet.png',
  iconSize: [48, 48],
  iconAnchor: [24, 48],
  popupAnchor: [0, -48],
})

// Popup content is built with DOM APIs and textContent so database strings
// (imported from OSM, i.e. untrusted) can never inject HTML.
function buildPopupContent(toilet: Toilet): HTMLElement {
  const root = document.createElement('div')
  root.className = 'toilet-popup'

  const title = document.createElement('h3')
  title.textContent = toilet.name || 'Public Toilet'
  root.appendChild(title)

  if (toilet.address) {
    const addressLink = document.createElement('a')
    addressLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toilet.address)}`
    addressLink.target = '_blank'
    addressLink.rel = 'noopener noreferrer'
    addressLink.textContent = toilet.address
    root.appendChild(addressLink)
  }

  const addRow = (label: string, value: string) => {
    const p = document.createElement('p')
    const strong = document.createElement('strong')
    strong.textContent = `${label}: `
    p.appendChild(strong)
    p.appendChild(document.createTextNode(value))
    root.appendChild(p)
  }

  addRow(
    'Accessibility',
    toilet.accessible === null ? 'Unknown' : toilet.accessible ? '♿ Accessible' : 'Not accessible'
  )
  if (toilet.is_free !== null) addRow('Fee', toilet.is_free ? 'Free' : 'Paid')
  if (toilet.open_hours) addRow('Hours', toilet.open_hours)

  if (toilet.lat != null && toilet.lng != null) {
    const directions = document.createElement('a')
    directions.href = `https://www.google.com/maps/dir/?api=1&destination=${toilet.lat},${toilet.lng}&travelmode=walking`
    directions.target = '_blank'
    directions.rel = 'noopener noreferrer'
    directions.className = 'toilet-popup-directions'
    directions.textContent = 'Directions →'
    root.appendChild(directions)
  }

  return root
}

export function ToiletClusterLayer({ toilets }: { toilets: Toilet[] }) {
  const map = useMap()
  const groupRef = useRef<L.MarkerClusterGroup | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())

  useEffect(() => {
    const group = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 60,
      disableClusteringAtZoom: 17,
    })
    map.addLayer(group)
    groupRef.current = group
    return () => {
      map.removeLayer(group)
      groupRef.current = null
      markersRef.current.clear()
    }
  }, [map])

  // Diff by id instead of rebuilding: a full clearLayers() on every fetch
  // would destroy the marker of any open popup — Leaflet's popup auto-pan
  // fires moveend, which triggers a refetch, which would instantly close
  // the popup the user just opened. Diffing also avoids re-creating
  // hundreds of markers on every small pan.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    const current = markersRef.current
    const nextIds = new Set(toilets.map(t => t.id))

    const stale: L.Marker[] = []
    const staleIds: string[] = []
    current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        stale.push(marker)
        staleIds.push(id)
      }
    })
    staleIds.forEach(id => current.delete(id))
    group.removeLayers(stale)

    const added: L.Marker[] = []
    for (const t of toilets) {
      if (t.lat == null || t.lng == null || current.has(t.id)) continue
      const marker = L.marker([t.lat, t.lng], {
        icon: toiletIcon,
        alt: t.name || 'Public toilet',
      })
      // Lazy: content is only built when the popup opens.
      marker.bindPopup(() => buildPopupContent(t), { maxWidth: 280 })
      marker.on('popupopen', () => marker.setIcon(selectedToiletIcon))
      marker.on('popupclose', () => marker.setIcon(toiletIcon))
      current.set(t.id, marker)
      added.push(marker)
    }
    group.addLayers(added)
  }, [toilets])

  return null
}
