import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCandlesCached, getCandleAt, type CandleBar } from '../api/yahooFinance'
import { WATCHLIST } from '../api/constants'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatChange, formatChangePercent, changeColor, changeBg } from '../utils/format'
import StockSearch from '../components/StockSearch'

interface StockCardData {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  loading: boolean
}

export default function HistoryHomePage() {
  const { gameDate } = useHistoryStore()
  const [cards, setCards] = useState<StockCardData[]>(
    WATCHLIST.map((w) => ({ symbol: w.symbol, name: w.name, price: 0, change: 0, changePct: 0, loading: true })),
  )

  useEffect(() => {
    const cutoffSec = Math.floor(gameDate / 1000)

    WATCHLIST.forEach((stock, idx) => {
      fetchCandlesCached(stock.symbol, '1y')
        .then((candles: CandleBar[]) => {
          const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
          const current = candles[currentIdx]
          const prev = candles[currentIdx - 1]

          if (!current) {
            setCards((prev_) =>
              prev_.map((c, i) =>
                i === idx ? { ...c, loading: false } : c,
              ),
            )
            return
          }

          const change = prev ? current.close - prev.close : 0
          const changePct = prev && prev.close > 0 ? (change / prev.close) * 100 : 0

          setCards((prev_) =>
            prev_.map((c, i) =>
              i === idx
                ? { ...c, price: current.close, change, changePct, loading: false }
                : c,
            ),
          )
        })
        .catch(() => {
          setCards((prev_) =>
            prev_.map((c, i) => (i === idx ? { ...c, loading: false } : c)),
          )
        })
    })
  // gameDate가 바뀔 때마다 재계산 (캔들은 캐시됨)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameDate])

  const gameDateStr = new Date(gameDate).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const kospi = cards.filter((c) => c.symbol.endsWith('.KS'))
  const kosdaq = cards.filter((c) => c.symbol.endsWith('.KQ'))

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-white text-xl font-bold">역사 시뮬레이션</h1>
          <p className="text-gray-500 text-sm mt-1">
            <span className="text-amber-400 font-medium">{gameDateStr}</span> 기준 종가
          </p>
        </div>
        <StockSearch basePath="/history/stock" />
      </section>

      {kospi.length > 0 && (
        <section>
          <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">KOSPI</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {kospi.map((c) => (
              <HistoryStockCard key={c.symbol} data={c} />
            ))}
          </div>
        </section>
      )}

      {kosdaq.length > 0 && (
        <section>
          <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">KOSDAQ</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {kosdaq.map((c) => (
              <HistoryStockCard key={c.symbol} data={c} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}

function HistoryStockCard({ data }: { data: StockCardData }) {
  return (
    <Link
      to={`/history/stock/${encodeURIComponent(data.symbol)}`}
      className="block bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-xl p-4 transition-all"
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-white font-semibold text-sm">{data.name}</p>
          <p className="text-gray-500 text-xs mt-0.5">{data.symbol}</p>
        </div>
        {data.loading ? (
          <div className="w-12 h-5 bg-gray-700 rounded-full animate-pulse" />
        ) : (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${changeBg(data.changePct)}`}>
            {formatChangePercent(data.changePct)}
          </span>
        )}
      </div>
      <div className="flex justify-between items-end">
        {data.loading ? (
          <>
            <div className="w-24 h-6 bg-gray-700 rounded animate-pulse" />
            <div className="w-12 h-4 bg-gray-700 rounded animate-pulse" />
          </>
        ) : (
          <>
            <p className="text-white text-lg font-bold">{data.price > 0 ? formatKRW(data.price) : '—'}</p>
            <p className={`text-sm font-medium ${changeColor(data.change)}`}>
              {data.price > 0 ? formatChange(data.change) : ''}
            </p>
          </>
        )}
      </div>
    </Link>
  )
}
