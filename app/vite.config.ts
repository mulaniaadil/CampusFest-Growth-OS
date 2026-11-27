import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { resolve } from 'node:path'
import { callGemini, geminiConfig } from './api/_gemini.ts'

// Dev-only mirror of the Vercel function at /api/analyst, so Gemini narration can be
// tested locally with GEMINI_API_KEY in app/.env.local (never exposed to the browser).
function analystApi(): Plugin {
  return {
    name: 'analyst-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/analyst', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method === 'GET') {
          const { enabled, model } = geminiConfig()
          res.end(JSON.stringify({ enabled, model: enabled ? model : undefined }))
          return
        }
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', async () => {
          try {
            const out = await callGemini(JSON.parse(raw || '{}'))
            res.statusCode = out.status
            res.end(JSON.stringify(out.json))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: (e as Error).message }))
          }
        })
      })
    },
  }
}

// Two entry points: the product (index.html) and the 3-slide strategy deck (deck.html).
// Both import the same analytics modules so every number is computed once, the same way.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const k of ['GEMINI_API_KEY', 'GEMINI_MODEL']) if (env[k] && !process.env[k]) process.env[k] = env[k]
  return {
    plugins: [react(), tailwindcss(), analystApi()],
    base: './',
    build: {
      chunkSizeWarningLimit: 2000,
      rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), deck: resolve(import.meta.dirname, 'deck.html') } },
    },
  }
})
