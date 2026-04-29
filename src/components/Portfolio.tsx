import { Link } from 'react-router-dom'
import { useGameStore, type TradeRecord } from '../store/gameStore'
import { formatKRW, formatNumber, formatChangePercent, formatChange, changeColor, changeBg } from '../utils/format'
import type { QuoteResult } from '../api/yahooFinance'

interface PortfolioProps {
  quotes: Record<string, QuoteResult>
}

export default function Portfolio({ quotes }: PortfolioProps) {
  const { holdings, tradeHistory } = useGameStore()
  const holdingList = Object.values(holdings)

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-white font-semibold mb-3">보유 종목</h2>
        {holdingList.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 text-sm">
            보유 중인 종목이 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {holdingList.map((h) => {
              const currentPrice = quotes[h.symbol]?.regularMarketPrice ?? 0
              const evalAmt = currentPrice * h.quantity
              const profit = evalAmt - h.avgPrice * h.quantity
              const profitRate = h.avgPrice > 0 ? (profit / (h.avgPrice * h.quantity)) * 100 : 0

              return (
                <Link
                  key={h.symbol}
                  to={`/realtime/stock/${encodeURIComponent(h.symbol)}`}
                  className="flex items-center justify-between bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors"
                >
                  <div>
                    <p className="text-white text-sm font-semibold">{h.name}</p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      {formatNumber(h.quantity)}주 · 평균 {formatKRW(h.avgPrice)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-white text-sm font-semibold">{formatKRW(evalAmt)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${changeBg(profitRate)}`}>
                      {formatChange(profit)} ({formatChangePercent(profitRate)})
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-white font-semibold mb-3">거래 내역</h2>
        {tradeHistory.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500 text-sm">
            거래 내역이 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {tradeHistory.slice(0, 30).map((t: TradeRecord) => (
              <div
                key={t.id}
                className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      t.type === 'buy' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
                    }`}
                  >
                    {t.type === 'buy' ? '매수' : '매도'}
                  </span>
                  <div>
                    <p className="text-white text-sm font-medium">{t.name}</p>
                    <p className="text-gray-500 text-xs">
                      {formatNumber(t.quantity)}주 @ {formatKRW(t.price)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${changeColor(t.type === 'buy' ? -1 : 1)}`}>
                    {t.type === 'buy' ? '-' : '+'}{formatKRW(t.total)}
                  </p>
                  <p className="text-gray-600 text-xs">
                    {new Date(t.timestamp).toLocaleDateString('ko-KR')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
