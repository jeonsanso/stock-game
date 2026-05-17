// FastAPI 예측 서버 클라이언트

const AI_BASE = import.meta.env.VITE_API_BASE ?? ''

export interface ShapEntry {
  feature: string
  label: string
  value: number | null
  shap: number
  direction: 'up' | 'down'
}

export interface Prediction {
  rank: number
  symbol: string
  probability: number
  shap_top: ShapEntry[]
  strategy?: TradeStrategy
}

export interface DisclosureRisk {
  report_nm: string
  rcept_dt: string
  matched_keyword: string
  rcept_no?: string
}

export interface DisclosureAnalysis {
  severity: 'critical' | 'high' | 'medium'
  severity_label: string
  color: 'red' | 'orange' | 'yellow'
  direction: string
  range: string
  timing: string
  analysis: string
  rerank_eligible: boolean
  matched_keyword: string
}

export interface ExcludedStock {
  symbol: string
  risks: DisclosureRisk[]
  rank?: number
  analysis?: DisclosureAnalysis
}

export interface CooldownStock {
  symbol: string
  reason: string
  rank?: number
}

export interface TodayResponse {
  date: string
  total_stocks: number
  predictions: Prediction[]
  excluded: ExcludedStock[]
  excluded_cooldown?: CooldownStock[]
  market_mode?: 'aggressive' | 'cautious' | 'defensive'
  market_message?: string
  threshold_applied?: number
}

export interface TradeEntry {
  buy_price_low: number
  buy_price_high: number
  buy_low_pct: string
  buy_high_pct: string
  warning: string | null
  caution?: string
}

export interface ExitTargets {
  target1_price: number
  target1_pct: string
  target1_action: string
  target2_price: number
  target2_pct: string
  target2_action: string
  stop_loss_price: number
  stop_loss_pct: string
  stop_loss_action: string
}

export interface TradeStrategy {
  action_label: '관망 권장' | '신중 진입' | '적극 고려'
  action_reason: string
  entry: TradeEntry
  exit_targets: ExitTargets
  position: { weight_pct: number; weight_label: string }
  holding: { max_days: number; strategy: string }
  warnings: string[]
  risk_level: '낮음' | '중간' | '높음'
}

export interface PriceBar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TickerDetail {
  symbol: string
  date: string
  probability: number
  rank: number | null
  shap_full: ShapEntry[]
  price_history: PriceBar[]
  recent_features: Record<string, number | null>
  strategy?: TradeStrategy
}

export interface CostsApplied {
  commission_pct: number
  sell_tax_pct: number
  slippage_pct: number
  min_volume_bn: number
  avg_excluded_per_day: number
}

export interface BacktestData {
  dates: string[]
  cumulative_return_pct: number[]
  daily_return_pct: number[]
  total_return_pct: number
  sharpe_ratio: number
  max_drawdown_pct: number
  win_rate: number
  gross_total_return_pct?: number
  gross_sharpe_ratio?: number
  gross_win_rate?: number
  costs_applied?: CostsApplied
}

export interface PerformanceResponse {
  model_version: string | null
  target_col: string | null
  trained_at: string | null
  val_auc: number | null
  precision_at_topk: Record<string, number> | null
  backtest: BacktestData | null
}

export interface MarketTrend {
  trend: 'bull' | 'sideways' | 'bear' | 'unknown'
  label: string
  ret_5d_pct: number
  ret_20d_pct: number
  confidence: 'high' | 'medium' | 'low'
  badge: string | null
  dates: string[]
  returns: number[]
}

export interface DailySummary {
  date: string
  market: MarketTrend
  top3: Prediction[]
  model_confidence: string
  caution: string
}

// ── localStorage helpers ───────────────────────────────────────

const WL_KEY = 'ai_watchlist'
export const getWatchlist = (): string[] => JSON.parse(localStorage.getItem(WL_KEY) ?? '[]')
export const toggleWatchlist = (symbol: string): boolean => {
  const list = getWatchlist()
  const idx = list.indexOf(symbol)
  if (idx >= 0) list.splice(idx, 1); else list.push(symbol)
  localStorage.setItem(WL_KEY, JSON.stringify(list))
  return idx < 0
}

