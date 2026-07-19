import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev-mode only: forward API calls to a locally running backend.
      '/api': 'http://localhost:8000',
    },
  },
})
