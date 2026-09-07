import { useState } from 'react'
import { LAYER_OPTIONS } from './layers'

const COLOR_BACKGROUND = '#EFE9DE'
const COLOR_BORDER = '#C9BEA9'
const COLOR_TEXT = '#2B2620'
const COLOR_ACCENT = '#B5804A'

function LayerPanel() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})

  function toggle(id: string) {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
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
        <label key={layer.id} className="layer-panel-row">
          <input
            type="checkbox"
            checked={enabled[layer.id] ?? false}
            onChange={() => toggle(layer.id)}
          />
          {layer.label}
        </label>
      ))}
    </div>
  )
}

export default LayerPanel
