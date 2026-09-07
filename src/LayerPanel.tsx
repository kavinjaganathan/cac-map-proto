import { useEffect, useState, type RefObject } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { LAYER_OPTIONS } from './layers'
import {
  addSurfaceTemperatureLayer,
  removeSurfaceTemperatureLayer,
  type SurfaceTemperatureMetadata,
} from './surfaceTemperature'

const COLOR_BACKGROUND = '#EFE9DE'
const COLOR_BORDER = '#C9BEA9'
const COLOR_TEXT = '#2B2620'
const COLOR_ACCENT = '#B5804A'

// Must match COLOR_STOPS in scripts/fetch_landsat_lst.py.
const TEMPERATURE_GRADIENT = 'linear-gradient(to right, #2C6E9E, #8FB8D9, #EDE4CF, #E2924D, #A6281E)'

const SURFACE_TEMPERATURE_ID = 'surface-temperature'

function LayerPanel({ mapRef }: { mapRef: RefObject<MapLibreMap | null> }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [surfaceTempMeta, setSurfaceTempMeta] = useState<SurfaceTemperatureMetadata | null>(null)

  function toggle(id: string) {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (enabled[SURFACE_TEMPERATURE_ID]) {
      let cancelled = false
      addSurfaceTemperatureLayer(map).then((metadata) => {
        if (!cancelled) setSurfaceTempMeta(metadata)
      })
      return () => {
        cancelled = true
        removeSurfaceTemperatureLayer(map)
        setSurfaceTempMeta(null)
      }
    }
  }, [enabled[SURFACE_TEMPERATURE_ID], mapRef])

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        maxWidth: 260,
        fontFamily: "'Public Sans', system-ui, sans-serif",
        background: COLOR_BACKGROUND,
        border: `1px solid ${COLOR_BORDER}`,
        borderRadius: 6,
        padding: 8,
        boxShadow: `0 1px 2px ${COLOR_TEXT}1f`,
        color: COLOR_TEXT,
      }}
    >
      <style>{`
        .layer-panel-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 2px;
          cursor: pointer;
        }
        .layer-panel-row input {
          accent-color: ${COLOR_ACCENT};
        }
      `}</style>
      {LAYER_OPTIONS.map((layer) => (
        <div key={layer.id}>
          <label className="layer-panel-row">
            <input
              type="checkbox"
              checked={enabled[layer.id] ?? false}
              onChange={() => toggle(layer.id)}
            />
            {layer.label}
          </label>
          {layer.id === SURFACE_TEMPERATURE_ID && enabled[layer.id] && surfaceTempMeta && (
            <div style={{ padding: '4px 2px 8px' }}>
              <div style={{ height: 8, borderRadius: 4, background: TEMPERATURE_GRADIENT }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>{surfaceTempMeta.minF}°F</span>
                <span>{surfaceTempMeta.maxF}°F</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default LayerPanel
