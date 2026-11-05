import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/static/wms-light/',
  plugins: [react()],
  build: {
    outDir: '../static/wms-light',
    emptyOutDir: true,
  },
  server: {
    allowedHosts: true,
  },
  preview: {
    allowedHosts: true,
  },
})
