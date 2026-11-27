// Optional Supabase (free tier) persistence for the workspace.
// Enabled only when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time.
// Table schema: see supabase/schema.sql in the repository root.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { WorkspaceState } from './workspace'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const workspaceId = (import.meta.env.VITE_WORKSPACE_ID as string | undefined) || 'campusfest-2025'

export const remoteEnabled = Boolean(url && key)
let client: SupabaseClient | null = null
function db() {
  if (!client) client = createClient(url!, key!, { auth: { persistSession: false } })
  return client
}

export async function loadRemote(): Promise<WorkspaceState | null> {
  const { data, error } = await db().from('workspace_state').select('state').eq('id', workspaceId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.state as WorkspaceState) ?? null
}

export async function saveRemote(state: WorkspaceState): Promise<void> {
  const { error } = await db().from('workspace_state').upsert({ id: workspaceId, state, updated_at: new Date(state.updatedAt || Date.now()).toISOString() })
  if (error) throw new Error(error.message)
}

export const remoteLabel = remoteEnabled ? `Supabase · ${workspaceId}` : 'This browser (localStorage)'
