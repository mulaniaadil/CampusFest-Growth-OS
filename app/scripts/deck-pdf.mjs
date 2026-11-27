// Exports deck.html to a 3-page PDF with headless Chrome/Edge (vector output).
// Usage: npm run deck:pdf  (needs the dev server on :5173, or pass a URL as argv[2])
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:5173/deck.html'
const out = resolve(process.argv[3] ?? '../deliverables/CampusFest_Growth_Strategy_3_slides.pdf')
mkdirSync(resolve(out, '..'), { recursive: true })
const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean)
const bin = candidates.find((p) => existsSync(p))
if (!bin) { console.error('No Chrome/Edge found. Set CHROME_PATH, or open deck.html and use Print → Save as PDF.'); process.exit(1) }
execFileSync(bin, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=15000', `--print-to-pdf=${out}`, url], { stdio: 'inherit' })
console.log('Wrote', out)
