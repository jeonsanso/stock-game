import { useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { formatKRW, formatNumber } from '../utils/format'

interface TradePanelProps {
  symbol: string
  name: string
  price: number
}

export default function TradePanel({ symbol, name, price }: TradePanelProps) {
  const { cash, holdings, buy, sell } = useGameStore()
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const holding = holdings[symbol]
  const quantity = parseInt(qty) || 0
  const total = price * quantity
  const maxBuy = Math.floor(cash / price)
  const maxSell = holding?.quantity ?? 0

  const handleSubmit = () => {
    setMessage(null)
    if (quantity <= 0) {
      setMessage({ text: '수량을 입력하세요.', ok: false })
      return
    }
    const err = mode === 'buy' ? buy(symbol, name, price, quantity) : sell(symbol, name, price, quantity)
    if (err) {
      setMessage({ text: err, ok: false })
    } else {
      setMessage({ text: mode === 'buy' ? '매수 완료!' : '매도 완료!', ok: true })
      setQty('')
      setTimeout(() => setMessage(null), 2500)
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex rounded-lg overflow-hidden border border-gray-700 mb-4">
        <button
          onClick={() => { setMode('buy'); setQty(''); setMessage(null) }}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${
            mode === 'buy' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          매수
        </button>
        <button
          onClick={() => { setMode('sell'); setQty(''); setMessage(null) }}
          className={`flex-1 py-2 text-sm font-semibold transition-colors ${
            mode === 'sell' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          매도
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between text-xs text-gray-500">
          <span>현재가</span>
          <span className="text-white font-medium">{formatKRW(price)}</span>
        </div>

        <div className="flex justify-between text-xs text-gray-500">
          <span>{mode === 'buy' ? '주문 가능 금액' : '보유 수량'}</span>
          <span className="text-white font-medium">
            {mode === 'buy' ? formatKRW(cash) : `${formatNumber(maxSell)}주`}
          </span>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="수량 입력"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={() => setQty(String(mode === 'buy' ? maxBuy : maxSell))}
              className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors whitespace-nowrap"
            >
              최대
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            {[10, 25, 50].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  const max = mode === 'buy' ? maxBuy : maxSell
                  setQty(String(Math.floor(max * pct / 100)))
                }}
                className="flex-1 text-xs py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-800">
          <span>주문 금액</span>
          <span className="text-white font-semibold">{formatKRW(total)}</span>
        </div>

        {message && (
          <p className={`text-xs text-center py-1.5 rounded-lg ${message.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {message.text}
          </p>
        )}

        <button
          onClick={handleSubmit}
          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${
            mode === 'buy'
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {mode === 'buy' ? '매수하기' : '매도하기'}
        </button>

        {holding && (
          <div className="text-xs text-gray-500 text-center">
            보유 {formatNumber(holding.quantity)}주 · 평균 {formatKRW(holding.avgPrice)}
          </div>
        )}
      </div>
    </div>
  )
}
