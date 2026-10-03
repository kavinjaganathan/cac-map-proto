import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, NavigationControl, ScaleControl, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import SearchBar from './SearchBar'
import LayerPanel from './LayerPanel'
import { HomeControl } from './HomeControl'
import { USA_CENTER, USA_ZOOM } from './mapDefaults'

// Esri World Imagery — keyless raster tiles. Free with attribution for
// non-commercial/prototype use; a commercial launch needs an ArcGIS account.
const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      // Past this, many areas only have Esri's "Map data not yet available"
      // placeholder tiles — overzooming z19 looks better.
      maxzoom: 19,
      attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
}

function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  // Set once the style has loaded — layers can't be added before then, and
  // the default layer is on from first render.
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: USA_CENTER,
      zoom: USA_ZOOM,
    })
    map.addControl(new NavigationControl(), 'top-right')
    map.addControl(new HomeControl(), 'top-right')
    map.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-right')
    map.on('load', () => setLoadedMap(map))
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      setLoadedMap(null)
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <SearchBar mapRef={mapRef} />
      <LayerPanel map={loadedMap} />
    </div>
  )
}

export default Map
