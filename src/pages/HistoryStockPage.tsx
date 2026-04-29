import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchCandlesCached, getCandleAt, type CandleBar } from '../api/yahooFinance'
import { WATCHLIST } from '../api/constants'
import { useHistoryStore } from '../store/historyStore'
import StockChart from '../components/StockChart'
import HistoryTradePanel from '../components/HistoryTradePanel'
import { formatKRW, formatNumber, formatChangePercent, formatChange, changeColor, changeBg } from '../utils/format'

const symbolNameMap = Object.fromEntries(WATCHLIST.map((w) => [w.symbol, w.name]))

export default function HistoryStockPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const decoded = symbol ? decodeURIComponent(symbol) : ''

  const { gameDate, tradeHistory } = useHistoryStore()

  const [allCandles, setAllCandles] = useState<CandleBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!decoded) return
    setLoading(true)
    setError(null)
    fetchCandlesCached(decoded, '1y')
      .then((candles) => {
        setAllCandles(candles)
      })
      .catch(() => setError('데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [decoded])

  const cutoffSec = Math.floor(gameDate / 1000)
  const visibleCandles = allCandles.filter((c) => c.time <= cutoffSec)

  const nextTradingDateMs = (() => {
    const next = allCandles.find((c) => c.time > cutoffSec)
    return next ? next.time * 1000 : gameDate + 86_400_000
  })()

  const currentCandle = getCandleAt(allCandles, gameDate)
  const currentIdx = allCandles.findLastIndex((c) => c.time <= cutoffSec)
  const prevCandle = currentIdx > 0 ? allCandles[currentIdx - 1] : null

  const price = currentCandle?.close ?? null
  const change = price != null && prevCandle ? price - prevCandle.close : null
  const changePct =
    change != null && prevCandle && prevCandle.close > 0
      ? (change / prevCandle.close) * 100
      : null

  const name = symbolNameMap[decoded] ?? decoded
  const today = Date.now()
  const isEnded = gameDate >= today

  const gameDateStr = new Date(gameDate).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <Link
        to="/history"
        className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-flex items-center gap-1 transition-colors"
      >
        ← 목록으로
      </Link>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!isEnded && (
        <div className="mt-3 mb-1 inline-flex items-center gap-2">
          <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-semibold px-2.5 py-1 rounded-full">
            {gameDateStr} 기준
          </span>
        </div>
      )}

      <div className="mt-2 mb-6">
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-7 w-40 bg-gray-800 rounded" />
            <div className="h-9 w-56 bg-gray-800 rounded" />
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-white text-2xl font-bold">{name}</h1>
                <span className="text-gray-500 text-sm">{decoded}</span>
              </div>
              {price != null ? (
                <div className="flex items-end gap-3">
                  <span className="text-white text-3xl font-bold">{formatKRW(price)}</span>
                  {change != null && (
                    <span className={`text-lg font-semibold ${changeColor(change)}`}>
                      {formatChange(change)}
                    </span>
                  )}
                  {changePct != null && (
                    <span className={`text-sm px-2.5 py-0.5 rounded-full font-medium ${changeBg(changePct)}`}>
                      {formatChangePercent(changePct)}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">해당 날짜 데이터 없음</p>
              )}
            </div>
          </div>
        )}

        {currentCandle && !loading && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '시가', value: formatKRW(currentCandle.open) },
              { label: '고가', value: formatKRW(currentCandle.high) },
              { label: '저가', value: formatKRW(currentCandle.low) },
              { label: '거래량', value: `${formatNumber(currentCandle.volume)}주` },
            ].map((item) => (
              <div key={item.label} className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5">
                <p className="text-gray-500 text-xs mb-1">{item.label}</p>
                <p className="text-white text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <StockChart
            symbol={decoded}
            candles={visibleCandles}
            cutoffDate={gameDate}
            trades={tradeHistory
              .filter((t) => t.symbol === decoded)
              .map((t) => ({ type: t.type, timestamp: t.timestamp }))}
          />
        </div>
        <div>
          {!loading ? (
            <HistoryTradePanel
              symbol={decoded}
              name={name}
              price={price}
              gameDate={gameDate}
              nextTradingDateMs={nextTradingDateMs}
            />
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse h-64" />
          )}
        </div>
      </div>
    </main>
  )
}