export const getMemo = (symbol: string): string => localStorage.getItem(`ai_memo_${symbol}`) ?? ''
export const saveMemo = (symbol: string, text: string): void =>
  localStorage.setItem(`ai_memo_${symbol}`, text)

export interface VirtualTrade {
  id: string
  symbol: string
  action: 'buy' | 'sell'
  date: string
  price: number
  shares: number
  note: string
}

const VT_KEY = 'ai_vtrades'
export const getVirtualTrades = (symbol?: string): VirtualTrade[] => {
  const all: VirtualTrade[] = JSON.parse(localStorage.getItem(VT_KEY) ?? '[]')
  return symbol ? all.filter(t => t.symbol === symbol) : all
}
export const addVirtualTrade = (t: Omit<VirtualTrade, 'id'>): void => {
  const all = getVirtualTrades()
  all.unshift({ ...t, id: `${Date.now()}` })
  localStorage.setItem(VT_KEY, JSON.stringify(all))
}
export const deleteVirtualTrade = (id: string): void => {
  const all = getVirtualTrades().filter(t => t.id !== id)
  localStorage.setItem(VT_KEY, JSON.stringify(all))
}

// ── Paper Trading 인터페이스 ──────────────────────────────────

export interface ActiveTrade {
  id: number
  symbol: string
  name?: string
  recommended_date: string
  recommended_rank: number | null
  recommended_prob: number | null
  recommended_price: number | null
  current_price: number | null
  unrealized_pct: number | null
  holding_days: number
  status: string
}

export interface TradeRecord {
  id: number
  symbol: string
  name?: string
  recommended_date: string
  recommended_rank: number | null
  recommended_prob: number | null
  recommended_price: number | null
  status: string
  close_date: string | null
  close_price: number | null
  return_pct: number | null
  holding_days: number | null
}

export interface PerformanceSummary {
  total_trades: number
  closed_trades: number
  open_trades: number
  expired_trades: number
  win_count: number
  win_rate: number | null
  avg_return_pct: number | null
  total_return_pct: number | null
  avg_holding_days: number | null
  best_trade: { symbol: string; name?: string; return_pct: number } | null
  worst_trade: { symbol: string; name?: string; return_pct: number } | null
  recent_trades: TradeRecord[]
}

// ── API ────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${AI_BASE}${path}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface RetrainStatus {
  status: 'idle' | 'running' | 'done' | 'error'
  elapsed_sec: number | null
  return_code?: number | null
  log: string[]
}

async function apiPost<T>(path: string): Promise<T> {
  const res = await fetch(`${AI_BASE}${path}`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const paperTradingApi = {
  recordToday: (date?: string) =>
    apiPost<{ date: string; inserted: number; skipped: number }>(
      `/api/paper/record${date ? `?date=${date}` : ''}`
    ),
  closeExpired: () =>
    apiPost<{ closed: number; expired: number }>('/api/paper/close-expired'),
  getActive: () =>
    apiFetch<ActiveTrade[]>('/api/paper/active'),
  getPerformance: () =>
    apiFetch<PerformanceSummary>('/api/paper/performance'),
}

export const aiApi = {
  predictions: (topN = 30) =>
    apiFetch<TodayResponse>(`/api/predictions/today?top_n=${topN}`),
  ticker: (symbol: string) =>
    apiFetch<TickerDetail>(`/api/predictions/${symbol}`),
  performance: () =>
    apiFetch<PerformanceResponse>('/api/backtest/performance'),
  marketTrend: () =>
    apiFetch<MarketTrend>('/api/market/trend'),
  dailySummary: () =>
    apiFetch<DailySummary>('/api/daily/summary'),
  startRetrain: (quick = false) =>
    fetch(`${AI_BASE}/api/admin/retrain?quick=${quick}`, { method: 'POST' }).then(async r => {
      if (!r.ok) { const e = await r.json().catch(() => ({ detail: `HTTP ${r.status}` })); throw new Error(e.detail) }
      return r.json()
    }),
  retrainStatus: () =>
    apiFetch<RetrainStatus>('/api/admin/retrain/status'),
}
