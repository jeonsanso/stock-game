import type { TradeRecord } from '../store/historyStore'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const SESSION_KEY = 'history-session-id'
const MIGRATED_KEY = 'history-migrated'

export function getSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

export function isMigrated(): boolean {
  return localStorage.getItem(MIGRATED_KEY) === '1'
}

export function markMigrated(): void {
  localStorage.setItem(MIGRATED_KEY, '1')
}

export async function syncTrades(trades: TradeRecord[]): Promise<void> {
  if (trades.length === 0) return
  const session_id = getSessionId()
  await fetch(`${API_BASE}/api/history/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id, trades }),
  })
}

export async function loadTrades(): Promise<TradeRecord[]> {
  const session_id = getSessionId()
  const res = await fetch(`${API_BASE}/api/history/trades?session_id=${encodeURIComponent(session_id)}`)
  if (!res.ok) throw new Error(`history/trades ${res.status}`)
  return res.json()
}
