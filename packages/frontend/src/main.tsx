import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import { migrateBrowserStorageToAsh } from './migrations/start-browser-storage-migration'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// This importer owns the only legacy-browser persistence access. Normal app
// paths use the ASH-backed client-state API exclusively.
void migrateBrowserStorageToAsh().catch((error) => {
  // A migration failure must neither abort React startup nor delete its source.
  // Keep a diagnostic breadcrumb for support without treating browser state as
  // canonical application persistence.
  console.warn('[ASH] browser storage migration will retry on next startup', error)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
