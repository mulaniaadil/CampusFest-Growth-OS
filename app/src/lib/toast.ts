import { useSyncExternalStore } from 'react'

export interface Toast { id: number; text: string; tone: 'info' | 'error' }
let toasts: Toast[] = []
const ls = new Set<() => void>()
const emit = () => ls.forEach((l) => l())

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, tone }]
  emit()
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit() }, tone === 'error' ? 7000 : 4000)
}
export function dismissToast(id: number) { toasts = toasts.filter((t) => t.id !== id); emit() }
export function useToasts() {
  return useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l) }, () => toasts, () => toasts)
}
