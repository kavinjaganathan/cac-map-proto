const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const MIN_REQUEST_INTERVAL_MS = 1000
const MAX_RESULTS = 5

// The Census Geocoder hard-rejects any address over 100 characters, but
// Nominatim's display_name is often longer (it strings together a POI
// name plus the full administrative hierarchy). Each suggestion carries
// its own censusAddress — a shorter "house number + street, city, state
// zip" built from Nominatim's structured fields — for the actual Census
// lookup, while label (the full display_name) is what's shown in the
// dropdown.
const CENSUS_MAX_ADDRESS_LENGTH = 100

export interface AddressSuggestion {
  id: string
  label: string
  censusAddress: string
}

export class NominatimRateLimitError extends Error {
  constructor() {
    super('Nominatim rate limit hit')
  }
}

interface NominatimAddress {
  house_number?: string
  road?: string
  city?: string
  town?: string
  village?: string
  county?: string
  state?: string
  postcode?: string
}

interface NominatimResult {
  place_id: number
  display_name: string
  address?: NominatimAddress
}

function toCensusAddress(result: NominatimResult): string {
  const address = result.address
  if (address) {
    const street = [address.house_number, address.road].filter(Boolean).join(' ')
    const locality = address.city ?? address.town ?? address.village ?? address.county
    const composed = [street, locality, address.state, address.postcode].filter(Boolean).join(', ')
    if (composed.length > 0) return composed.slice(0, CENSUS_MAX_ADDRESS_LENGTH)
  }
  return result.display_name.slice(0, CENSUS_MAX_ADDRESS_LENGTH)
}

let lastRequestAt = 0

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/**
 * Browsers refuse to let JS set a custom User-Agent on fetch() — it's a
 * forbidden header per the Fetch spec, silently dropped in favor of the
 * browser's real UA. Nominatim's usage policy accepts an HTTP Referer as
 * an alternative identifier, which the browser sends automatically on
 * this cross-origin request, so no header override is attempted here.
 */
export async function fetchAddressSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<AddressSuggestion[]> {
  const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt)
  if (wait > 0) await sleep(wait, signal)
  lastRequestAt = Date.now()

  const url = new URL(NOMINATIM_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('countrycodes', 'us')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', String(MAX_RESULTS))

  const res = await fetch(url.toString(), { signal })
  if (res.status === 429) throw new NominatimRateLimitError()
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`)

  const data: NominatimResult[] = await res.json()
  return data.map((result) => ({
    id: String(result.place_id),
    label: result.display_name,
    censusAddress: toCensusAddress(result),
  }))
}
