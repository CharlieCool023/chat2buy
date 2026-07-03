import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../App'

const API_BASE = '' // Uses same origin (proxy in dev, or served together in prod)

export function useApi<T>(endpoint: string) {
  const { token } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}${endpoint}?token=${token}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch')
    }
    setLoading(false)
  }, [endpoint, token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export async function apiPost(endpoint: string, token: string | null, body: any) {
  const res = await fetch(`${endpoint}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res.json()
}

export async function apiPut(endpoint: string, token: string | null, body: any) {
  const res = await fetch(`${endpoint}?token=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res.json()
}

export async function apiDelete(endpoint: string, token: string | null) {
  const res = await fetch(`${endpoint}?token=${token}`, {
    method: 'DELETE'
  })
  return res.json()
}
