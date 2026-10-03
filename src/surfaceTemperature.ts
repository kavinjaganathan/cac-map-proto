import { Popup, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl'
import {
  HOTSPOT_COLOR_STOPS,
  HOTSPOT_FEATHER_F,
  HOTSPOT_RANGE_F,
  HOTSPOT_THRESHOLD_F,
  SMOOTHING_SIGMA_M,
} from './heatConfig'

const METADATA_URL = `${import.meta.env.BASE_URL}layers/surface-temperature.json`
const DATA_PNG_URL = `${import.meta.env.BASE_URL}layers/surface-temperature-data.png`
const SOURCE_ID = 'surface-temperature'
const LAYER_ID = 'surface-temperature'

const COLOR_BACKGROUND = '#EFE9DE'
const COLOR_BORDER = '#C9BEA9'
const COLOR_TEXT = '#2B2620'

// Length of one degree of latitude — close enough anywhere in Texas to turn
// SMOOTHING_SIGMA_M into grid cells.
const METERS_PER_DEGREE_LAT = 111_000

export interface SurfaceTemperatureMetadata {
  west: number
  south: number
  east: number
  north: number
  sceneDate: string
  dataWidth: number
  dataHeight: number
  dataScaleMinF: number
  dataScaleMaxF: number
}

export interface TemperatureGrid {
  /** Smoothed Fahrenheit, row-major; NaN marks no-data. */
  values: Float32Array
  width: number
  height: number
  west: number
  south: number
  east: number
  north: number
}

export interface SurfaceTemperatureData {
  metadata: SurfaceTemperatureMetadata
  grid: TemperatureGrid
  /** Object URL of the colored overlay — revoked when the layer is removed. */
  overlayUrl: string
}

/**
 * Fetches the temperature data and colors it into the overlay image. Kept
 * separate from adding the layer so a caller that's been cancelled while
 * this was loading can skip adding it.
 */
export async function loadSurfaceTemperature(): Promise<SurfaceTemperatureData> {
  const metadata: SurfaceTemperatureMetadata = await fetch(METADATA_URL).then((res) => res.json())
  const grid = await loadTemperatureGrid(metadata)
  const overlayUrl = await buildOverlayUrl(grid)
  return { metadata, grid, overlayUrl }
}

export function addSurfaceTemperatureLayer(map: MapLibreMap, data: SurfaceTemperatureData): void {
  const { west, south, east, north } = data.metadata

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'image',
      url: data.overlayUrl,
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
      // Linear, not nearest: the temperatures are deliberately smoothed into
      // rounded blobs, so blending between cells finishes the job rather
      // than blurring away real resolution. Below-threshold pixels are
      // already transparent, so opacity only sets how strongly hot areas
      // cover the imagery beneath.
      paint: { 'raster-opacity': 0.8, 'raster-resampling': 'linear' },
    })
  }
}

export function removeSurfaceTemperatureLayer(map: MapLibreMap, data: SurfaceTemperatureData): void {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
  URL.revokeObjectURL(data.overlayUrl)
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** 256-entry RGB lookup table, linearly interpolated across the stops. */
function buildColorRamp(stops: string[]): Uint8Array {
  const rgb = stops.map(hexToRgb)
  const ramp = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * (rgb.length - 1)
    const lo = Math.min(Math.floor(pos), rgb.length - 2)
    const t = pos - lo
    for (let c = 0; c < 3; c++) {
      ramp[i * 3 + c] = Math.round(rgb[lo][c] + (rgb[lo + 1][c] - rgb[lo][c]) * t)
    }
  }
  return ramp
}

