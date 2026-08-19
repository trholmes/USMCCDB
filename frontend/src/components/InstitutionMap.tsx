import { Text, useComputedColorScheme } from '@mantine/core'
import { LatLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import { Link } from 'react-router-dom'
import type { Institution } from '../api/types'

// OSM data via CARTO's free basemaps (issue #112) — the one external runtime
// dependency of an otherwise self-hosted app; the member data itself never
// leaves the site (marker coordinates are part of the page, not the tile URLs).
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{r}.png'
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

export default function InstitutionMap({ institutions }: { institutions: Institution[] }) {
  const scheme = useComputedColorScheme('light')
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
        <TileLayer
          // Force a remount when the style flips — react-leaflet only patches
          // the URL on prop change for the same layer, which keeps stale tiles.
          key={scheme}
          url={TILE_URL.replace('{style}', scheme === 'dark' ? 'dark_all' : 'light_all')}
          attribution={ATTRIBUTION}
          subdomains="abcd"
        />
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
