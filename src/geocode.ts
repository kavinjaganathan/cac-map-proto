export interface GeocodeResult {
  lon: number
  lat: number
  matchedAddress: string
}

interface CensusGeocodeResponse {
  result: {
    addressMatches: {
      // Census names these x/y, but x is longitude and y is latitude —
      // which happens to match maplibre's [lng, lat] order directly.
      coordinates: { x: number; y: number }
      matchedAddress: string
    }[]
  }
}

let callbackCounter = 0
const TIMEOUT_MS = 8000

export function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  return new Promise((resolve, reject) => {
    const win = window as unknown as Record<string, unknown>
    const callbackName = `__censusGeocodeCallback${callbackCounter++}`
    const script = document.createElement('script')
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      delete win[callbackName]
      script.remove()
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Geocoding request timed out'))
    }, TIMEOUT_MS)

    win[callbackName] = (data: CensusGeocodeResponse) => {
      if (settled) return
      settled = true
      cleanup()

      const match = data.result.addressMatches[0]
      if (!match) {
        resolve(null)
        return
      }
      resolve({
        lon: match.coordinates.x,
        lat: match.coordinates.y,
        matchedAddress: match.matchedAddress,
      })
    }

    script.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Failed to load geocoding script'))
    }

    const url = new URL(
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
    )
    url.searchParams.set('address', address)
    url.searchParams.set('benchmark', 'Public_AR_Current')
    url.searchParams.set('format', 'jsonp')
    url.searchParams.set('callback', callbackName)

    script.src = url.toString()
    document.head.appendChild(script)
  })
}
