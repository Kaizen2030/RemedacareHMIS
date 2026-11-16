import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
// Installs the cross-tab relay for hospital events (lab → cashier queue etc.) before any screen loads.
import './utils/workflowEvents'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
