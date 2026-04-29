// 네이버 증권 API (검증된 엔드포인트)
// 시세(현재가): GET /api/naver/api/stock/{code}/basic
// 시세(OHLCV):  GET /api/naver/api/stock/{code}/integration  (totalInfos)
// 차트:         GET /api/naver-chart/sise.nhn?symbol={code}&timeframe=day&count=N&requestType=0  (XML)
// 검색:         GET /api/naver-search/ac?q={query}&target=stock,index

function toCode(symbol: string): string {
  return symbol.split('.')[0]
}

export interface QuoteResult {
  symbol: string
  shortName: string
  regularMarketPrice: number
  regularMarketChange: number
  regularMarketChangePercent: number
  regularMarketPreviousClose: number
  regularMarketOpen: number
  regularMarketDayHigh: number
  regularMarketDayLow: number
  regularMarketVolume: number
  currency: string
}

export interface CandleBar {
  time: number // Unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface SearchResult {
  symbol: string
  shortname: string
  exchDisp: string
  typeDisp: string
}

function parseNum(val: string | number | undefined): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  return Number(String(val).replace(/,/g, '')) || 0
}

function findInfo(totalInfos: { code: string; value: string }[], code: string): number {
  const item = totalInfos?.find((i) => i.code === code)
  return item ? parseNum(item.value) : 0
}

// 현재가·등락 전용 (watchlist, 빠른 조회)
async function fetchBasic(symbol: string): Promise<Omit<QuoteResult, 'regularMarketOpen' | 'regularMarketDayHigh' | 'regularMarketDayLow' | 'regularMarketVolume'>> {
  const code = toCode(symbol)
  const res = await fetch(`/api/naver-stock/api/stock/${code}/basic`)
  if (!res.ok) throw new Error(`basic ${res.status}`)
  const d = await res.json()
  const price = parseNum(d.closePrice ?? d.stockEndPrice)
  const change = parseNum(d.compareToPreviousClosePrice)
  const pct = parseNum(d.fluctuationsRatio) * (change < 0 ? -1 : 1)
  return {
    symbol,
    shortName: d.stockName ?? symbol,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: pct,
    regularMarketPreviousClose: price - change,
    currency: 'KRW',
  }
}

// 시가·고가·저가·거래량 추가 (상세 페이지용)
async function fetchIntegration(symbol: string): Promise<{ open: number; high: number; low: number; volume: number }> {
  const code = toCode(symbol)
  const res = await fetch(`/api/naver-stock/api/stock/${code}/integration`)
  if (!res.ok) throw new Error(`integration ${res.status}`)
  const d = await res.json()
  const ti: { code: string; value: string }[] = d.totalInfos ?? []
  return {
    open: findInfo(ti, 'openPrice'),
    high: findInfo(ti, 'highPrice'),
    low: findInfo(ti, 'lowPrice'),
    volume: findInfo(ti, 'accumulatedTradingVolume'),
  }
}

export async function fetchQuote(symbol: string): Promise<QuoteResult> {
  const basic = await fetchBasic(symbol)
  return { ...basic, regularMarketOpen: 0, regularMarketDayHigh: 0, regularMarketDayLow: 0, regularMarketVolume: 0 }
}

export async function fetchQuoteDetail(symbol: string): Promise<QuoteResult> {
  const [basic, ohlcv] = await Promise.all([fetchBasic(symbol), fetchIntegration(symbol)])
  return {
    ...basic,
    regularMarketOpen: ohlcv.open,
    regularMarketDayHigh: ohlcv.high,
    regularMarketDayLow: ohlcv.low,
    regularMarketVolume: ohlcv.volume,
  }
}

export async function fetchQuotes(symbols: string[]): Promise<QuoteResult[]> {
  const results = await Promise.allSettled(symbols.map(fetchQuote))
  return results
    .filter((r): r is PromiseFulfilledResult<QuoteResult> => r.status === 'fulfilled')
    .map((r) => r.value)
}

const RANGE_COUNT: Record<string, number> = {
  '1mo': 30,
  '3mo': 90,
  '6mo': 180,
  '1y': 365,
  '2y': 730,
}

export async function fetchCandles(
  symbol: string,
  range: '1mo' | '3mo' | '6mo' | '1y' | '2y' = '3mo',
): Promise<CandleBar[]> {
  const code = toCode(symbol)
  const count = RANGE_COUNT[range] ?? 90
  const url = `/api/naver-chart/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`chart ${res.status}`)
  const xml = await res.text()

  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const items = doc.querySelectorAll('item')

  const bars: CandleBar[] = []
  items.forEach((item) => {
    const raw = item.getAttribute('data')
    if (!raw) return
    const [dateStr, openStr, highStr, lowStr, closeStr, volumeStr] = raw.split('|')
    const y = Number(dateStr.slice(0, 4))
    const m = Number(dateStr.slice(4, 6)) - 1
    const d = Number(dateStr.slice(6, 8))
    const open = Number(openStr)
    const close = Number(closeStr)
    if (!open || !close) return
    bars.push({
      time: Math.floor(new Date(y, m, d, 9, 0, 0).getTime() / 1000),
      open,
      high: Number(highStr),
      low: Number(lowStr),
      close,
      volume: Number(volumeStr),
    })
  })

  return bars.sort((a, b) => a.time - b.time)
}

// 캔들 배열에서 dateMs(Unix ms) 이전 마지막 캔들의 close 반환 (주말/휴장일 처리 포함)
export function getPriceAt(candles: CandleBar[], dateMs: number): number | null {
  const dateSec = Math.floor(dateMs / 1000)
  let result: number | null = null
  for (const candle of candles) {
    if (candle.time <= dateSec) result = candle.close
    else break
  }
  return result
}

// 캔들 배열에서 dateMs 이전 마지막 캔들 반환
export function getCandleAt(candles: CandleBar[], dateMs: number): CandleBar | null {
  const dateSec = Math.floor(dateMs / 1000)
  let result: CandleBar | null = null
  for (const candle of candles) {
    if (candle.time <= dateSec) result = candle
    else break
  }
  return result
}

// 간단한 모듈 레벨 캔들 캐시 (역사 시뮬레이션에서 중복 요청 방지)
const _candleCache = new Map<string, CandleBar[]>()

export async function fetchCandlesCached(
  symbol: string,
  range: '1mo' | '3mo' | '6mo' | '1y' | '2y' = '1y',
): Promise<CandleBar[]> {
  const key = `${symbol}-${range}`
  if (_candleCache.has(key)) return _candleCache.get(key)!
  const candles = await fetchCandles(symbol, range)
  _candleCache.set(key, candles)
  return candles
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/naver-search/ac?q=${encodeURIComponent(query)}&target=stock,index&lang=ko`)
  if (!res.ok) throw new Error(`search ${res.status}`)
  const data = await res.json()

  // 실제 응답: { items: [{ code, name, typeCode: "KOSPI"/"KOSDAQ", ... }] }
  const items: { code: string; name: string; typeCode: string }[] = data?.items ?? []
  return items
    .filter((item) => item.typeCode === 'KOSPI' || item.typeCode === 'KOSDAQ')
    .map((item) => ({
      symbol: `${item.code}${item.typeCode === 'KOSPI' ? '.KS' : '.KQ'}`,
      shortname: item.name,
      exchDisp: item.typeCode,
      typeDisp: 'Equity',
    }))
}
