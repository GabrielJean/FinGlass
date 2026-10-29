import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

let version = '1.0.0'
const versionPath = path.resolve(__dirname, '../VERSION')
if (fs.existsSync(versionPath)) {
  version = fs.readFileSync(versionPath, 'utf-8').trim()
} else {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
    if (pkg.version) version = pkg.version
  } catch {}
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  plugins: [
    react(),
    {
      name: 'cleanup-html',
      closeBundle() {
        const htmlPath = path.resolve(__dirname, '../static/index.html')
        if (fs.existsSync(htmlPath)) {
          fs.unlinkSync(htmlPath)
        }
      }
    }
  ],
  build: {
    outDir: path.resolve(__dirname, '../static'),
    emptyOutDir: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]'
      }
    }
  }
})

