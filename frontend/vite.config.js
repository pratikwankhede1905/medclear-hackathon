import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  define: {
    global: 'window',
  },
  resolve: {
    alias: {
      './runtimeConfig': './runtimeConfig.browser',
    },
  },
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
