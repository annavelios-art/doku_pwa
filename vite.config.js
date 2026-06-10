import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Behandlungsdokumentation',
        short_name: 'Doku',
        display: 'standalone',
        theme_color: '#f5f6f8',
        background_color: '#f5f6f8',
        icons: [
          {
            src: '/logo_kl.gif',
            sizes: '192x192',
            type: 'image/gif'
          }
        ]
      }
    })
  ]
})