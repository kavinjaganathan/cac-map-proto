import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { LAYER_OPTIONS } from './layers'
import { HOTSPOT_COLOR_STOPS, HOTSPOT_RANGE_F, HOTSPOT_THRESHOLD_F } from './heatConfig'
import {
  addSurfaceTemperatureLayer,
  removeSurfaceTemperatureLayer,
  loadSurfaceTemperature,
  enableTemperatureInspect,
  type SurfaceTemperatureData,
} from './surfaceTemperature'

const COLOR_SURFACE = '#FFFFFF'
const COLOR_DIVIDER = '#E4DED3'
const COLOR_TEXT = '#2B2620'
const COLOR_TEXT_MUTED = '#6F665A'
const COLOR_TEXT_DISABLED = '#B3AA9C'
const SHADOW = `0 2px 8px ${COLOR_TEXT}26`

const HOTSPOT_GRADIENT = `linear-gradient(to right, ${HOTSPOT_COLOR_STOPS.join(', ')})`

const SURFACE_TEMPERATURE_ID = 'surface-temperature'

function LayerPanel({ map }: { map: MapLibreMap | null }) {
  const [activeLayer, setActiveLayer] = useState(SURFACE_TEMPERATURE_ID)
  const [surfaceTempLoaded, setSurfaceTempLoaded] = useState(false)

  useEffect(() => {
    if (!map) return

    if (activeLayer === SURFACE_TEMPERATURE_ID) {
      let cancelled = false
      let loaded: SurfaceTemperatureData | null = null
      let disableInspect: (() => void) | null = null

      loadSurfaceTemperature().then((data) => {
        if (cancelled) {
          URL.revokeObjectURL(data.overlayUrl)
          return
        }
        loaded = data
        addSurfaceTemperatureLayer(map, data)
        disableInspect = enableTemperatureInspect(map, data.grid)
        setSurfaceTempLoaded(true)
      })

      return () => {
        cancelled = true
        disableInspect?.()
        if (loaded) removeSurfaceTemperatureLayer(map, loaded)
        setSurfaceTempLoaded(false)
      }
    }
  }, [activeLayer, map])

  return (
    <>
      <style>{`
        .layer-tabs {
          position: absolute;
          top: 16px;
          right: 16px;
          display: flex;
          padding: 4px;
          background: ${COLOR_SURFACE};
          border-radius: 10px;
          box-shadow: ${SHADOW};
          font-family: 'Public Sans', system-ui, sans-serif;
        }
        .layer-tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 40px;
          padding: 0 16px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: ${COLOR_TEXT_MUTED};
          font: inherit;
          font-size: 14px;
          white-space: nowrap;
          cursor: pointer;
        }
        .layer-tab + .layer-tab {
          box-shadow: inset 1px 0 0 ${COLOR_DIVIDER};
        }
        .layer-tab.selected,
        .layer-tab.selected + .layer-tab {
          box-shadow: none;
        }
        .layer-tab:hover:not(.selected):not([aria-disabled='true']) {
          color: ${COLOR_TEXT};
        }
        .layer-tab.selected {
          background: ${COLOR_TEXT};
          color: ${COLOR_SURFACE};
          font-weight: 600;
        }
        .layer-tab[aria-disabled='true'] {
          color: ${COLOR_TEXT_DISABLED};
          cursor: not-allowed;
        }
        .layer-tab-unavailable {
          font-size: 10px;
          line-height: 1.2;
        }
        .layer-legend {
          position: absolute;
          bottom: 16px;
          left: 16px;
          width: 220px;
          padding: 12px 14px;
          background: ${COLOR_SURFACE};
          border-radius: 10px;
          box-shadow: ${SHADOW};
          color: ${COLOR_TEXT};
          font-family: 'Public Sans', system-ui, sans-serif;
        }
        /* Below this width the tabs would collide with the search bar, so
           they drop beneath it. Keep in sync with the control offset in
           index.css. */
        @media (max-width: 760px) {
          .layer-tabs {
            top: 72px;
            left: 16px;
            right: auto;
          }
          /* MapLibre's attribution spans the bottom edge at this width. */
          .layer-legend {
            bottom: 56px;
          }
        }
      `}</style>

      <div className="layer-tabs" role="tablist" aria-label="Map layer">
        {LAYER_OPTIONS.map((layer) => {
          const selected = activeLayer === layer.id
          return (
            <button
              key={layer.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-disabled={!layer.available}
              className={`layer-tab${selected ? ' selected' : ''}`}
              onClick={() => {
                if (layer.available) setActiveLayer(layer.id)
              }}
            >
              {layer.label}
              {!layer.available && <span className="layer-tab-unavailable">Not yet available</span>}
            </button>
          )
        })}
      </div>

      {activeLayer === SURFACE_TEMPERATURE_ID && surfaceTempLoaded && (
        <div className="layer-legend">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Surface temperature above {HOTSPOT_THRESHOLD_F}°F</div>
          <div style={{ height: 10, borderRadius: 5, background: HOTSPOT_GRADIENT }} />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 4,
              fontSize: 12,
              color: COLOR_TEXT_MUTED,
            }}
          >
            <span>{HOTSPOT_THRESHOLD_F}°F</span>
            <span>{HOTSPOT_THRESHOLD_F + HOTSPOT_RANGE_F}°F+</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4, color: COLOR_TEXT_MUTED }}>
            Colored areas are at or above {HOTSPOT_THRESHOLD_F}°F; redder is hotter. Uncolored areas are below{' '}
            {HOTSPOT_THRESHOLD_F}°F.
          </div>
        </div>
      )}
    </>
  )
}

export default LayerPanel
