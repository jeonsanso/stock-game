export interface StockInfo {
  symbol: string
  name: string
  market: 'KOSPI' | 'KOSDAQ'
}

export const WATCHLIST: StockInfo[] = [
  { symbol: '005930.KS', name: '삼성전자', market: 'KOSPI' },
  { symbol: '000660.KS', name: 'SK하이닉스', market: 'KOSPI' },
  { symbol: '005380.KS', name: '현대차', market: 'KOSPI' },
  { symbol: '035420.KS', name: 'NAVER', market: 'KOSPI' },
  { symbol: '373220.KS', name: 'LG에너지솔루션', market: 'KOSPI' },
  { symbol: '207940.KS', name: '삼성바이오로직스', market: 'KOSPI' },
  { symbol: '035720.KQ', name: '카카오', market: 'KOSDAQ' },
  { symbol: '068270.KS', name: '셀트리온', market: 'KOSPI' },
  { symbol: '247540.KQ', name: '에코프로비엠', market: 'KOSDAQ' },
  { symbol: '086520.KQ', name: '에코프로', market: 'KOSDAQ' },
]

export const INITIAL_CASH = 10_000_000

export const BUY_FEE_RATE = 0.00015   // 0.015% 증권사 수수료
export const SELL_FEE_RATE = 0.00215  // 0.015% 수수료 + 0.2% 증권거래세
