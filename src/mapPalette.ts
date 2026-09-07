import type { StyleSpecification } from 'maplibre-gl'

export const COLOR_LAND = '#d8caa9'
export const COLOR_BUILDINGS = '#d0ba98'
export const COLOR_WATER = '#aeb2a6'
export const COLOR_ROADS = '#b8b6b0'
export const COLOR_LABELS = '#8d8079'

// Land/background fills also absorb landcover/landuse sub-fills with no
// dedicated slot in the 5-color scheme — they're already near-identical
// to the background in stock positron, so folding them in preserves that
// subtlety instead of inventing new tones.
const LAND_FILL_LAYERS = [
  'background',
  'park',
  'landcover_ice_shelf',
  'landcover_glacier',
  'landuse_residential',
  'landcover_wood',
  'road_area_pier',
  'road_pier',
  'aeroway-area',
]

const WATER_LAYERS = ['water', 'waterway']

const ROAD_LAYERS = [
  'tunnel_motorway_casing',
  'highway_path',
  'highway_minor',
  'highway_major_casing',
  'highway_major_subtle',
  'highway_motorway_casing',
  'highway_motorway_subtle',
  'highway_motorway_bridge_casing',
  'aeroway-taxiway',
  'aeroway-runway-casing',
  'railway_transit',
  'railway_service',
  'railway',
  'boundary_3',
  'boundary_2',
  'boundary_disputed',
]

// Casing+inner road pairs use a darker casing with a lighter inner line so
// major roads visibly "glow" over minor ones. Recoloring both to the same
// roads grey would erase that hierarchy, so the inner highlight instead
// gets the land tone to preserve the two-tone effect.
const ROAD_INNER_HIGHLIGHT_LAYERS = [
  'tunnel_motorway_inner',
  'highway_major_inner',
  'highway_motorway_inner',
  'highway_motorway_bridge_inner',
  'aeroway-runway',
]

// Rail "tie" dash overlays are a lighter dash on top of the rail line
// itself, for the same reason as above.
const RAIL_DASH_LAYERS = [
  'railway_transit_dashline',
  'railway_service_dashline',
  'railway_dashline',
]

const LABEL_TEXT_LAYERS = [
  'waterway_line_label',
  'water_name_point_label',
  'water_name_line_label',
  'highway-name-path',
  'highway-name-minor',
  'highway-name-major',
  'airport',
  'label_other',
  'label_village',
  'label_town',
  'label_state',
  'label_city',
  'label_city_capital',
  'label_country_3',
  'label_country_2',
  'label_country_1',
]

function withOpacity(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Recolors a style's layers in place per the warm-neutral palette above,
 * preserving each layer's original paint-property alpha where it had one.
 */
export function applyPalette(style: StyleSpecification): StyleSpecification {
  const patched = structuredClone(style)

  for (const layer of patched.layers) {
    if (!('paint' in layer) || !layer.paint) continue
    const paint = layer.paint as Record<string, unknown>

    if (LAND_FILL_LAYERS.includes(layer.id)) {
      if ('background-color' in paint) paint['background-color'] = COLOR_LAND
      if ('fill-color' in paint) paint['fill-color'] = COLOR_LAND
      if ('line-color' in paint) paint['line-color'] = COLOR_LAND
    }

    if (layer.id === 'building') {
      if ('fill-color' in paint) paint['fill-color'] = COLOR_BUILDINGS
      if ('fill-outline-color' in paint) paint['fill-outline-color'] = COLOR_ROADS
    }

    if (WATER_LAYERS.includes(layer.id)) {
      if ('fill-color' in paint) paint['fill-color'] = COLOR_WATER
      if ('line-color' in paint) paint['line-color'] = COLOR_WATER
    }

    if (ROAD_LAYERS.includes(layer.id)) {
      if ('line-color' in paint) {
        const original = paint['line-color']
        paint['line-color'] =
          typeof original === 'string' && original.includes('0.69')
            ? withOpacity(COLOR_ROADS, 0.69)
            : typeof original === 'string' && original.includes('0.53')
              ? withOpacity(COLOR_ROADS, 0.53)
              : COLOR_ROADS
      }
    }

    if (ROAD_INNER_HIGHLIGHT_LAYERS.includes(layer.id) || RAIL_DASH_LAYERS.includes(layer.id)) {
      if ('line-color' in paint) paint['line-color'] = COLOR_LAND
    }

    if (LABEL_TEXT_LAYERS.includes(layer.id)) {
      if ('text-color' in paint) paint['text-color'] = COLOR_LABELS
      if ('text-halo-color' in paint) {
        const original = paint['text-halo-color']
        const alphaMatch = typeof original === 'string' ? original.match(/[\d.]+\)$/) : null
        paint['text-halo-color'] = alphaMatch
          ? withOpacity(COLOR_LAND, parseFloat(alphaMatch[0]))
          : COLOR_LAND
      }
    }
  }

  return patched
}
