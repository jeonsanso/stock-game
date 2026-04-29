import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Header from './components/Header'
import HomePage from './pages/HomePage'
import StockPage from './pages/StockPage'
import PortfolioPage from './pages/PortfolioPage'
import { useGameStore } from './store/gameStore'
import { fetchQuotes } from './api/yahooFinance'

function AppLayout() {
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
        <Route path="/" element={<HomePage />} />
        <Route path="/stock/:symbol" element={<StockPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}
