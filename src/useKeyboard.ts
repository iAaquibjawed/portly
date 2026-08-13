import { useEffect, useRef } from 'react'

export interface KeyboardHandlers {
  focusSearch(): void
  move(delta: 1 | -1): void
  openFocused(): void
  killFocused(): void
  escape(): void
  isSearchFocused(): boolean
}

/**
 * Keyboard model from the spec:
 *   ⌘K  focus search from anywhere
 *   ↑↓  move the highlight, wrapping at both ends
 *   ⏎   open the highlighted row
 *   ⌫   start kill-confirm, again to confirm (ignored while typing in search)
 *   Esc cancel confirm, then clear search, then dismiss
 */
export function useKeyboard(handlers: KeyboardHandlers) {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const h = ref.current

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        h.focusSearch()
        return
      }

      // Any other modifier chord belongs to the system, not to us.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          h.move(1)
          break
        case 'ArrowUp':
          event.preventDefault()
          h.move(-1)
          break
        case 'Enter':
          event.preventDefault()
          h.openFocused()
          break
        case 'Backspace':
        case 'Delete':
          // Deleting text wins while the field has focus.
          if (h.isSearchFocused()) return
          event.preventDefault()
          h.killFocused()
          break
        case 'Escape':
          event.preventDefault()
          h.escape()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
