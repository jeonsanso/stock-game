import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { fetchQuoteDetail, type QuoteResult } from '../api/yahooFinance'
import { WATCHLIST } from '../api/constants'
import StockChart from '../components/StockChart'
import TradePanel from '../components/TradePanel'
import { formatKRW, formatNumber, formatChangePercent, formatChange, changeColor, changeBg } from '../utils/format'

const symbolNameMap = Object.fromEntries(WATCHLIST.map((w) => [w.symbol, w.name]))

export default function StockPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const decoded = symbol ? decodeURIComponent(symbol) : ''
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!decoded) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchQuoteDetail(decoded)
      setQuote(data)
    } catch {
      setError('시세를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded])

  const name = symbolNameMap[decoded] ?? quote?.shortName ?? decoded

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      <Link to="/realtime" className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-flex items-center gap-1 transition-colors">
        ← 목록으로
      </Link>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="mt-4 mb-6">
        {loading && !quote ? (
          <div className="animate-pulse space-y-2">
            <div className="h-7 w-40 bg-gray-800 rounded" />
            <div className="h-9 w-56 bg-gray-800 rounded" />
          </div>
        ) : quote ? (
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-white text-2xl font-bold">{name}</h1>
                <span className="text-gray-500 text-sm">{decoded}</span>
              </div>
              <div className="flex items-end gap-3">
                <span className="text-white text-3xl font-bold">{formatKRW(quote.regularMarketPrice)}</span>
                <span className={`text-lg font-semibold ${changeColor(quote.regularMarketChange)}`}>
                  {formatChange(quote.regularMarketChange)}
                </span>
                <span className={`text-sm px-2.5 py-0.5 rounded-full font-medium ${changeBg(quote.regularMarketChangePercent)}`}>
                  {formatChangePercent(quote.regularMarketChangePercent)}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {quote && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: '시가', value: formatKRW(quote.regularMarketOpen) },
              { label: '고가', value: formatKRW(quote.regularMarketDayHigh) },
              { label: '저가', value: formatKRW(quote.regularMarketDayLow) },
              { label: '거래량', value: `${formatNumber(quote.regularMarketVolume)}주` },
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
          <StockChart symbol={decoded} />
        </div>
        <div>
          {quote ? (
            <TradePanel symbol={decoded} name={name} price={quote.regularMarketPrice} />
          ) : (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse h-64" />
          )}
        </div>
      </div>
    </main>
  )
}
