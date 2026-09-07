export interface LayerOption {
  id: string
  label: string
}

export const LAYER_OPTIONS: LayerOption[] = [
  { id: 'surface-temperature', label: 'Surface Temperature' },
  { id: 'land-cover', label: 'Land Cover' },
  { id: 'shade-debt', label: 'Shade Debt' },
  { id: 'canopy-projection', label: 'Canopy Projection' },
]
