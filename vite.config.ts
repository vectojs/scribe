import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    port: 3517,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Scribe',
        short_name: 'Scribe',
        description: 'VectoJS Markdown Editor',
        theme_color: '#2b2b2b',
        background_color: '#fdfbf7',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        globIgnores: [
          '**/assets/*mermaid*',
          '**/assets/*flow*',
          '**/assets/*sequence*',
          '**/assets/*gantt*',
          '**/assets/*c4*',
          '**/assets/*cytoscape*',
          '**/assets/*Diagram*',
          '**/assets/*diagram*',
          '**/assets/*cose*',
          '**/assets/*dagre*',
          '**/assets/*treemap*',
          '**/assets/*katex*',
          '**/assets/chunk-*',
          '**/assets/arc*',
          '**/assets/graph*',
          '**/assets/layout*',
          '**/assets/*kanban*',
          '**/assets/*mindmap*',
          '**/assets/*journey*',
          '**/assets/*pie*',
          '**/assets/*quadrant*',
          '**/assets/*requirement*',
          '**/assets/*sankey*',
          '**/assets/*state*',
          '**/assets/*timeline*',
          '**/assets/*xychart*',
          '**/assets/*architecture*',
          '**/assets/*block*',
          '**/assets/*class*',
          '**/assets/*erDiagram*',
          '**/assets/*gitGraph*',
          '**/assets/*info*',
          '**/assets/*ordinal*',
          '**/assets/*linear*',
          '**/assets/*defaultLocale*',
          '**/assets/*channel*',
          '**/assets/*clone*',
          '**/assets/*min*',
          '**/assets/*init*',
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.vectojs\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-vectojs-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern:
              /\/assets\/.*(mermaid|flow|sequence|gantt|c4|Diagram|diagram|cytoscape|cose|dagre|treemap|katex|chunk|graph|arc)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mermaid-assets',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
});
