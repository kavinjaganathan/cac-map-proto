import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { geocodeAddress } from './geocode'
import { fetchAddressSuggestions, NominatimRateLimitError, type AddressSuggestion } from './nominatim'

const STREET_LEVEL_ZOOM = 16
const SUGGESTION_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 3

const COLOR_BACKGROUND = '#EFE9DE'
const COLOR_BORDER = '#C9BEA9'
const COLOR_TEXT = '#2B2620'
const COLOR_ACCENT = '#B5804A'
const COLOR_HOVER = '#E3DBCB'

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
    background: COLOR_BACKGROUND,
    border: `1px solid ${COLOR_BORDER}`,
    color: COLOR_TEXT,
    padding: 8,
    borderRadius: 6,
    boxShadow: `0 1px 2px ${COLOR_TEXT}1f`,
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        maxWidth: 320,
        fontFamily: "'Public Sans', system-ui, sans-serif",
      }}
    >
      <style>{`
        .search-bar-input {
          flex: 1;
          border: 1px solid ${COLOR_BORDER};
          border-radius: 4px;
          padding: 6px 8px;
          background: ${COLOR_BACKGROUND};
          color: ${COLOR_TEXT};
          outline: none;
          font-family: inherit;
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
          /* Public Sans is scoped to the input/dropdown only for now, so
             the button keeps the app's default font stack. */
          font-family: system-ui, sans-serif;
        }
        .search-bar-button:hover:not(:disabled) {
          background: ${COLOR_HOVER};
          border-color: ${COLOR_ACCENT};
        }
        .search-bar-button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .search-bar-suggestion {
          padding: 8px;
          cursor: pointer;
          border-bottom: 1px solid ${COLOR_BORDER};
        }
        .search-bar-suggestion:last-child {
          border-bottom: none;
        }
        .search-bar-suggestion:hover,
        .search-bar-suggestion.highlighted {
          background: ${COLOR_HOVER};
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
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setDropdownOpen(true)
          }}
          onBlur={() => setDropdownOpen(false)}
          placeholder="Enter a US address"
          autoComplete="off"
        />
        <button type="submit" className="search-bar-button" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {dropdownOpen && (
        <div style={{ marginTop: 8, borderRadius: 6, overflow: 'hidden', boxShadow: `0 1px 2px ${COLOR_TEXT}1f` }}>
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
                style={{ background: COLOR_BACKGROUND, color: COLOR_TEXT }}
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
