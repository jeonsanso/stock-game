import type { CandleBar } from './yahooFinance'

export interface SyntheticStock {
  symbol: string
  name: string
  sector: string
}

const CONFIGS: Record<string, { drift: number; volatility: number; startPrice: number }> = {
  // 1차 종목 (기본)
  SIM001: { drift:  0.0015, volatility: 0.020, startPrice: 25000 },
  SIM002: { drift: -0.0008, volatility: 0.025, startPrice:  8500 },
  SIM003: { drift:  0.0008, volatility: 0.018, startPrice: 45000 },
  SIM004: { drift: -0.0012, volatility: 0.022, startPrice: 12000 },
  SIM005: { drift:  0.0012, volatility: 0.030, startPrice:  3500 },
  SIM006: { drift: -0.0006, volatility: 0.020, startPrice: 67000 },
  SIM007: { drift:  0.0005, volatility: 0.015, startPrice: 18000 },
  SIM008: { drift: -0.0015, volatility: 0.028, startPrice:  5200 },
  SIM009: { drift:  0.0010, volatility: 0.022, startPrice: 33000 },
  SIM010: { drift: -0.0004, volatility: 0.018, startPrice: 42000 },
  // 2차 종목 (시뮬레이션 종료 후 교체)
  SIM011: { drift:  0.0018, volatility: 0.024, startPrice: 15000 },
  SIM012: { drift: -0.0010, volatility: 0.019, startPrice: 58000 },
  SIM013: { drift:  0.0007, volatility: 0.032, startPrice:  4200 },
  SIM014: { drift: -0.0014, volatility: 0.021, startPrice: 22000 },
  SIM015: { drift:  0.0020, volatility: 0.026, startPrice:  9800 },
  SIM016: { drift: -0.0005, volatility: 0.017, startPrice: 72000 },
  SIM017: { drift:  0.0009, volatility: 0.023, startPrice: 31000 },
  SIM018: { drift: -0.0011, volatility: 0.029, startPrice:  6600 },
  SIM019: { drift:  0.0013, volatility: 0.016, startPrice: 48000 },
  SIM020: { drift: -0.0003, volatility: 0.025, startPrice: 11000 },
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

export const ALTERNATE_STOCKS: SyntheticStock[] = [
  { symbol: 'SIM011', name: '극동전자',     sector: '전자'   },
  { symbol: 'SIM012', name: '신한바이오',   sector: '바이오' },
  { symbol: 'SIM013', name: '대한에너지',   sector: '에너지' },
  { symbol: 'SIM014', name: '호남건설',     sector: '건설'   },
  { symbol: 'SIM015', name: '서울IT',       sector: 'IT'     },
  { symbol: 'SIM016', name: '동북화학',     sector: '화학'   },
  { symbol: 'SIM017', name: '경기반도체',   sector: '반도체' },
  { symbol: 'SIM018', name: '인천정밀',     sector: '정밀'   },
  { symbol: 'SIM019', name: '전남소재',     sector: '소재'   },
  { symbol: 'SIM020', name: '부산물산',     sector: '유통'   },
]

const ALL_STOCKS = [...SYNTHETIC_STOCKS, ...ALTERNATE_STOCKS]

const NAME_MAP = Object.fromEntries(ALL_STOCKS.map((s) => [s.symbol, s.name]))

export function getSyntheticName(symbol: string): string {
  return NAME_MAP[symbol] ?? symbol
}

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
