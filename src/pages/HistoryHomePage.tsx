import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchCandlesCached, fetchFinanceSummary, type FinanceSummary } from '../api/yahooFinance'
import { WATCHLIST } from '../api/constants'
import { SYNTHETIC_STOCKS, ALTERNATE_STOCKS } from '../api/syntheticStocks'
import { useHistoryStore, type TradeRecord } from '../store/historyStore'
import { formatKRW, formatChange, formatChangePercent, changeColor, changeBg, formatProfit } from '../utils/format'
import StockSearch from '../components/StockSearch'
import SaveLoadPanel from '../components/SaveLoadPanel'
import { syncTrades, loadTrades, isMigrated, markMigrated } from '../api/historyApi'

const ALL_SYNTHETIC = [...SYNTHETIC_STOCKS, ...ALTERNATE_STOCKS]

interface StockCardData {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  loading: boolean
  finInfo?: FinanceSummary | null
}

export default function HistoryHomePage() {
  const { stockPositions, startDate, completedStocks, customSymbols, removeCustomSymbol, tradeHistory } = useHistoryStore()
  const [cards, setCards] = useState<StockCardData[]>(
    WATCHLIST.map((w) => ({ symbol: w.symbol, name: w.name, price: 0, change: 0, changePct: 0, loading: true })),
  )
  const [syntheticCards, setSyntheticCards] = useState<StockCardData[]>([])
  const [customCards, setCustomCards] = useState<StockCardData[]>([])
  const [archiveTrades, setArchiveTrades] = useState<TradeRecord[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)

  // 최초 1회: 기존 로컬 데이터 마이그레이션
  useEffect(() => {
    if (!isMigrated() && tradeHistory.length > 0) {
      syncTrades(tradeHistory)
        .then(() => markMigrated())
        .catch(() => {})
    } else if (!isMigrated()) {
      markMigrated()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 아카이브 섹션 열릴 때 서버에서 전체 이력 로드
  useEffect(() => {
    if (!archiveOpen) return
    loadTrades()
      .then(setArchiveTrades)
      .catch(() => {})
  }, [archiveOpen])

  const activeStocks = ALL_SYNTHETIC.filter((s) => !completedStocks.includes(s.symbol)).slice(0, 10)

  // WATCHLIST 가격 + 재무정보 fetch
  useEffect(() => {
    WATCHLIST.forEach((stock, idx) => {
      const gameDate = stockPositions[stock.symbol] ?? startDate
      Promise.all([
        fetchCandlesCached(stock.symbol, '1y'),
        fetchFinanceSummary(stock.symbol),
      ])
        .then(([candles, finInfo]) => {
          const cutoffSec = Math.floor(gameDate / 1000)
          const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
          const current = candles[currentIdx]
          const prev = candles[currentIdx - 1]
          if (!current) {
            setCards((p) => p.map((c, i) => i === idx ? { ...c, loading: false, finInfo } : c))
            return
          }
          const change = prev ? current.close - prev.close : 0
          const changePct = prev && prev.close > 0 ? (change / prev.close) * 100 : 0
          setCards((p) => p.map((c, i) =>
            i === idx ? { ...c, price: current.close, change, changePct, loading: false, finInfo } : c,
          ))
        })
        .catch(() => setCards((p) => p.map((c, i) => i === idx ? { ...c, loading: false } : c)))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stockPositions), startDate])

  // 랜덤 종목(실제 코스닥) 가격 + 재무정보 async fetch
  useEffect(() => {
    if (activeStocks.length === 0) { setSyntheticCards([]); return }
    setSyntheticCards(activeStocks.map((stock) => ({
      symbol: stock.symbol, name: stock.name, price: 0, change: 0, changePct: 0, loading: true,
    })))
    activeStocks.forEach((stock, idx) => {
      const gameDate = stockPositions[stock.symbol] ?? startDate
      Promise.all([
        fetchCandlesCached(stock.symbol, '1y'),
        fetchFinanceSummary(stock.symbol),
      ])
        .then(([candles, finInfo]) => {
          const cutoffSec = Math.floor(gameDate / 1000)
          const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
          const current = candles[currentIdx]
          const prev = candles[currentIdx - 1]
          if (!current) { setSyntheticCards((p) => p.map((c, i) => i === idx ? { ...c, loading: false, finInfo } : c)); return }
          const change = prev ? current.close - prev.close : 0
          const changePct = prev && prev.close > 0 ? (change / prev.close) * 100 : 0
          setSyntheticCards((p) => p.map((c, i) => i === idx ? { ...c, price: current.close, change, changePct, loading: false, finInfo } : c))
        })
        .catch(() => setSyntheticCards((p) => p.map((c, i) => i === idx ? { ...c, loading: false } : c)))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(activeStocks.map((s) => s.symbol)), JSON.stringify(stockPositions), startDate])

  // 검색 등록 종목 가격 + 재무정보 fetch
  const customEntries = Object.entries(customSymbols)
  useEffect(() => {
    if (customEntries.length === 0) { setCustomCards([]); return }
    setCustomCards(customEntries.map(([sym, nm]) => ({ symbol: sym, name: nm, price: 0, change: 0, changePct: 0, loading: true })))
    customEntries.forEach(([sym], idx) => {
      const gameDate = stockPositions[sym] ?? startDate
      Promise.all([
        fetchCandlesCached(sym, '1y'),
        fetchFinanceSummary(sym),
      ])
        .then(([candles, finInfo]) => {
          const cutoffSec = Math.floor(gameDate / 1000)
          const currentIdx = candles.findLastIndex((c) => c.time <= cutoffSec)
          const current = candles[currentIdx]
          const prev = candles[currentIdx - 1]
          if (!current) { setCustomCards((p) => p.map((c, i) => i === idx ? { ...c, loading: false, finInfo } : c)); return }
          const change = prev ? current.close - prev.close : 0
          const changePct = prev && prev.close > 0 ? (change / prev.close) * 100 : 0
          setCustomCards((p) => p.map((c, i) => i === idx ? { ...c, price: current.close, change, changePct, loading: false, finInfo } : c))
        })
        .catch(() => setCustomCards((p) => p.map((c, i) => i === idx ? { ...c, loading: false } : c)))
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
            {activeStocks.length > 0 && (
              <span className="text-gray-500 ml-2">
                · 남은 종목 {activeStocks.length}개
              </span>
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
      <section>
        <button
          onClick={() => setArchiveOpen((v) => !v)}
          className="w-full flex items-center justify-between text-gray-400 text-xs font-semibold uppercase tracking-wider hover:text-gray-200 transition-colors"
        >
          <span>전체 거래 이력 (백엔드 아카이브)</span>
          <span>{archiveOpen ? '▲ 접기' : '▼ 펼치기'}</span>
        </button>
        {archiveOpen && (
          <div className="mt-3 space-y-2">
            {archiveTrades.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center text-gray-500 text-sm">
                저장된 거래 이력이 없습니다.
              </div>
            ) : (
              <>
                <p className="text-gray-500 text-xs">총 {archiveTrades.length}건 · 초기화 후에도 유지됩니다</p>
                <div className="space-y-1.5 max-h-96 overflow-y-auto">
                  {[...archiveTrades].reverse().map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                          t.type === 'buy' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                        }`}>
                          {t.type === 'buy' ? '매수' : '매도'}
                        </span>
                        <div>
                          <p className="text-white text-sm font-medium">{t.name}</p>
                          <p className="text-gray-400 text-xs">
                            {t.quantity}주 @ {formatKRW(t.price)} · {new Date(t.timestamp).toLocaleDateString('ko-KR')}
                          </p>
                        </div>
                      </div>
                      <p className={`text-sm font-semibold ${t.type === 'buy' ? 'text-red-400' : 'text-blue-400'}`}>
                        {t.type === 'buy' ? '-' : '+'}{formatKRW(t.total)}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
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
        {!data.loading && data.finInfo != null && (
          <div className="mt-2 pt-2 border-t border-gray-700 flex items-center justify-between">
            <span className={`text-xs font-semibold ${data.finInfo.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {data.finInfo.profit >= 0 ? '흑자' : '적자'}
            </span>
            <span className="text-xs text-gray-400">
              영업이익 {formatProfit(data.finInfo.profit)} ({data.finInfo.year})
            </span>
          </div>
        )}
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
