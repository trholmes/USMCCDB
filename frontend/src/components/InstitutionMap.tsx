import { Text, useComputedColorScheme } from '@mantine/core'
import { LatLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Institution, SiteSettings } from '../api/types'

// OSM data via CARTO basemaps (issues #112, #138) — the one external runtime
// dependency of an otherwise self-hosted app; the member data itself never
// leaves the site (marker coordinates are part of the page, not the tile URLs).
// With an API key (admin panel → site settings) the supported authenticated
// endpoint is used; without one, the deprecated keyless tiles still render
// but carry CARTO's "API key required" watermark.
const FREE_TILE_URL = 'https://{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{r}.png'
const KEYED_TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/{style}/{z}/{x}/{y}{r}.png?key={key}'
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

export default function InstitutionMap({ institutions }: { institutions: Institution[] }) {
  const scheme = useComputedColorScheme('light')
  // undefined = still loading (don't flash watermarked tiles), null = no key set.
  const [cartoKey, setCartoKey] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    api
      .get<SiteSettings>('/site/settings')
      .then((s) => setCartoKey(s.carto_api_key))
      .catch(() => setCartoKey(null))
  }, [])
  const located = institutions.filter((i) => i.latitude != null && i.longitude != null)

  // Frame all markers; sensible USA default while nothing has coordinates yet.
  const bounds =
    located.length > 0
      ? new LatLngBounds(located.map((i) => [i.latitude!, i.longitude!])).pad(0.2)
      : new LatLngBounds([
          [24, -125],
          [50, -66],
        ])

  return (
    <>
      <MapContainer
        bounds={bounds}
        scrollWheelZoom
        style={{ height: '70vh', minHeight: 420, borderRadius: 8 }}
      >
        {cartoKey !== undefined && (
          <TileLayer
            // Force a remount when the style or key flips — react-leaflet only
            // patches the URL on prop change for the same layer, which keeps
            // stale tiles.
            key={`${scheme}-${cartoKey ?? 'free'}`}
            url={(cartoKey
              ? KEYED_TILE_URL.replace('{key}', encodeURIComponent(cartoKey))
              : FREE_TILE_URL
            ).replace('{style}', scheme === 'dark' ? 'dark_all' : 'light_all')}
            attribution={ATTRIBUTION}
            subdomains="abcd"
          />
        )}
        {located.map((i) => (
          <CircleMarker
            key={i.id}
            center={[i.latitude!, i.longitude!]}
            // Area tracks membership: radius ~ sqrt(count), clamped legible.
            radius={Math.min(6 + Math.sqrt(i.people_count) * 2.5, 22)}
            pathOptions={{ color: '#4c6ef5', fillColor: '#4c6ef5', fillOpacity: 0.55, weight: 1.5 }}
          >
            <Popup>
              <Link to={`/institutions/${i.id}`}>{i.name}</Link>
              <br />
              {i.people_count} member{i.people_count === 1 ? '' : 's'}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {located.length < institutions.length && (
        <Text size="xs" c="dimmed" mt={6}>
          {institutions.length - located.length} institution
          {institutions.length - located.length === 1 ? ' has' : 's have'} no coordinates yet — the
          office can fill them (or fetch them from ROR) in each institution's edit form.
        </Text>
      )}
    </>
  )
}
