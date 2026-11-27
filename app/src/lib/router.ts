import { useEffect, useState } from 'react'

export type Route = 'overview' | 'analytics' | 'campaigns' | 'analyst' | 'data'
export const ROUTES: Route[] = ['overview', 'analytics', 'campaigns', 'analyst', 'data']

function parse(): { route: Route; params: URLSearchParams } {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [path, qs] = h.split('?')
  const route = (ROUTES as string[]).includes(path) ? (path as Route) : 'overview'
  return { route, params: new URLSearchParams(qs ?? '') }
}

export function useRoute() {
  const [r, setR] = useState(parse)
  useEffect(() => {
    const on = () => setR(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

export function navigate(route: Route, params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  window.location.hash = `/${route}${qs}`
}
