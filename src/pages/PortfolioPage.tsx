import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { fetchQuotes, type QuoteResult } from '../api/yahooFinance'
import Portfolio from '../components/Portfolio'
import { formatKRW, formatChangePercent, changeColor } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

export default function PortfolioPage() {
  const { cash, holdings } = useGameStore()
  const [quotes, setQuotes] = useState<Record<string, QuoteResult>>({})
  const [loading, setLoading] = useState(false)

  const holdingSymbols = Object.keys(holdings)

  const symbolsKey = holdingSymbols.join(',')

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      setQuotes({})
      return
    }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const data = await fetchQuotes(holdingSymbols)
        if (!cancelled) {
          setQuotes(Object.fromEntries(data.map((q) => [q.symbol, q])))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey])

  const stockValue = Object.values(holdings).reduce((sum, h) => {
    const price = quotes[h.symbol]?.regularMarketPrice ?? h.avgPrice
    return sum + price * h.quantity
  }, 0)

  const totalAsset = cash + stockValue
  const profitAmount = totalAsset - INITIAL_CASH
  const profitRate = (profitAmount / INITIAL_CASH) * 100

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-white text-xl font-bold">포트폴리오</h1>

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

      <Portfolio quotes={quotes} />
    </main>
  )
}
