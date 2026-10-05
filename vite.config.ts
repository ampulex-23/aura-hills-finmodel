import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  // GH Pages: /aura-hills-finmodel/; standalone-деплой на VDS: VITE_BASE=/
  base: process.env.VITE_BASE || '/aura-hills-finmodel/',
  server: {
    // dev-прокси на backend (node server/index.mjs, порт 8090)
    proxy: { '/api': 'http://127.0.0.1:8090' },
  },
  test: { environment: 'node' },
})
