import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { geocodeAddress } from './geocode'

const STREET_LEVEL_ZOOM = 16

type Status = 'idle' | 'loading' | 'not-found' | 'error'

function SearchBar({ mapRef }: { mapRef: RefObject<MapLibreMap | null> }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const markerRef = useRef<Marker | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const address = query.trim()
    if (!address || !mapRef.current) return

    setStatus('loading')
    try {
      const result = await geocodeAddress(address)
      if (!result) {
        setStatus('not-found')
        return
      }

      setStatus('idle')
      const lngLat: [number, number] = [result.lon, result.lat]
      if (markerRef.current) {
        markerRef.current.setLngLat(lngLat)
      } else {
        markerRef.current = new Marker().setLngLat(lngLat).addTo(mapRef.current)
      }
      mapRef.current.flyTo({ center: lngLat, zoom: STREET_LEVEL_ZOOM })
    } catch {
      setStatus('error')
    }
  }

  return (
    <div style={{ position: 'absolute', top: 16, left: 16, maxWidth: 320 }}>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 8,
          background: 'rgba(255, 255, 255, 0.9)',
          padding: 8,
          borderRadius: 6,
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Enter a US address"
          style={{ flex: 1, border: '1px solid #ccc', borderRadius: 4, padding: '6px 8px' }}
        />
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>
      {status === 'not-found' && (
        <div style={{ marginTop: 8, background: 'rgba(255, 255, 255, 0.9)', padding: 8, borderRadius: 6 }}>
          Address not found — try a more complete address.
        </div>
      )}
      {status === 'error' && (
        <div style={{ marginTop: 8, background: 'rgba(255, 255, 255, 0.9)', padding: 8, borderRadius: 6 }}>
          Something went wrong — try again.
        </div>
      )}
    </div>
  )
}

export default SearchBar
