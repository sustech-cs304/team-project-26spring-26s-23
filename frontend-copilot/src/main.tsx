import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { CopilotAppRoot } from './CopilotAppRoot.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CopilotAppRoot />
  </StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
