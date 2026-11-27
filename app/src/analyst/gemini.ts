// Optional Gemini (free tier) narration. The browser never sees the API key: it calls
// /api/analyst, a Vercel serverless function (or the Vite dev middleware) that holds
// GEMINI_API_KEY. If the endpoint is missing or unconfigured, the analyst runs locally.

export interface GeminiResult { text: string; unverified: string[]; model: string }

let status: Promise<{ enabled: boolean; model?: string }> | null = null
export function geminiStatus() {
  if (!status) {
    status = fetch('/api/analyst', { method: 'GET' })
      .then(async (r) => (r.ok ? ((await r.json()) as { enabled: boolean; model?: string }) : { enabled: false }))
      .catch(() => ({ enabled: false }))
  }
  return status
}

/** Every number in the narration must exist in the grounded data we sent. */
export function groundingCheck(text: string, grounded: string): string[] {
  const norm = (s: string) => s.replace(/[₹,\s]/g, '')
  const g = norm(grounded)
  const nums = text.match(/₹?\d[\d,]*(?:\.\d+)?%?/g) ?? []
  const out: string[] = []
  for (const n of nums) {
    const raw = norm(n).replace(/%$/, '')
    if (raw.length < 2) continue // ignore single digits like list markers
    const asPct = n.endsWith('%') ? String(Math.round(Number(raw) * 10) / 1000) : null
    const ok = g.includes(raw) || (asPct != null && (g.includes(asPct) || g.includes(String(Number(raw) / 100)))) || /^20\d\d$/.test(raw)
    if (!ok) out.push(n)
  }
  return [...new Set(out)]
}

export async function narrate(question: string, localAnswer: unknown, dataPack: unknown, history: { q: string; a: string }[]): Promise<GeminiResult> {
  const res = await fetch('/api/analyst', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, localAnswer, dataPack, history: history.slice(-4) }),
  })
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  const j = (await res.json()) as { text: string; model: string }
  return { text: j.text, model: j.model, unverified: groundingCheck(j.text, JSON.stringify({ localAnswer, dataPack })) }
}
