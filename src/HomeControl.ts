import type { IControl, Map as MapLibreMap } from 'maplibre-gl'
import { USA_CENTER, USA_ZOOM } from './mapDefaults'

export class HomeControl implements IControl {
  private container: HTMLDivElement | undefined

  onAdd(map: MapLibreMap): HTMLElement {
    this.container = document.createElement('div')
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group'

    const button = document.createElement('button')
    button.type = 'button'
    button.title = 'Reset view'
    button.setAttribute('aria-label', 'Reset view')
    button.textContent = '⌂'
    button.onclick = () => map.flyTo({ center: USA_CENTER, zoom: USA_ZOOM })

    this.container.appendChild(button)
    return this.container
  }

  onRemove(): void {
    this.container?.remove()
    this.container = undefined
  }
}
