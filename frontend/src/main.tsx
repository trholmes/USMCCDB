import { MantineProvider, createTheme } from '@mantine/core'
import '@mantine/core/styles.css'
import { Notifications } from '@mantine/notifications'
import '@mantine/notifications/styles.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './auth/SessionContext'

// Primary blue matches the validated chart palette (slot 1, #2a78d6).
const theme = createTheme({
  primaryColor: 'blue',
  colors: {
    blue: [
      '#e8f1fb', '#cfe1f6', '#9cc2ec', '#67a2e2', '#3d88da',
      '#2a78d6', '#1f6cc9', '#155cb0', '#0d4f99', '#004283',
    ],
  },
  defaultRadius: 'md',
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="top-right" />
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </MantineProvider>
  </React.StrictMode>,
)
