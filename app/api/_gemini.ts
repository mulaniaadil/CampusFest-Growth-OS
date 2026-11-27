// Server-side Gemini call (free-tier key from Google AI Studio). Shared by the Vercel
// function (api/analyst.ts) and the Vite dev middleware (vite.config.ts).
// The model only REWRITES numbers the local analytics engine already computed.

const SYSTEM = `You are the Growth Analyst inside "CampusFest Growth OS", an attendee-acquisition product.
Rules:
- Use ONLY numbers that appear in LOCAL_ANSWER or DATA_PACK. Never compute new figures, never estimate, never round differently.
- If the question cannot be answered from that data, say exactly what is missing (DATA_PACK.not_in_data lists known gaps).
- Separate "Observed" (from the workbook) from "Hypothesis" (model/assumption) explicitly.
- Name the metric and the date (DATA_PACK.as_of) you are using.
- Max 140 words, plain text, short paragraphs or "- " bullets. No markdown headings, no tables.
- Recommend at most two concrete next actions. Do not claim anything was sent, launched or changed.`

export function geminiConfig() {
  const key = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  return { enabled: Boolean(key), key, model }
}

export async function callGemini(body: { question?: string; localAnswer?: unknown; dataPack?: unknown; history?: { q: string; a: string }[] }) {
  const { key, model, enabled } = geminiConfig()
  if (!enabled) return { status: 503, json: { error: 'GEMINI_API_KEY is not configured on the server.' } }
  const q = String(body.question ?? '').slice(0, 600)
  if (!q) return { status: 400, json: { error: 'question is required' } }
  const prompt = [
    `QUESTION: ${q}`,
    `CONVERSATION (most recent last): ${JSON.stringify(body.history ?? []).slice(0, 2000)}`,
    `LOCAL_ANSWER (computed by the analytics engine — authoritative): ${JSON.stringify(body.localAnswer ?? {}).slice(0, 12000)}`,
    `DATA_PACK: ${JSON.stringify(body.dataPack ?? {}).slice(0, 12000)}`,
  ].join('\n\n')
  // Retry temporary overload / rate-limit responses (free tier spikes) with a short backoff.
  let r: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 1500 * attempt))
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    }),
  })
    if (r.status !== 503 && r.status !== 429) break
  }
  if (!r) return { status: 502, json: { error: 'Gemini request was not sent.' } }
  if (!r.ok) {
    const t = await r.text()
    return { status: 502, json: { error: `Gemini API ${r.status}: ${t.slice(0, 200)}` } }
  }
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? ''
  if (!text) return { status: 502, json: { error: 'Gemini returned no text.' } }
  return { status: 200, json: { text, model } }
}
