import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/parlens/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Parlens',
        short_name: 'Parlens',
        description: 'Nostr-powered parking session tracker and spot broadcaster',
        theme_color: '#005A8C',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      // Workbox config - Balanced for Offline + Freshness
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            // Nominatim API - CacheFirst allowed now (improves speed)
            // We have local DB for our own data, so standard API caching is fine
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*$/,
            handler: 'CacheFirst', // Changed from NetworkFirst
            options: {
              cacheName: 'nominatim-api',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
                maxEntries: 100
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Map tiles - Long Cache
            // Fixed regex to include openfreemap.org which was previously missed
            urlPattern: /^https:\/\/.*\.(openstreetmap|tile|openfreemap)\.org\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                // Increased to 5000 to satisfy user request for "larger portion of map cached"
                maxEntries: 5000
              },
              // Ensure we cache opaque responses (CORS) if needed, though they usually support CORS
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
})
