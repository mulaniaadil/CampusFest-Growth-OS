// Vercel serverless function (Node.js runtime, Web Request/Response signature).
// GET  /api/analyst -> { enabled, model }   (lets the UI know whether Gemini narration is available)
// POST /api/analyst -> { text, model }      (narration grounded on locally computed data)
import { callGemini, geminiConfig } from './_gemini.js'

export function GET() {
  const { enabled, model } = geminiConfig()
  return Response.json({ enabled, model: enabled ? model : undefined })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const out = await callGemini(body)
    return Response.json(out.json, { status: out.status })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
