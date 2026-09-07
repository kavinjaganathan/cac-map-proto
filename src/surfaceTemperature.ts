import { Popup, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl'

const METADATA_URL = '/layers/surface-temperature.json'
const PNG_URL = '/layers/surface-temperature.png'
const DATA_PNG_URL = '/layers/surface-temperature-data.png'
const SOURCE_ID = 'surface-temperature'
const LAYER_ID = 'surface-temperature'

const COLOR_BACKGROUND = '#EFE9DE'
const COLOR_BORDER = '#C9BEA9'
const COLOR_TEXT = '#2B2620'

export interface SurfaceTemperatureMetadata {
  west: number
  south: number
  east: number
  north: number
  minF: number
  maxF: number
  sceneDate: string
  dataWidth: number
  dataHeight: number
  dataScaleMinF: number
  dataScaleMaxF: number
}

export interface TemperatureGrid {
  data: Uint8ClampedArray
  width: number
  height: number
  west: number
  south: number
  east: number
  north: number
  scaleMin: number
  scaleMax: number
}

export async function addSurfaceTemperatureLayer(
  map: MapLibreMap,
): Promise<SurfaceTemperatureMetadata> {
  const metadata: SurfaceTemperatureMetadata = await fetch(METADATA_URL).then((res) => res.json())
  const { west, south, east, north } = metadata

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'image',
      url: PNG_URL,
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    })
  }

  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({
      id: LAYER_ID,
      type: 'raster',
      source: SOURCE_ID,
      // Landsat pixels are ~30m — bilinear (the default) smooths that into
      // a hazy blur; nearest shows the true blocky resolution instead.
      paint: { 'raster-opacity': 0.5, 'raster-resampling': 'nearest' },
    })
  }

  return metadata
}

export function removeSurfaceTemperatureLayer(map: MapLibreMap): void {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load ${url}`))
    img.src = url
  })
}

/**
 * Loads the data PNG (real Fahrenheit values packed into R+G, not colors —
 * see fetch_landsat_lst.py) and decodes it via an offscreen canvas into a
 * plain pixel array the click handler can index into directly.
 */
export async function loadTemperatureGrid(
  metadata: SurfaceTemperatureMetadata,
): Promise<TemperatureGrid> {
  const img = await loadImageElement(DATA_PNG_URL)
  const canvas = document.createElement('canvas')
  canvas.width = metadata.dataWidth
  canvas.height = metadata.dataHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0)

  return {
    data: ctx.getImageData(0, 0, metadata.dataWidth, metadata.dataHeight).data,
    width: metadata.dataWidth,
    height: metadata.dataHeight,
    west: metadata.west,
    south: metadata.south,
    east: metadata.east,
    north: metadata.north,
    scaleMin: metadata.dataScaleMinF,
    scaleMax: metadata.dataScaleMaxF,
  }
}

/**
 * Returns the Fahrenheit reading nearest the given point, or null if the
 * point is outside the data extent or falls on a no-data pixel (true
 * nodata, or cloud/shadow/cirrus — those are filled with an interpolated
 * value for the color display, but that's not a real measurement).
 */
export function readTemperatureAt(grid: TemperatureGrid, lng: number, lat: number): number | null {
  if (lng < grid.west || lng > grid.east || lat < grid.south || lat > grid.north) return null

  const col = Math.min(
    Math.floor(((lng - grid.west) / (grid.east - grid.west)) * grid.width),
    grid.width - 1,
  )
  const row = Math.min(
    Math.floor(((grid.north - lat) / (grid.north - grid.south)) * grid.height),
    grid.height - 1,
  )

  const idx = (row * grid.width + col) * 4
  if (grid.data[idx + 3] === 0) return null

  const value16 = (grid.data[idx] << 8) | grid.data[idx + 1]
  const fahrenheit = (value16 / 65535) * (grid.scaleMax - grid.scaleMin) + grid.scaleMin
  return Math.round(fahrenheit * 10) / 10
}

let popupStyleInjected = false
function ensurePopupStyleInjected() {
  if (popupStyleInjected) return
  popupStyleInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .surface-temp-popup .maplibregl-popup-content {
      background: ${COLOR_BACKGROUND};
      border: 1px solid ${COLOR_BORDER};
      border-radius: 6px;
      padding: 8px 10px;
      font-family: 'Public Sans', system-ui, sans-serif;
      box-shadow: 0 1px 2px ${COLOR_TEXT}1f;
    }
    .surface-temp-popup .maplibregl-popup-tip {
      border-top-color: ${COLOR_BACKGROUND};
      border-bottom-color: ${COLOR_BACKGROUND};
    }
  `
  document.head.appendChild(style)
}

function buildPopupContent(value: number | null, lng: number, lat: number): HTMLElement {
  const container = document.createElement('div')
  container.style.color = COLOR_TEXT

  const primary = document.createElement('div')
  primary.style.fontWeight = '600'
  primary.style.fontSize = '14px'
  primary.textContent = value === null ? 'No data at this location' : `${value.toFixed(1)}°F`
  container.appendChild(primary)

  const coords = document.createElement('div')
  coords.style.fontSize = '12px'
  coords.style.opacity = '0.75'
  coords.style.marginTop = '2px'
  coords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  container.appendChild(coords)

  return container
}

/**
 * Wires a click-to-inspect popup for as long as the Surface Temperature
 * layer is on. Returns a cleanup function that removes the listener and
 * any open popup — call it when the layer is toggled off.
 */
export function enableTemperatureInspect(map: MapLibreMap, grid: TemperatureGrid): () => void {
  ensurePopupStyleInjected()
  let popup: Popup | null = null

  function handleClick(event: MapMouseEvent) {
    popup?.remove()
    const value = readTemperatureAt(grid, event.lngLat.lng, event.lngLat.lat)
    popup = new Popup({ className: 'surface-temp-popup', closeButton: true, closeOnClick: true })
      .setLngLat(event.lngLat)
      .setDOMContent(buildPopupContent(value, event.lngLat.lng, event.lngLat.lat))
      .addTo(map)
  }

  map.on('click', handleClick)

  return () => {
    map.off('click', handleClick)
    popup?.remove()
  }
}
