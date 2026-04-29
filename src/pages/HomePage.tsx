import { useEffect, useState } from 'react'
import { fetchQuotes, type QuoteResult } from '../api/yahooFinance'
import { WATCHLIST } from '../api/constants'
import StockSearch from '../components/StockSearch'
import StockQuote from '../components/StockQuote'

const symbolNameMap = Object.fromEntries(WATCHLIST.map((w) => [w.symbol, w.name]))

export default function HomePage() {
  const [quotes, setQuotes] = useState<QuoteResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchQuotes(WATCHLIST.map((w) => w.symbol))
      setQuotes(data)
    } catch {
      setError('시세를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [])

  const kospi = quotes.filter((q) => q.symbol.endsWith('.KS'))
  const kosdaq = quotes.filter((q) => q.symbol.endsWith('.KQ') || q.symbol.endsWith('.KQ'))

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-white text-xl font-bold">한국 주식 모의 투자</h1>
          <p className="text-gray-500 text-sm mt-1">KOSPI · KOSDAQ 실시간 시세 기반</p>
        </div>
        <StockSearch />
      </section>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={load} className="text-xs underline">재시도</button>
        </div>
      )}

      {loading && quotes.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="bg-gray-800 border border-gray-700 rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <>
          {kospi.length > 0 && (
            <section>
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">KOSPI</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {kospi.map((q) => (
                  <StockQuote key={q.symbol} quote={q} name={symbolNameMap[q.symbol]} />
                ))}
              </div>
            </section>
          )}

          {kosdaq.length > 0 && (
            <section>
              <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">KOSDAQ</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {kosdaq.map((q) => (
                  <StockQuote key={q.symbol} quote={q} name={symbolNameMap[q.symbol]} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  )
}
