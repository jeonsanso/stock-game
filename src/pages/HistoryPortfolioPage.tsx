import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCandlesCached, getPriceAt, type CandleBar } from '../api/yahooFinance'
import { isSynthetic } from '../api/syntheticStocks'
import { useHistoryStore, type TradeRecord, type Holding } from '../store/historyStore'
import { formatKRW, formatNumber, formatChangePercent, formatChange, changeColor, changeBg } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

export default function HistoryPortfolioPage() {
  const { cash, holdings, tradeHistory, stockPositions, startDate } = useHistoryStore()
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [startPriceMap, setStartPriceMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  // 보유 + 거래한 모든 종목 대상으로 fetch
  const tradedSymbols = [...new Set(tradeHistory.map((t) => t.symbol))]
  const symbolsKey = tradedSymbols.join(',')

  useEffect(() => {
    if (tradedSymbols.length === 0) {
      setPriceMap({})
      setStartPriceMap({})
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      tradedSymbols.map(async (sym) => {
        const gameDate = stockPositions[sym] ?? startDate
        let candles: CandleBar[]
        if (isSynthetic(sym)) {
          candles = []
        } else {
          candles = await fetchCandlesCached(sym, '1y')
        }
        const startPx = getPriceAt(candles, startDate) ?? 0
        const endPx = getPriceAt(candles, gameDate) ?? 0
        return { sym, startPx, endPx }
      }),
    )
      .then((entries) => {
        if (cancelled) return
        const pMap: Record<string, number> = {}
        const sMap: Record<string, number> = {}
        entries.forEach(({ sym, startPx, endPx }) => {
          pMap[sym] = endPx
          sMap[sym] = startPx
        })
        setPriceMap(pMap)
        setStartPriceMap(sMap)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, JSON.stringify(stockPositions), startDate])

  const stockValue = Object.values(holdings).reduce((sum, h) => {
    const price = priceMap[h.symbol] ?? h.avgPrice
    return sum + price * h.quantity
  }, 0)

  const totalAsset = cash + stockValue
  const profitAmount = totalAsset - INITIAL_CASH
  const profitRate = (profitAmount / INITIAL_CASH) * 100

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-white text-xl font-bold">포트폴리오</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 col-span-2 sm:col-span-1">
          <p className="text-gray-400 text-xs mb-1">총 자산</p>
          <p className="text-white text-lg font-bold">{formatKRW(totalAsset)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">현금</p>
          <p className="text-white font-semibold">{formatKRW(cash)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">주식 평가액</p>
          <p className="text-white font-semibold">{loading ? '...' : formatKRW(stockValue)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">총 수익률</p>
          <p className={`font-bold text-lg ${changeColor(profitRate)}`}>
            {formatChangePercent(profitRate)}
          </p>
        </div>
      </div>

      <TradeStatsSection tradeHistory={tradeHistory} holdings={holdings} priceMap={priceMap} />

      <StockPnlSection tradeHistory={tradeHistory} holdings={holdings} priceMap={priceMap} loading={loading} />

      <MarketConditionSection
        tradeHistory={tradeHistory}
        holdings={holdings}
        priceMap={priceMap}
        startPriceMap={startPriceMap}
        loading={loading}
      />

      <div className="space-y-6">
        <section>
          <h2 className="text-white font-semibold mb-3">보유 종목</h2>
          {Object.keys(holdings).length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400 text-sm">
              보유 중인 종목이 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {Object.values(holdings).map((h) => {
                const currentPrice = priceMap[h.symbol] ?? 0
                const evalAmt = currentPrice * h.quantity
                const profit = evalAmt - h.avgPrice * h.quantity
                const profitRate = h.avgPrice > 0 ? (profit / (h.avgPrice * h.quantity)) * 100 : 0

                return (
                  <Link
                    key={h.symbol}
                    to={`/history/stock/${encodeURIComponent(h.symbol)}`}
                    className="flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors"
                  >
                    <div>
                      <p className="text-white text-sm font-semibold">{h.name}</p>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {formatNumber(h.quantity)}주 · 평균 {formatKRW(h.avgPrice)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-white text-sm font-semibold">
                        {loading ? '...' : formatKRW(evalAmt)}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${changeBg(profitRate)}`}>
                        {loading ? '—' : `${formatChange(profit)} (${formatChangePercent(profitRate)})`}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-white font-semibold mb-3">거래 내역</h2>
          {tradeHistory.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400 text-sm">
              거래 내역이 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {tradeHistory.slice(0, 30).map((t: TradeRecord) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        t.type === 'buy' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                      }`}
                    >
                      {t.type === 'buy' ? '매수' : '매도'}
                    </span>
                    <div>
                      <p className="text-white text-sm font-medium">{t.name}</p>
                      <p className="text-gray-400 text-xs">
                        {formatNumber(t.quantity)}주 @ {formatKRW(t.price)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${changeColor(t.type === 'buy' ? -1 : 1)}`}>
                      {t.type === 'buy' ? '-' : '+'}{formatKRW(t.total)}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {new Date(t.timestamp).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function TradeStatsSection({
  tradeHistory,
  holdings,
  priceMap,
}: {
  tradeHistory: TradeRecord[]
  holdings: Record<string, Holding>
  priceMap: Record<string, number>
}) {
  const symbols = [...new Set(tradeHistory.map((t) => t.symbol))]
  if (symbols.length === 0) return null

  const stockStats = symbols.map((sym) => {
    const trades = tradeHistory.filter((t) => t.symbol === sym)
    const buys = trades.filter((t) => t.type === 'buy')
    const sells = trades.filter((t) => t.type === 'sell')
    const totalSpent = buys.reduce((s, t) => s + t.total, 0)
    const totalReceived = sells.reduce((s, t) => s + t.total, 0)
    const holding = holdings[sym]
    const holdingValue = holding ? (priceMap[sym] ?? holding.avgPrice) * holding.quantity : 0
    const netPnl = totalReceived + holdingValue - totalSpent
    const pnlPct = totalSpent > 0 ? (netPnl / totalSpent) * 100 : 0
    const name = trades[0].name
    return { sym, name, pnlPct, netPnl, tradeCount: trades.length }
  })

  const tradedStocks = stockStats.filter((s) => Math.abs(s.netPnl) > 0 || s.tradeCount > 0)
  if (tradedStocks.length < 2) return null

  const winners = tradedStocks.filter((s) => s.netPnl > 0).length
  const losers  = tradedStocks.filter((s) => s.netPnl < 0).length
  const winRate = tradedStocks.length > 0 ? (winners / tradedStocks.length) * 100 : 0
  const avgReturn = tradedStocks.reduce((s, r) => s + r.pnlPct, 0) / tradedStocks.length
  const best  = tradedStocks.reduce((a, b) => a.pnlPct > b.pnlPct ? a : b)
  const worst = tradedStocks.reduce((a, b) => a.pnlPct < b.pnlPct ? a : b)
  const totalTrades = tradeHistory.length

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h2 className="text-white font-semibold mb-4">트레이딩 통계</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">승률</p>
          <p className={`text-lg font-bold ${winRate >= 50 ? 'text-red-400' : 'text-blue-400'}`}>{winRate.toFixed(0)}%</p>
          <p className="text-gray-500 text-xs">{winners}승 {losers}패</p>
        </div>
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">평균 수익률</p>
          <p className={`text-lg font-bold ${avgReturn >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(2)}%
          </p>
          <p className="text-gray-500 text-xs">종목당 평균</p>
        </div>
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">최고 종목</p>
          <p className="text-red-400 text-sm font-bold">{best.name}</p>
          <p className="text-red-400 text-xs">+{best.pnlPct.toFixed(2)}%</p>
        </div>
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">최저 종목</p>
          <p className="text-blue-400 text-sm font-bold">{worst.name}</p>
          <p className="text-blue-400 text-xs">{worst.pnlPct.toFixed(2)}%</p>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500 border-t border-gray-800 pt-3">
        <span>총 거래 횟수 <span className="text-white">{totalTrades}회</span></span>
        <span>분석 종목 <span className="text-white">{tradedStocks.length}개</span></span>
        {winRate >= 60 && <span className="text-green-400">▲ 승률 양호</span>}
        {avgReturn < 0 && <span className="text-orange-400">⚠ 평균 손실 — 손절 전략을 점검해보세요</span>}
        {winRate < 40 && tradedStocks.length >= 3 && <span className="text-orange-400">⚠ 낮은 승률 — 진입 타이밍 개선이 필요합니다</span>}
      </div>
    </section>
  )
}

function StockPnlSection({
  tradeHistory,
  holdings,
  priceMap,
  loading,
}: {
  tradeHistory: TradeRecord[]
  holdings: Record<string, Holding>
  priceMap: Record<string, number>
  loading: boolean
}) {
  const symbols = [...new Set(tradeHistory.map((t) => t.symbol))]
  if (symbols.length === 0) return null

  const rows = symbols.map((sym) => {
    const trades = tradeHistory.filter((t) => t.symbol === sym)
    const name = trades[0].name
    const totalSpent = trades.filter((t) => t.type === 'buy').reduce((s, t) => s + t.total, 0)
    const totalReceived = trades.filter((t) => t.type === 'sell').reduce((s, t) => s + t.total, 0)
    const holding = holdings[sym]
    const currentPrice = priceMap[sym] ?? 0
    const holdingValue = holding ? currentPrice * holding.quantity : 0
    const netPnl = totalReceived + holdingValue - totalSpent
    const pnlPct = totalSpent > 0 ? (netPnl / totalSpent) * 100 : 0
    const isHolding = !!holding
    return { sym, name, totalSpent, totalReceived, holdingValue, netPnl, pnlPct, isHolding }
  })

  return (
    <section>
      <h2 className="text-white font-semibold mb-3">종목별 수익</h2>
      <div className="space-y-2">
        {rows.map(({ sym, name, holdingValue, netPnl, pnlPct, isHolding }) => {
          const pos = netPnl >= 0
          return (
            <Link
              key={sym}
              to={`/history/stock/${encodeURIComponent(sym)}`}
              className={`flex items-center justify-between rounded-xl px-4 py-3 border transition-colors hover:border-gray-600 ${
                pos ? 'bg-red-500/5 border-red-500/20' : 'bg-blue-500/5 border-blue-500/20'
              }`}
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-white text-sm font-semibold">{name}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{sym}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${
                  isHolding
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-gray-700 text-gray-400 border-gray-600'
                }`}>
                  {isHolding ? '보유중' : '매도완료'}
                </span>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : ''}{formatKRW(Math.round(netPnl))}
                </p>
                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                  {isHolding && (
                    <span className="text-xs text-gray-500">
                      {loading ? '...' : `평가 ${formatKRW(holdingValue)}`}
                    </span>
                  )}
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                    pos ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'
                  }`}>
                    {pos ? '+' : ''}{pnlPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function MarketConditionSection({
  tradeHistory,
  holdings,
  priceMap,
  startPriceMap,
  loading,
}: {
  tradeHistory: TradeRecord[]
  holdings: Record<string, Holding>
  priceMap: Record<string, number>
  startPriceMap: Record<string, number>
  loading: boolean
}) {
  const symbols = [...new Set(tradeHistory.map((t) => t.symbol))]
  if (symbols.length === 0 || loading) return null

  const rows = symbols
    .filter((sym) => (startPriceMap[sym] ?? 0) > 0)
    .map((sym) => {
      const trades = tradeHistory.filter((t) => t.symbol === sym)
      const name = trades[0].name
      const totalSpent = trades.filter((t) => t.type === 'buy').reduce((s, t) => s + t.total, 0)
      const totalReceived = trades.filter((t) => t.type === 'sell').reduce((s, t) => s + t.total, 0)
      const holding = holdings[sym]
      const holdingValue = holding ? (priceMap[sym] ?? 0) * holding.quantity : 0
      const netPnl = totalReceived + holdingValue - totalSpent
      const userPct = totalSpent > 0 ? (netPnl / totalSpent) * 100 : 0

      const startPx = startPriceMap[sym]
      const endPx = priceMap[sym] ?? 0
      const marketPct = ((endPx - startPx) / startPx) * 100

      const marketUp = marketPct >= 0
      const userProfit = netPnl >= 0
      const alpha = userPct - marketPct

      let category: string
      let categoryColor: string
      if (marketUp && userProfit) {
        category = '상승장 수익'
        categoryColor = 'text-red-400'
      } else if (marketUp && !userProfit) {
        category = '기회 손실'
        categoryColor = 'text-orange-400'
      } else if (!marketUp && userProfit) {
        category = '역추세 수익'
        categoryColor = 'text-yellow-400'
      } else {
        category = '하락장 손실'
        categoryColor = 'text-blue-400'
      }

      return { sym, name, marketPct, userPct, netPnl, category, categoryColor, alpha, marketUp, userProfit }
    })

  if (rows.length === 0) return null

  const avgMarketPct = rows.reduce((s, r) => s + r.marketPct, 0) / rows.length
  const avgUserPct = rows.reduce((s, r) => s + r.userPct, 0) / rows.length
  const avgAlpha = avgUserPct - avgMarketPct

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h2 className="text-white font-semibold mb-1">시장 환경 분석</h2>
      <p className="text-gray-500 text-xs mb-4">시뮬레이션 기간 동안 해당 종목의 실제 등락과 내 수익을 비교합니다</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">시장 평균 수익률</p>
          <p className={`text-lg font-bold ${avgMarketPct >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {avgMarketPct >= 0 ? '+' : ''}{avgMarketPct.toFixed(2)}%
          </p>
          <p className="text-gray-500 text-xs">거래 종목 바이앤홀드</p>
        </div>
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">내 평균 수익률</p>
          <p className={`text-lg font-bold ${avgUserPct >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {avgUserPct >= 0 ? '+' : ''}{avgUserPct.toFixed(2)}%
          </p>
          <p className="text-gray-500 text-xs">종목당 평균</p>
        </div>
        <div className="bg-gray-800 rounded-xl px-3 py-2.5">
          <p className="text-gray-400 text-xs mb-1">시장 대비 알파</p>
          <p className={`text-lg font-bold ${avgAlpha >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
            {avgAlpha >= 0 ? '+' : ''}{avgAlpha.toFixed(2)}%p
          </p>
          <p className="text-gray-500 text-xs">{avgAlpha >= 0 ? '시장 상회' : '시장 하회'}</p>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map(({ sym, name, marketPct, userPct, category, categoryColor, alpha, marketUp }) => (
          <div key={sym} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="text-base">{marketUp ? '📈' : '📉'}</span>
              <div>
                <p className="text-white text-sm font-semibold">{name}</p>
                <p className={`text-xs ${categoryColor}`}>{category}</p>
              </div>
            </div>
            <div className="flex items-center gap-5 text-right">
              <div>
                <p className="text-gray-500 text-xs">시장</p>
                <p className={`text-sm font-semibold ${marketPct >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {marketPct >= 0 ? '+' : ''}{marketPct.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">내 수익</p>
                <p className={`text-sm font-semibold ${userPct >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                  {userPct >= 0 ? '+' : ''}{userPct.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs">알파</p>
                <p className={`text-sm font-semibold ${alpha >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                  {alpha >= 0 ? '+' : ''}{alpha.toFixed(2)}%p
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(rows.some((r) => !r.marketUp && r.userProfit) ||
        rows.some((r) => r.marketUp && !r.userProfit) ||
        Math.abs(avgAlpha) > 5) && (
        <div className="flex flex-wrap gap-3 text-xs border-t border-gray-800 pt-3 mt-3">
          {rows.some((r) => !r.marketUp && r.userProfit) && (
            <span className="text-yellow-400">★ 하락장에서 수익 — 탁월한 역추세 트레이딩</span>
          )}
          {rows.some((r) => r.marketUp && !r.userProfit) && (
            <span className="text-orange-400">⚠ 상승 종목에서 손실 — 진입·청산 타이밍 점검 필요</span>
          )}
          {avgAlpha > 5 && (
            <span className="text-green-400">▲ 시장 대비 {avgAlpha.toFixed(1)}%p 초과 수익 달성</span>
          )}
          {avgAlpha < -5 && (
            <span className="text-orange-400">▼ 시장보다 {Math.abs(avgAlpha).toFixed(1)}%p 낮은 성과 — 패시브 전략을 고려해보세요</span>
          )}
        </div>
      )}
    </section>
  )
}