/** Hermite smoothstep — eases the feathered edge in and out. */
function smoothstep(x: number): number {
  const t = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * Colors pixels along the gradient from HOTSPOT_THRESHOLD_F (full red at
 * threshold + HOTSPOT_RANGE_F). Opacity feathers across a HOTSPOT_FEATHER_F
 * band centered on the threshold, so the half-transparent edge sits right
 * on the threshold contour; cooler pixels and no-data are fully transparent.
 */
async function buildOverlayUrl(grid: TemperatureGrid): Promise<string> {
  const ramp = buildColorRamp(HOTSPOT_COLOR_STOPS)
  const out = new ImageData(grid.width, grid.height)
  const featherStart = HOTSPOT_THRESHOLD_F - HOTSPOT_FEATHER_F / 2

  for (let i = 0; i < grid.values.length; i++) {
    const fahrenheit = grid.values[i]
    const alpha = Number.isNaN(fahrenheit) ? 0 : smoothstep((fahrenheit - featherStart) / HOTSPOT_FEATHER_F)

    // Transparent pixels still get the ramp's first color: linear
    // resampling blends RGB with neighbors, and black there would leave
    // dark fringes around every hotspot.
    const t = alpha === 0 ? 0 : Math.min(Math.max((fahrenheit - HOTSPOT_THRESHOLD_F) / HOTSPOT_RANGE_F, 0), 1)
    const r = Math.round(t * 255) * 3
    const idx = i * 4
    out.data[idx] = ramp[r]
    out.data[idx + 1] = ramp[r + 1]
    out.data[idx + 2] = ramp[r + 2]
    out.data[idx + 3] = Math.round(alpha * 255)
  }

  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.putImageData(out, 0, 0)

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Overlay encoding failed'))), 'image/png'),
  )
  return URL.createObjectURL(blob)
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
 * see fetch_landsat_lst.py), decodes it via an offscreen canvas, and
 * smooths it — the grid the overlay colors and the click handler reads.
 */
async function loadTemperatureGrid(
  metadata: SurfaceTemperatureMetadata,
): Promise<TemperatureGrid> {
  const { dataWidth: width, dataHeight: height } = metadata
  const img = await loadImageElement(DATA_PNG_URL)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height).data

  const scale = metadata.dataScaleMaxF - metadata.dataScaleMinF
  const raw = new Float32Array(width * height)
  for (let i = 0; i < raw.length; i++) {
    const idx = i * 4
    raw[i] =
      pixels[idx + 3] === 0
        ? NaN
        : (((pixels[idx] << 8) | pixels[idx + 1]) / 65535) * scale + metadata.dataScaleMinF
  }

  const cellSizeM = ((metadata.north - metadata.south) * METERS_PER_DEGREE_LAT) / height
  return {
    values: gaussianSmooth(raw, width, height, SMOOTHING_SIGMA_M / cellSizeM),
    width,
    height,
    west: metadata.west,
    south: metadata.south,
    east: metadata.east,
    north: metadata.north,
  }
}

/**
 * Separable Gaussian blur that skips no-data (NaN) cells: values and a
 * validity mask are blurred separately and divided (normalized
 * convolution), so data edges aren't dragged toward zero. No-data cells
 * stay NaN.
 */
function gaussianSmooth(values: Float32Array, width: number, height: number, sigmaCells: number): Float32Array {
  if (sigmaCells <= 0) return values

  const radius = Math.ceil(sigmaCells * 3)
  const kernel = new Float32Array(radius * 2 + 1)
  for (let k = -radius; k <= radius; k++) kernel[k + radius] = Math.exp(-(k * k) / (2 * sigmaCells * sigmaCells))

  const sum = new Float32Array(values.length)
  const weight = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i])) {
      sum[i] = values[i]
      weight[i] = 1
    }
  }

  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let acc = 0
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? x + k : x
          const sy = horizontal ? y : y + k
          if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue
          acc += src[sy * width + sx] * kernel[k + radius]
        }
        dst[y * width + x] = acc
      }
    }
  }

  const tmp = new Float32Array(values.length)
  pass(sum, tmp, true)
  pass(tmp, sum, false)
  pass(weight, tmp, true)
  pass(tmp, weight, false)

  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    out[i] = Number.isNaN(values[i]) ? NaN : sum[i] / weight[i]
  }
  return out
}

/**
 * Returns the smoothed Fahrenheit reading nearest the given point — the
 * same value the overlay colored there — or null if the point is outside
 * the data extent or falls on a no-data pixel (true nodata, or
 * cloud/shadow/cirrus — not real measurements).
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

  const fahrenheit = grid.values[row * grid.width + col]
  return Number.isNaN(fahrenheit) ? null : Math.round(fahrenheit * 10) / 10
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

  if (value !== null) {
    const relative = document.createElement('div')
    relative.style.fontSize = '13px'
    relative.style.marginTop = '2px'
    relative.textContent =
      value >= HOTSPOT_THRESHOLD_F
        ? `${(value - HOTSPOT_THRESHOLD_F).toFixed(1)}°F above ${HOTSPOT_THRESHOLD_F}°F`
        : `Below ${HOTSPOT_THRESHOLD_F}°F`
    container.appendChild(relative)
  }

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
