import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/store': {
        target: process.env.VITE_STORE_API_URL || 'http://store-api:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/store/, ''),
      },
      '/api/warehouse': {
        target: process.env.VITE_WAREHOUSE_API_URL || 'http://warehouse-alpha:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/warehouse/, ''),
      },
    },
  },
})
