import { useEffect, useRef } from 'react'
import { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const USA_CENTER: [number, number] = [-98.35, 39.5]
const USA_ZOOM = 3.8

function Map() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE_URL,
      center: USA_CENTER,
      zoom: USA_ZOOM,
    })

    return () => map.remove()
  }, [])

  return <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
}

export default Map
