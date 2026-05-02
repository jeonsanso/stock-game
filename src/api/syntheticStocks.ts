import type { CandleBar } from './yahooFinance'

export interface SyntheticStock {
  symbol: string
  name: string
  sector: string
}

interface StockConfig {
  drift: number
  volatility: number
  startPrice: number
}

// 어떤 종목이 상승/하락인지 UI에 노출하지 않음
const CONFIGS: Record<string, StockConfig> = {
  SIM001: { drift:  0.0015, volatility: 0.020, startPrice: 25000 }, // 우상향
  SIM002: { drift: -0.0008, volatility: 0.025, startPrice:  8500 }, // 우하향
  SIM003: { drift:  0.0008, volatility: 0.018, startPrice: 45000 }, // 우상향
  SIM004: { drift: -0.0012, volatility: 0.022, startPrice: 12000 }, // 우하향
  SIM005: { drift:  0.0012, volatility: 0.030, startPrice:  3500 }, // 우상향
  SIM006: { drift: -0.0006, volatility: 0.020, startPrice: 67000 }, // 우하향
  SIM007: { drift:  0.0005, volatility: 0.015, startPrice: 18000 }, // 우상향
  SIM008: { drift: -0.0015, volatility: 0.028, startPrice:  5200 }, // 우하향
  SIM009: { drift:  0.0010, volatility: 0.022, startPrice: 33000 }, // 우상향
  SIM010: { drift: -0.0004, volatility: 0.018, startPrice: 42000 }, // 우하향
}

export const SYNTHETIC_STOCKS: SyntheticStock[] = [
  { symbol: 'SIM001', name: '미래반도체',   sector: '반도체' },
  { symbol: 'SIM002', name: '동방화학',     sector: '화학'   },
  { symbol: 'SIM003', name: '한국AI솔루션', sector: 'IT'     },
  { symbol: 'SIM004', name: '구성건설',     sector: '건설'   },
  { symbol: 'SIM005', name: '신성바이오',   sector: '바이오' },
  { symbol: 'SIM006', name: '태양중공업',   sector: '중공업' },
  { symbol: 'SIM007', name: '그린에너지',   sector: '에너지' },
  { symbol: 'SIM008', name: '백두금속',     sector: '금속'   },
  { symbol: 'SIM009', name: '디지털플랫폼', sector: 'IT'     },
  { symbol: 'SIM010', name: '한림유통',     sector: '유통'   },
]

function hashString(str: string): number {
  let h = 0
  for (const c of str) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0
  return h >>> 0
}

function seededRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const cache: Record<string, CandleBar[]> = {}

export function getSyntheticCandles(symbol: string): CandleBar[] {
  if (cache[symbol]) return cache[symbol]
  const config = CONFIGS[symbol]
  if (!config) return []

  const rng = seededRng(hashString(symbol))
  const candles: CandleBar[] = []

  const start = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(0, 0, 0, 0)

  let price = config.startPrice

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue

    const ret = config.drift + (rng() - 0.5) * config.volatility * 2.5
    const open  = Math.max(1, Math.round(price * (1 + (rng() - 0.5) * 0.004)))
    const close = Math.max(1, Math.round(open * (1 + ret)))
    const high  = Math.max(open, close, Math.round(Math.max(open, close) * (1 + rng() * 0.012)))
    const low   = Math.min(open, close, Math.round(Math.min(open, close) * (1 - rng() * 0.012)))
    const volume = Math.floor(rng() * 800000 + 50000)

    candles.push({ time: Math.floor(d.getTime() / 1000), open, high, low, close, volume })
    price = close
  }

  cache[symbol] = candles
  return candles
}

export function isSynthetic(symbol: string): boolean {
  return symbol.startsWith('SIM')
}
