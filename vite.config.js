import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy':  'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    rollupOptions: {
      // These are served from public/ffmpeg/ at runtime — not npm modules.
      // Tell Rollup to leave the dynamic import() calls alone.
      external: [
        '/ffmpeg/ffmpeg-esm.js',
        '/ffmpeg/util-esm.js',
      ],
    },
  },
})
