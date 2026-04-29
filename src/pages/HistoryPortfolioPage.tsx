import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCandlesCached, getPriceAt, type CandleBar } from '../api/yahooFinance'
import { useHistoryStore, type TradeRecord } from '../store/historyStore'
import { formatKRW, formatNumber, formatChangePercent, formatChange, changeColor, changeBg } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

export default function HistoryPortfolioPage() {
  const { cash, holdings, tradeHistory, gameDate } = useHistoryStore()
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  const holdingSymbols = Object.keys(holdings)
  const symbolsKey = holdingSymbols.join(',')

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      setPriceMap({})
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      holdingSymbols.map((sym) =>
        fetchCandlesCached(sym, '1y').then((candles: CandleBar[]) => {
          const price = getPriceAt(candles, gameDate)
          return [sym, price ?? 0] as const
        }),
      ),
    )
      .then((entries) => {
        if (!cancelled) setPriceMap(Object.fromEntries(entries))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, gameDate])

  const stockValue = Object.values(holdings).reduce((sum, h) => {
    const price = priceMap[h.symbol] ?? h.avgPrice
    return sum + price * h.quantity
  }, 0)

  const totalAsset = cash + stockValue
  const profitAmount = totalAsset - INITIAL_CASH
  const profitRate = (profitAmount / INITIAL_CASH) * 100

  const gameDateStr = new Date(gameDate).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-white text-xl font-bold">포트폴리오</h1>
        <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold px-2.5 py-1 rounded-full">
          {gameDateStr} 기준
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 col-span-2 sm:col-span-1">
          <p className="text-gray-500 text-xs mb-1">총 자산</p>
          <p className="text-white text-lg font-bold">{formatKRW(totalAsset)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-500 text-xs mb-1">현금</p>
          <p className="text-white font-semibold">{formatKRW(cash)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-500 text-xs mb-1">주식 평가액</p>
          <p className="text-white font-semibold">{loading ? '...' : formatKRW(stockValue)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <p className="text-gray-500 text-xs mb-1">총 수익률</p>
          <p className={`font-bold text-lg ${changeColor(profitRate)}`}>
            {formatChangePercent(profitRate)}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="text-white font-semibold mb-3">보유 종목</h2>
          {holdingSymbols.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 text-sm">
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
                      <p className="text-gray-500 text-xs mt-0.5">
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
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 text-sm">
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
                      <p className="text-gray-500 text-xs">
                        {formatNumber(t.quantity)}주 @ {formatKRW(t.price)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${changeColor(t.type === 'buy' ? -1 : 1)}`}>
                      {t.type === 'buy' ? '-' : '+'}{formatKRW(t.total)}
                    </p>
                    <p className="text-gray-600 text-xs">
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
