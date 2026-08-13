import type { PortlyApi } from '../shared/types'

declare global {
  interface Window {
    /** Injected by the Electron preload; absent when opened in a plain browser. */
    portly?: PortlyApi
  }
}
