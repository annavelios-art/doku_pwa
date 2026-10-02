import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './V2Test.css'
import V2Test from './V2Test.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <V2Test />
  </StrictMode>,
)
