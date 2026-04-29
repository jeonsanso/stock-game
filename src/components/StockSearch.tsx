import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchSymbols, type SearchResult } from '../api/yahooFinance'

export default function StockSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await searchSymbols(query)
        const filtered = data.filter(
          (r) => r.typeDisp === 'Equity' && (r.symbol.endsWith('.KS') || r.symbol.endsWith('.KQ')),
        )
        setResults(filtered)
        setOpen(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)
  }, [query])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (symbol: string) => {
    setQuery('')
    setOpen(false)
    navigate(`/stock/${encodeURIComponent(symbol)}`)
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="종목명 또는 티커 검색 (예: 삼성, 005930)"
          className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">검색 중...</span>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl z-50">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                onClick={() => handleSelect(r.symbol)}
                className="w-full flex justify-between items-center px-4 py-3 hover:bg-gray-700 transition-colors text-left"
              >
                <div>
                  <p className="text-white text-sm font-medium">{r.shortname}</p>
                  <p className="text-gray-500 text-xs">{r.symbol}</p>
                </div>
                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">
                  {r.exchDisp}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && results.length === 0 && !loading && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-500 shadow-xl z-50">
          검색 결과가 없습니다.
        </div>
      )}
    </div>
  )
}
