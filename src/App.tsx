import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Header from './components/Header'
import HistoryHeader from './components/HistoryHeader'
import ModeSelectPage from './pages/ModeSelectPage'
import HomePage from './pages/HomePage'
import StockPage from './pages/StockPage'
import PortfolioPage from './pages/PortfolioPage'
import HistoryHomePage from './pages/HistoryHomePage'
import HistoryStockPage from './pages/HistoryStockPage'
import HistoryPortfolioPage from './pages/HistoryPortfolioPage'
import HistoryResultsPage from './pages/HistoryResultsPage'
import { useGameStore } from './store/gameStore'
import { useHistoryStore } from './store/historyStore'
import { fetchQuotes, fetchCandlesCached, getPriceAt } from './api/yahooFinance'

// 실시간 모의투자 레이아웃
function RealtimeLayout() {
  const { cash, holdings } = useGameStore()
  const [stockValue, setStockValue] = useState(0)

  useEffect(() => {
    const symbols = Object.keys(holdings)
    if (symbols.length === 0) {
      setStockValue(0)
      return
    }
    let cancelled = false
    fetchQuotes(symbols)
      .then((quotes) => {
        if (cancelled) return
        const val = quotes.reduce((sum, q) => {
          const h = holdings[q.symbol]
          return sum + (h ? q.regularMarketPrice * h.quantity : 0)
        }, 0)
        setStockValue(val)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [holdings])

  const totalAsset = cash + stockValue

  return (
    <div className="min-h-screen bg-slate-950">
      <Header totalAsset={totalAsset} />
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="stock/:symbol" element={<StockPage />} />
        <Route path="portfolio" element={<PortfolioPage />} />
      </Routes>
    </div>
  )
}

// 역사 시뮬레이션 레이아웃
function HistoryLayout() {
  const { cash, holdings, gameDate } = useHistoryStore()
  const [stockValue, setStockValue] = useState(0)

  useEffect(() => {
    const symbols = Object.keys(holdings)
    if (symbols.length === 0) {
      setStockValue(0)
      return
    }
    let cancelled = false
    Promise.all(symbols.map((sym) => fetchCandlesCached(sym, '1y')))
      .then((allCandles) => {
        if (cancelled) return
        const val = symbols.reduce((sum, sym, i) => {
          const h = holdings[sym]
          const price = getPriceAt(allCandles[i], gameDate) ?? h.avgPrice
          return sum + price * h.quantity
        }, 0)
        setStockValue(val)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [holdings, gameDate])

  const totalAsset = cash + stockValue

  return (
    <div className="min-h-screen bg-slate-950">
      <HistoryHeader totalAsset={totalAsset} />
      <Routes>
        <Route index element={<HistoryHomePage />} />
        <Route path="stock/:symbol" element={<HistoryStockPage />} />
        <Route path="portfolio" element={<HistoryPortfolioPage />} />
        <Route path="results" element={<HistoryResultsPage />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ModeSelectPage />} />
        <Route path="/realtime/*" element={<RealtimeLayout />} />
        <Route path="/history/*" element={<HistoryLayout />} />
      </Routes>
    </BrowserRouter>
  )
}
