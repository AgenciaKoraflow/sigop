'use client'

import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * Mini-map used inside the incident form's "GPS" tab.
 *
 * This module is loaded exclusively through `next/dynamic` with `ssr: false`
 * (see FormOcorrencia) — Leaflet touches `window` at import time and must never
 * run on the server.
 */

export interface LocationMapProps {
  lat: number
  lng: number
  /** Called when the user taps the map to nudge the pin. */
  onChange?: (lat: number, lng: number) => void
}

// A self-contained pin so we don't depend on Leaflet's bundled marker assets,
// which break under the Next.js bundler.
const pinIcon = L.divIcon({
  className: 'sigop-map-pin',
  html:
    '<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;' +
    'background:#3b5fc0;border:2px solid #fff;transform:rotate(-45deg);' +
    'box-shadow:0 1px 4px rgba(0,0,0,0.4)"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
})

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true })
  }, [lat, lng, map])
  return null
}

function ClickHandler({ onChange }: { onChange?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onChange?.(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

export function LocationMap({ lat, lng, onChange }: LocationMapProps) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      scrollWheelZoom={false}
      className="h-52 w-full rounded-input border border-content-border"
      style={{ zIndex: 0 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]} icon={pinIcon} />
      <Recenter lat={lat} lng={lng} />
      <ClickHandler onChange={onChange} />
    </MapContainer>
  )
}

export default LocationMap
