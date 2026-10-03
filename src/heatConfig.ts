// Surface heat overlay settings. The browser colors the temperature data
// with these at load time, so changing them only needs a page reload — no
// pipeline rerun. The legend and inspect popup read them too.

// Pixels at or above this surface temperature are colored; below it the
// overlay is transparent (apart from the HOTSPOT_FEATHER_F soft edge). Chosen by how much of the map it colors —
// on the Sept 2026 DFW scene, 110°F colors ~80% of land and 120°F ~25%.
export const HOTSPOT_THRESHOLD_F = 120

// Degrees above the threshold at which the gradient reaches full red.
export const HOTSPOT_RANGE_F = 15

// Width of the soft edge, centered on the threshold: opacity eases from 0 at
// threshold - FEATHER/2 to full at threshold + FEATHER/2, so hotspots fade
// in instead of stepping on cell by cell.
export const HOTSPOT_FEATHER_F = 2

// Gaussian blur applied to temperatures before thresholding, for rounded
// blob shapes. On the Sept 2026 DFW scene at 120°F, 60m keeps 91% of the
// unsmoothed hot cells colored with no new color more than 3°F below the
// threshold; past ~120m, small real hotspots start fading out and merging.
// 0 turns smoothing off.
export const SMOOTHING_SIGMA_M = 60

// Gradient from the threshold (first stop) to threshold + range (last) —
// the warm half of the app's blue -> cream -> red diverging scale.
export const HOTSPOT_COLOR_STOPS = ['#EDE4CF', '#E2924D', '#A6281E']
