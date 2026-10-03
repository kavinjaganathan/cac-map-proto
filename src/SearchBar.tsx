import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { geocodeAddress } from './geocode'
import { fetchAddressSuggestions, NominatimRateLimitError, type AddressSuggestion } from './nominatim'

const STREET_LEVEL_ZOOM = 16
const SUGGESTION_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 3

const COLOR_SURFACE = '#FFFFFF'
const COLOR_DIVIDER = '#E4DED3'
const COLOR_TEXT = '#2B2620'
const COLOR_TEXT_MUTED = '#6F665A'
const COLOR_ACCENT = '#B5804A'
const COLOR_HOVER = '#F3EFE8'
const SHADOW = `0 2px 8px ${COLOR_TEXT}26`

type Status = 'idle' | 'loading' | 'not-found' | 'error'
type SuggestionStatus = 'idle' | 'loading' | 'no-results' | 'error' | 'rate-limited'

function SearchBar({ mapRef }: { mapRef: RefObject<MapLibreMap | null> }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const markerRef = useRef<Marker | null>(null)

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [suggestionStatus, setSuggestionStatus] = useState<SuggestionStatus>('idle')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  async function runGeocode(address: string) {
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

  function handleQueryChange(value: string) {
    setQuery(value)
    setHighlightedIndex(-1)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    const trimmed = value.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setDropdownOpen(false)
      setSuggestions([])
      setSuggestionStatus('idle')
      return
    }

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller

      setSuggestionStatus('loading')
      setDropdownOpen(true)
      fetchAddressSuggestions(trimmed, controller.signal)
        .then((results) => {
          setSuggestions(results)
          setSuggestionStatus(results.length === 0 ? 'no-results' : 'idle')
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setSuggestions([])
          setSuggestionStatus(error instanceof NominatimRateLimitError ? 'rate-limited' : 'error')
        })
    }, SUGGESTION_DEBOUNCE_MS)
  }

  function selectSuggestion(suggestion: AddressSuggestion) {
    setQuery(suggestion.label)
    setDropdownOpen(false)
    setSuggestions([])
    setHighlightedIndex(-1)
    void runGeocode(suggestion.censusAddress)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (dropdownOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      selectSuggestion(suggestions[highlightedIndex])
      return
    }
    setDropdownOpen(false)
    void runGeocode(query.trim())
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen || suggestions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((index) => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Escape') {
      setDropdownOpen(false)
      setHighlightedIndex(-1)
    }
  }

  const rowStyle = {
    background: COLOR_SURFACE,
    color: COLOR_TEXT,
    padding: '10px 16px',
    borderRadius: 10,
    boxShadow: SHADOW,
  }

  return (
    <div className="search-bar">
      <style>{`
        .search-bar {
          position: absolute;
          top: 16px;
          left: 16px;
          width: 340px;
          font-family: 'Public Sans', system-ui, sans-serif;
        }
        @media (max-width: 760px) {
          .search-bar {
            width: auto;
            right: 16px;
          }
        }
        .search-bar-form {
          display: flex;
          align-items: center;
          gap: 10px;
          height: 48px;
          padding: 0 16px;
          background: ${COLOR_SURFACE};
          border-radius: 10px;
          box-shadow: ${SHADOW};
          color: ${COLOR_TEXT_MUTED};
        }
        .search-bar-form:focus-within {
          box-shadow: ${SHADOW}, 0 0 0 2px ${COLOR_ACCENT}66;
        }
        .search-bar-input {
          flex: 1;
          min-width: 0;
          border: none;
          padding: 0;
          background: transparent;
          color: ${COLOR_TEXT};
          font: inherit;
          font-size: 15px;
          outline: none;
        }
        .search-bar-input::placeholder {
          color: ${COLOR_TEXT_MUTED};
        }
        .search-bar-suggestion {
          padding: 10px 16px;
          cursor: pointer;
          border-bottom: 1px solid ${COLOR_DIVIDER};
        }
        .search-bar-suggestion:last-child {
          border-bottom: none;
        }
        .search-bar-suggestion:hover,
        .search-bar-suggestion.highlighted {
          background: ${COLOR_HOVER};
        }
      `}</style>
      {/* No submit button — Enter submits the form. */}
      <form onSubmit={handleSubmit} className="search-bar-form" role="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <line x1="15.5" y1="15.5" x2="21" y2="21" />
        </svg>
        <input
          type="text"
          className="search-bar-input"
          aria-label="Search for a US address"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setDropdownOpen(true)
          }}
          onBlur={() => setDropdownOpen(false)}
          placeholder="Enter a US address"
          autoComplete="off"
        />
      </form>

      {dropdownOpen && (
        <div style={{ marginTop: 8, borderRadius: 10, overflow: 'hidden', boxShadow: SHADOW }}>
          {suggestionStatus === 'loading' && <div style={rowStyle}>Searching…</div>}
          {suggestionStatus === 'no-results' && <div style={rowStyle}>No matching addresses.</div>}
          {suggestionStatus === 'rate-limited' && (
            <div style={rowStyle}>Too many searches — wait a moment and try again.</div>
          )}
          {suggestionStatus === 'error' && <div style={rowStyle}>Suggestions unavailable — try again.</div>}
          {suggestionStatus === 'idle' &&
            suggestions.map((suggestion, index) => (
              <div
                key={suggestion.id}
                className={`search-bar-suggestion${index === highlightedIndex ? ' highlighted' : ''}`}
                style={{ background: COLOR_SURFACE, color: COLOR_TEXT }}
                // onMouseDown (not onClick) fires before the input's onBlur,
                // so the selection registers before the dropdown closes.
                onMouseDown={(event) => {
                  event.preventDefault()
                  selectSuggestion(suggestion)
                }}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                {suggestion.label}
              </div>
            ))}
        </div>
      )}

      {/* Stands in for the old button's "Searching…" label. */}
      {!dropdownOpen && status === 'loading' && <div style={{ marginTop: 8, ...rowStyle }}>Searching…</div>}
      {!dropdownOpen && status === 'not-found' && (
        <div style={{ marginTop: 8, ...rowStyle }}>Address not found — try a more complete address.</div>
      )}
      {!dropdownOpen && status === 'error' && (
        <div style={{ marginTop: 8, ...rowStyle }}>Something went wrong — try again.</div>
      )}
    </div>
  )
}

export default SearchBar
