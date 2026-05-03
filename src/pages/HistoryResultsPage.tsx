import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCandlesCached, getPriceAt } from '../api/yahooFinance'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatChangePercent, changeColor } from '../utils/format'
import { INITIAL_CASH, BUY_FEE_RATE, SELL_FEE_RATE } from '../api/constants'

interface StockResult {
  symbol: string
  name: string
  totalSpent: number
  totalReceived: number
  holdingValue: number
  netPnl: number
  pnlPct: number
  bhPnl: number
  bhPct: number
  tradeCount: number
  isHolding: boolean
}

export default function HistoryResultsPage() {
  const { cash, holdings, tradeHistory, startDate, gameDate, feeEnabled, reset } = useHistoryStore()
  const [results, setResults] = useState<StockResult[]>([])
  const [loading, setLoading] = useState(true)

  const symbols = [...new Set(tradeHistory.map((t) => t.symbol))]

  useEffect(() => {
    if (symbols.length === 0) { setLoading(false); return }
    setLoading(true)

    Promise.all(
      symbols.map((sym) =>
        fetchCandlesCached(sym, '1y').then((candles) => {
          const trades = tradeHistory.filter((t) => t.symbol === sym)
          const name = trades[0].name
          const totalSpent = trades.filter((t) => t.type === 'buy').reduce((s, t) => s + t.total, 0)
          const totalReceived = trades.filter((t) => t.type === 'sell').reduce((s, t) => s + t.total, 0)
          const holding = holdings[sym]
          const currentPrice = getPriceAt(candles, gameDate) ?? 0
          const holdingValue = holding ? currentPrice * holding.quantity : 0
          const netPnl = totalReceived + holdingValue - totalSpent
          const pnlPct = totalSpent > 0 ? (netPnl / totalSpent) * 100 : 0

          const startPrice = startDate ? (getPriceAt(candles, startDate) ?? 0) : 0
          const bhCost = startPrice * (1 + (feeEnabled ? BUY_FEE_RATE : 0))
          const bhProceeds = currentPrice * (1 - (feeEnabled ? SELL_FEE_RATE : 0))
          const bhPct = bhCost > 0 ? ((bhProceeds - bhCost) / bhCost) * 100 : 0
          const bhPnl = bhCost > 0 ? (bhProceeds - bhCost) / bhCost * totalSpent : 0

          return {
            symbol: sym, name, totalSpent, totalReceived, holdingValue,
            netPnl, pnlPct, bhPnl, bhPct,
            tradeCount: trades.length,
            isHolding: !!holding,
          } satisfies StockResult
        })
      )
    ).then((rows) => {
      setResults(rows)
      setLoading(false)
    }).catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const holdingValue = Object.values(holdings).reduce((s, h) => {
    const r = results.find((r) => r.symbol === h.symbol)
    return s + (r ? r.holdingValue : h.avgPrice * h.quantity)
  }, 0)
  const totalAsset = cash + holdingValue
  const totalPnl = totalAsset - INITIAL_CASH
  const totalPct = (totalPnl / INITIAL_CASH) * 100

  const tradedSymbols = results.filter((r) => r.totalSpent > 0)
  const winners = tradedSymbols.filter((r) => r.netPnl > 0).length
  const losers = tradedSymbols.filter((r) => r.netPnl < 0).length
  const totalTrades = tradeHistory.length

  const startDateStr = startDate
    ? new Date(startDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    : ''
  const endDateStr = new Date(gameDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

  const sorted = [...results].sort((a, b) => b.netPnl - a.netPnl)

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-bold">시뮬레이션 결과</h1>
          <p className="text-gray-400 text-sm mt-1">{startDateStr} → {endDateStr}</p>
        </div>
        <button
          onClick={() => { if (confirm('새 게임을 시작하면 현재 기록이 초기화됩니다. 계속할까요?')) reset() }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          새 게임 시작
        </button>
      </div>

      {/* 총 성과 */}
      <div className={`rounded-2xl border p-6 ${totalPnl >= 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-blue-500/5 border-blue-500/20'}`}>
        <p className="text-gray-400 text-sm mb-2">최종 자산 ({formatKRW(INITIAL_CASH)} 시작)</p>
        <div className="flex items-end gap-4 flex-wrap">
          <span className="text-white text-4xl font-bold">{formatKRW(totalAsset)}</span>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-2xl font-bold ${changeColor(totalPnl)}`}>
              {totalPnl >= 0 ? '+' : ''}{formatKRW(Math.round(totalPnl))}
            </span>
            <span className={`text-xl font-bold px-3 py-1 rounded-full ${totalPct >= 0 ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
              {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* 요약 통계 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">거래 종목 수</p>
          <p className="text-white text-lg font-bold">{tradedSymbols.length}종목</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">총 거래 횟수</p>
          <p className="text-white text-lg font-bold">{totalTrades}회</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">수익 종목</p>
          <p className="text-red-400 text-lg font-bold">{winners}종목</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-400 text-xs mb-1">손실 종목</p>
          <p className="text-blue-400 text-lg font-bold">{losers}종목</p>
        </div>
      </div>

      {/* 종목별 결과 */}
      <section>
        <h2 className="text-white font-semibold mb-3">종목별 성과</h2>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400 text-sm">
            거래 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((r) => {
              const pos = r.netPnl >= 0
              const beatBh = r.pnlPct - r.bhPct
              return (
                <Link
                  key={r.symbol}
                  to={`/history/stock/${encodeURIComponent(r.symbol)}`}
                  className="block bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-semibold">{r.name}</p>
                          {r.isHolding && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">보유중</span>
                          )}
                        </div>
                        <p className="text-gray-500 text-xs mt-0.5">{r.tradeCount}회 거래 · 투자 {formatKRW(r.totalSpent)}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                        {pos ? '+' : ''}{formatKRW(Math.round(r.netPnl))}
                        <span className="ml-1 text-xs">({pos ? '+' : ''}{r.pnlPct.toFixed(2)}%)</span>
                      </p>
                      <p className={`text-xs mt-0.5 ${beatBh >= 0 ? 'text-gray-400' : 'text-gray-500'}`}>
                        바이앤홀드 {r.bhPct >= 0 ? '+' : ''}{r.bhPct.toFixed(2)}%
                        <span className={`ml-1 font-semibold ${beatBh >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                          ({beatBh >= 0 ? '+' : ''}{beatBh.toFixed(2)}% {beatBh >= 0 ? '초과' : '미달'})
                        </span>
                      </p>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* 현금 잔고 */}
      <section>
        <h2 className="text-white font-semibold mb-3">최종 현금</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-gray-400 text-sm">미투자 현금</span>
          <span className="text-white font-semibold">{formatKRW(cash)}</span>
        </div>
      </section>

      <div className="flex gap-3">
        <Link
          to="/history"
          className="flex-1 py-3 text-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors"
        >
          목록으로
        </Link>
        <Link
          to="/history/portfolio"
          className="flex-1 py-3 text-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors"
        >
          포트폴리오 상세
        </Link>
      </div>
    </main>
  )
}
