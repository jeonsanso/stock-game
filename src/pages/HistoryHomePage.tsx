import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCandlesCached, getCandleAt, type CandleBar } from '../api/yahooFinance'
import { WATCHLIST } from '../api/constants'
import { SYNTHETIC_STOCKS, ALTERNATE_STOCKS, getSyntheticCandles } from '../api/syntheticStocks'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatChange, formatChangePercent, changeColor, changeBg } from '../utils/format'
import StockSearch from '../components/StockSearch'
import SaveLoadPanel from '../components/SaveLoadPanel'

const ALL_SYNTHETIC = [...SYNTHETIC_STOCKS, ...ALTERNATE_STOCKS]

interface StockCardData {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  loading: boolean
}

export default function HistoryHomePage() {
  const { stockPositions, startDate, completedStocks, customSymbols, removeCustomSymbol } = useHistoryStore()
  const [cards, setCards] = useState<StockCardData[]>(
    WATCHLIST.map((w) => ({ symbol: w.symbol, name: w.name, price: 0, change: 0, changePct: 0, loading: true })),
  )
  const [syntheticCards, setSyntheticCards] = useState<StockCardData[]>([])
  const [customCards, setCustomCards] = useState<StockCardData[]>([])

  // 완료되지 않은 합성 종목 앞 10개
  const activeStocks = ALL_SYNTHETIC.filter((s) => !completedStocks.includes(s.symbol)).slice(0, 10)

  useEffect(() => {
    WATCHLIST.forEach((stock, idx) => {
      const gameDate = stockPositions[stock.symbol] ?? startDate
      fetchCandlesCached(stock.symbol, '1y')
        .then((candles: CandleBar[]) => {
          const cutoffSec = Math.floor(gameDate / 1000)
          const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
          const current = candles[currentIdx]
          const prev = candles[currentIdx - 1]

          if (!current) {
            setCards((prev_) =>
              prev_.map((c, i) => i === idx ? { ...c, loading: false } : c),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stockPositions), startDate])

  useEffect(() => {
    setSyntheticCards(activeStocks.map((stock) => {
      const gameDate = stockPositions[stock.symbol] ?? startDate
      const cutoffSec = Math.floor(gameDate / 1000)
      const candles = getSyntheticCandles(stock.symbol)
      const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
      const current = candles[currentIdx]
      const prev = candles[currentIdx - 1]
      if (!current) return { symbol: stock.symbol, name: stock.name, price: 0, change: 0, changePct: 0, loading: false }
      const change = prev ? current.close - prev.close : 0
      const changePct = prev && prev.close > 0 ? (change / prev.close) * 100 : 0
      return { symbol: stock.symbol, name: stock.name, price: current.close, change, changePct, loading: false }
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(activeStocks.map(s => s.symbol)), JSON.stringify(stockPositions)])

  // 검색 등록 종목 가격 로드
  const customEntries = Object.entries(customSymbols)
  useEffect(() => {
    if (customEntries.length === 0) { setCustomCards([]); return }
    const loading = customEntries.map(([sym, nm]) => ({ symbol: sym, name: nm, price: 0, change: 0, changePct: 0, loading: true }))
    setCustomCards(loading)
    customEntries.forEach(([sym, nm], idx) => {
      const gameDate = stockPositions[sym] ?? startDate
      fetchCandlesCached(sym, '1y')
        .then((candles: CandleBar[]) => {
          const cutoffSec = Math.floor(gameDate / 1000)
          const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
          const current = candles[currentIdx]
          const prev = candles[currentIdx - 1]
          if (!current) { setCustomCards(p => p.map((c, i) => i === idx ? { ...c, loading: false } : c)); return }
          const change = prev ? current.close - prev.close : 0
          const changePct = prev && prev.close > 0 ? (change / prev.close) * 100 : 0
          setCustomCards(p => p.map((c, i) => i === idx ? { ...c, price: current.close, change, changePct, loading: false } : c))
        })
        .catch(() => setCustomCards(p => p.map((c, i) => i === idx ? { ...c, loading: false } : c)))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(customSymbols), JSON.stringify(stockPositions)])

  const kospi = cards.filter((c) => c.symbol.endsWith('.KS'))
  const kosdaq = cards.filter((c) => c.symbol.endsWith('.KQ'))

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-white text-xl font-bold">역사 시뮬레이션</h1>
          <p className="text-gray-400 text-sm mt-1">종목별로 독립적으로 시간을 이동하며 거래하세요</p>
        </div>
        <div className="flex items-center gap-2">
          <SaveLoadPanel />
          <StockSearch basePath="/history/stock" />
        </div>
      </section>

      {completedStocks.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            완료된 종목 <span className="text-white font-semibold">{completedStocks.length}개</span>
            {ALL_SYNTHETIC.length - completedStocks.length > 0 && (
              <span className="text-gray-500 ml-2">· 남은 종목 {Math.max(0, ALL_SYNTHETIC.filter(s => !completedStocks.includes(s.symbol)).length)}개</span>
            )}
          </p>
          <Link to="/history/portfolio" className="text-indigo-400 text-xs hover:text-indigo-300 transition-colors">
            포트폴리오 →
          </Link>
        </div>
      )}

      {customCards.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">내 종목</h2>
            <span className="text-xs text-gray-400">· 직접 검색해서 추가한 종목</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {customCards.map((c) => (
              <HistoryStockCard key={c.symbol} data={c} onRemove={() => removeCustomSymbol(c.symbol)} />
            ))}
          </div>
        </section>
      )}

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

      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">랜덤 종목</h2>
          <span className="text-xs text-gray-400">· 현재 날짜까지 거래하면 결과를 확인할 수 있어요</span>
        </div>
        {activeStocks.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-400 text-sm">
            모든 종목을 완료했습니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {syntheticCards.map((c) => (
              <HistoryStockCard key={c.symbol} data={c} />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function HistoryStockCard({ data, onRemove }: { data: StockCardData; onRemove?: () => void }) {
  return (
    <div className="relative group">
      <Link
        to={`/history/stock/${encodeURIComponent(data.symbol)}`}
        className="block bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-xl p-4 transition-all"
      >
        <div className="flex justify-between items-start mb-2">
          <div className="min-w-0 flex-1 mr-2">
            <p className="text-white font-semibold text-sm truncate">{data.name}</p>
            <p className="text-gray-400 text-xs mt-0.5">{data.symbol}</p>
          </div>
          {data.loading ? (
            <div className="w-12 h-5 bg-gray-700 rounded-full animate-pulse shrink-0" />
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${changeBg(data.changePct)}`}>
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
      {onRemove && (
        <button
          onClick={(e) => { e.preventDefault(); onRemove() }}
          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-700 hover:bg-red-500/60 text-gray-400 hover:text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
          title="목록에서 제거"
        >
          ×
        </button>
      )}
    </div>
  )
}
