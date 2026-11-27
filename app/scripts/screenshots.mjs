// Captures README screenshots of the running app through the Chrome DevTools Protocol
// (no extra dependencies: uses Node's built-in fetch + WebSocket). Needs the dev server on :5173.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5173/'
const outDir = resolve(process.env.SHOT_DIR ?? '../docs/screenshots')
mkdirSync(outDir, { recursive: true })
const bin = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].filter(Boolean).find((p) => existsSync(p))
const port = 9333
const chrome = spawn(bin, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cfgos-'))}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const shots = [
  ['overview', '#/overview', 1440],
  ['analytics', '#/analytics?tab=funnel', 1440],
  ['analytics-campaigns', '#/analytics?tab=campaigns', 1440],
  ['analytics-cohorts', '#/analytics?tab=cohorts', 1440],
  ['analytics-strategy', '#/analytics?tab=strategy', 1440],
  ['campaigns', '#/campaigns?c=C03', 1440],
  ['analyst', '#/analyst?q=Which%20campaign%20should%20receive%20more%20budget%3F', 1440],
  ['data', '#/data', 1440],
  ['overview-narrow', '#/overview', 900],
  ['analytics-narrow', '#/analytics?tab=campaigns', 900],
  ['campaigns-narrow', '#/campaigns?c=C03', 900],
  ['analyst-narrow', '#/analyst?q=Why%20are%20we%20missing%20our%20registration%20target%3F', 900],
]

const only = process.env.ONLY ? process.env.ONLY.split(',') : null
try {
  let target
  for (let i = 0; i < 40 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json() } catch { await sleep(250) } }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) } })
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  for (const [name, hash, width] of shots.filter((x) => !only || only.includes(x[0]))) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: base + hash })
    for (let i = 0; i < 40; i++) {
      const r = await send('Runtime.evaluate', { expression: "!!document.querySelector('main section') && !document.body.innerText.includes('Reading workbook')", returnByValue: true })
      if (r.result.value) break
      await sleep(250)
    }
    await sleep(1200)
    const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })
    const height = Math.min(result.value, 3200)
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(shot.data, 'base64'))
    console.log('saved', name, width, 'x', height)
  }
  ws.close()
} finally {
  chrome.kill()
}
