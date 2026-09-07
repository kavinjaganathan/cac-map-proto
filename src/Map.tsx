import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import SearchBar from './SearchBar'
import { applyPalette } from './mapPalette'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const USA_CENTER: [number, number] = [-98.35, 39.5]
const USA_ZOOM = 3.8

function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    fetch(STYLE_URL)
      .then((res) => res.json())
      .then((style: StyleSpecification) => {
        if (cancelled || !containerRef.current) return

        const map = new MapLibreMap({
          container: containerRef.current,
          style: applyPalette(style),
          center: USA_CENTER,
          zoom: USA_ZOOM,
        })
        mapRef.current = map
      })

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <SearchBar mapRef={mapRef} />
    </div>
  )
}

export default Map
