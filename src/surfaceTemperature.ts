import type { Map as MapLibreMap } from 'maplibre-gl'

const METADATA_URL = '/layers/surface-temperature.json'
const PNG_URL = '/layers/surface-temperature.png'
const SOURCE_ID = 'surface-temperature'
const LAYER_ID = 'surface-temperature'

export interface SurfaceTemperatureMetadata {
  west: number
  south: number
  east: number
  north: number
  minF: number
  maxF: number
  sceneDate: string
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
      paint: { 'raster-opacity': 0.75 },
    })
  }

  return metadata
}

export function removeSurfaceTemperatureLayer(map: MapLibreMap): void {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
}
