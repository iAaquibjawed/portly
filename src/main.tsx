import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Popover } from './Popover'
import './tokens.css'
import './app.css'

const container = document.getElementById('root')
if (!container) throw new Error('Portly: #root is missing from index.html')

// Light until the main process reports otherwise, so the first paint is not dark.
document.documentElement.dataset.theme = 'light'

createRoot(container).render(
  <StrictMode>
    <Popover />
  </StrictMode>,
)
