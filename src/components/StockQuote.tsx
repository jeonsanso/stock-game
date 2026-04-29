import { Link } from 'react-router-dom'
import type { QuoteResult } from '../api/yahooFinance'
import { formatKRW, formatChange, formatChangePercent, changeColor, changeBg } from '../utils/format'

interface StockQuoteProps {
  quote: QuoteResult
  name?: string
}

export default function StockQuote({ quote, name }: StockQuoteProps) {
  return (
    <Link
      to={`/realtime/stock/${encodeURIComponent(quote.symbol)}`}
      className="block bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600 rounded-xl p-4 transition-all"
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="text-white font-semibold text-sm">{name ?? quote.shortName}</p>
          <p className="text-gray-500 text-xs mt-0.5">{quote.symbol}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${changeBg(quote.regularMarketChangePercent)}`}>
          {formatChangePercent(quote.regularMarketChangePercent)}
        </span>
      </div>
      <div className="flex justify-between items-end">
        <p className="text-white text-lg font-bold">{formatKRW(quote.regularMarketPrice)}</p>
        <p className={`text-sm font-medium ${changeColor(quote.regularMarketChange)}`}>
          {formatChange(quote.regularMarketChange)}
        </p>
      </div>
    </Link>
  )
}
