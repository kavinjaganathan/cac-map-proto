import { useRef, useState, type FormEvent, type RefObject } from 'react'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { geocodeAddress } from './geocode'

const STREET_LEVEL_ZOOM = 16

const COLOR_BACKGROUND = '#EFE9DE'
const COLOR_BORDER = '#C9BEA9'
const COLOR_TEXT = '#2B2620'
const COLOR_ACCENT = '#B5804A'
const COLOR_HOVER = '#E3DBCB'

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
      <style>{`
        .search-bar-input {
          flex: 1;
          border: 1px solid ${COLOR_BORDER};
          border-radius: 4px;
          padding: 6px 8px;
          background: ${COLOR_BACKGROUND};
          color: ${COLOR_TEXT};
          outline: none;
        }
        .search-bar-input:focus {
          border-color: ${COLOR_ACCENT};
          box-shadow: 0 0 0 2px ${COLOR_ACCENT}33;
        }
        .search-bar-button {
          border: 1px solid ${COLOR_BORDER};
          border-radius: 4px;
          padding: 6px 12px;
          background: ${COLOR_BACKGROUND};
          color: ${COLOR_TEXT};
          cursor: pointer;
        }
        .search-bar-button:hover:not(:disabled) {
          background: ${COLOR_HOVER};
          border-color: ${COLOR_ACCENT};
        }
        .search-bar-button:disabled {
          opacity: 0.6;
          cursor: default;
        }
      `}</style>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 8,
          background: COLOR_BACKGROUND,
          border: `1px solid ${COLOR_BORDER}`,
          padding: 8,
          borderRadius: 6,
          boxShadow: `0 1px 2px ${COLOR_TEXT}1f`,
        }}
      >
        <input
          type="text"
          className="search-bar-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Enter a US address"
        />
        <button type="submit" className="search-bar-button" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>
      {status === 'not-found' && (
        <div
          style={{
            marginTop: 8,
            background: COLOR_BACKGROUND,
            border: `1px solid ${COLOR_BORDER}`,
            color: COLOR_TEXT,
            padding: 8,
            borderRadius: 6,
            boxShadow: `0 1px 2px ${COLOR_TEXT}1f`,
          }}
        >
          Address not found — try a more complete address.
        </div>
      )}
      {status === 'error' && (
        <div
          style={{
            marginTop: 8,
            background: COLOR_BACKGROUND,
            border: `1px solid ${COLOR_BORDER}`,
            color: COLOR_TEXT,
            padding: 8,
            borderRadius: 6,
            boxShadow: `0 1px 2px ${COLOR_TEXT}1f`,
          }}
        >
          Something went wrong — try again.
        </div>
      )}
    </div>
  )
}

export default SearchBar
