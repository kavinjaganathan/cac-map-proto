export interface LayerOption {
  id: string
  label: string
  available: boolean
}

// Mutually exclusive data layers, shown as tabs — exactly one is on the map
// at a time.
export const LAYER_OPTIONS: LayerOption[] = [
  { id: 'surface-temperature', label: 'Surface heat', available: true },
  { id: 'projected-cooling', label: 'Projected cooling', available: false },
  { id: 'rgb', label: 'RGB', available: false },
]
