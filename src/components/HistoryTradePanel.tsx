import { useState } from 'react'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatNumber } from '../utils/format'
import { BUY_FEE_RATE, SELL_FEE_RATE } from '../api/constants'

interface HistoryTradePanelProps {
  symbol: string
  name: string
  price: number | null
  gameDate: number
  nextTradingDateMs: number
  startPrice?: number | null
  nextDayChangePct?: number | null
}

export default function HistoryTradePanel({ symbol, name, price, gameDate, nextTradingDateMs, startPrice, nextDayChangePct }: HistoryTradePanelProps) {
  const { cash, holdings, buy, sell, advanceTo, feeEnabled, toggleFee, tradeHistory } = useHistoryStore()
  const [mode, setMode] = useState<'buy' | 'sell'>('buy')
  const [qty, setQty] = useState('')
  const [message, setMessage] = useState<{ text: string; ok: boolean; changePct?: number } | null>(null)

  const today = Date.now()
  const isEnded = gameDate >= today

  const holding = holdings[symbol]
  const quantity = parseInt(qty) || 0
  const safePrice = price ?? 0
  const total = safePrice * quantity
  const feeRate = feeEnabled ? (mode === 'buy' ? BUY_FEE_RATE : SELL_FEE_RATE) : 0
  const fee = Math.round(total * feeRate)
  const totalWithFee = mode === 'buy' ? total + fee : total - fee
  const maxBuy = safePrice > 0 ? Math.floor(cash / (safePrice * (1 + (feeEnabled ? BUY_FEE_RATE : 0)))) : 0
  const maxSell = holding?.quantity ?? 0

  const handleSubmit = () => {
    if (isEnded) return
    setMessage(null)
    if (quantity <= 0) {
      setMessage({ text: '수량을 입력하세요.', ok: false })
      return
    }
    const err =
      mode === 'buy'
        ? buy(symbol, name, safePrice, quantity)
        : sell(symbol, name, safePrice, quantity)
    if (err) {
      setMessage({ text: err, ok: false })
      setTimeout(() => setMessage(null), 3000)
    } else {
      advanceTo(nextTradingDateMs)
      const nextDate = new Date(nextTradingDateMs).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
      setMessage({ text: `${mode === 'buy' ? '매수 완료' : '매도 완료'} · ${nextDate}로 이동`, ok: true, changePct: nextDayChangePct ?? undefined })
      setQty('')
    }
  }

  const handleHold = () => {
    if (isEnded) return
    advanceTo(nextTradingDateMs)
    const nextDate = new Date(nextTradingDateMs).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
    setMessage({ text: `홀드 · ${nextDate}로 이동`, ok: true, changePct: nextDayChangePct ?? undefined })
  }

  if (isEnded) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 text-center space-y-2">
        <p className="text-white font-bold text-lg">시뮬레이션 종료</p>
        <p className="text-gray-400 text-sm">현재 날짜에 도달했습니다.</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      {message && (
        <div className={`mb-3 px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between ${
          message.ok
            ? 'bg-gray-800 border border-gray-700 text-gray-200'
            : 'bg-red-500/15 border border-red-500/30 text-red-400'
        }`}>
          <span>{message.text}</span>
          {message.ok && message.changePct != null && (
            <span className={`text-sm font-bold tabular-nums ml-3 ${message.changePct >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
              {message.changePct >= 0 ? '▲' : '▼'} {Math.abs(message.changePct).toFixed(2)}%
            </span>
          )}
        </div>
      )}
      <button
        onClick={toggleFee}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs mb-3 transition-colors ${
          feeEnabled
            ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
        }`}
      >
        <span>거래 수수료</span>
        <span className="flex items-center gap-2">
          {feeEnabled && <span className="text-gray-400">매수 0.015% · 매도 0.215%</span>}
          <span className={`font-semibold ${feeEnabled ? 'text-indigo-300' : 'text-gray-500'}`}>
            {feeEnabled ? 'ON' : 'OFF'}
          </span>
        </span>
      </button>

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
        <div className="flex justify-between text-xs text-gray-400">
          <span>기준가 ({new Date(gameDate).toLocaleDateString('ko-KR')})</span>
          <span className="text-white font-medium">
            {price != null ? formatKRW(price) : '데이터 없음'}
          </span>
        </div>

        <div className="flex justify-between text-xs text-gray-400">
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
              onChange={(e) => { setQty(e.target.value); setMessage((m) => m?.ok ? null : m) }}
              placeholder="수량 입력"
              disabled={price == null}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
            />
            <button
              onClick={() => setQty(String(mode === 'buy' ? maxBuy : maxSell))}
              disabled={price == null}
              className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
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
                disabled={price == null}
                className="flex-1 text-xs py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors disabled:opacity-50"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        <div className="pt-1 border-t border-gray-800 space-y-1.5">
          {feeEnabled && fee > 0 && (
            <div className="flex justify-between text-xs text-gray-500">
              <span>수수료 ({(feeRate * 100).toFixed(3)}%)</span>
              <span>{mode === 'buy' ? '+' : '-'}{formatKRW(fee)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs text-gray-400">
            <span>{mode === 'buy' ? '실제 출금액' : '실제 입금액'}</span>
            <span className="text-white font-semibold">{formatKRW(totalWithFee)}</span>
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={price == null}
          className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${
            mode === 'buy'
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {mode === 'buy' ? '매수하기' : '매도하기'}
        </button>

        <button
          onClick={handleHold}
          className="w-full py-2 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
        >
          홀드 (다음 날로)
        </button>

        {holding && price != null && (() => {
          const effectiveCost = holding.avgPrice * (1 + (feeEnabled ? BUY_FEE_RATE : 0))
          const effectiveProceeds = price * (1 - (feeEnabled ? SELL_FEE_RATE : 0))
          const pnl = effectiveProceeds - effectiveCost
          const pnlPct = (pnl / effectiveCost) * 100
          const pnlTotal = pnl * holding.quantity
          const pos = pnl >= 0
          return (
            <div className={`rounded-xl px-3 py-2.5 text-xs space-y-1.5 ${pos ? 'bg-red-500/10 border border-red-500/20' : 'bg-blue-500/10 border border-blue-500/20'}`}>
              <div className="flex justify-between">
                <span className="text-gray-400">보유 수량</span>
                <span className="text-white font-medium">{formatNumber(holding.quantity)}주</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">평균 단가</span>
                <span className="text-white font-medium">
                  {formatKRW(holding.avgPrice)}
                  {feeEnabled && <span className="text-gray-500 ml-1">(수수료 포함 {formatKRW(Math.round(effectiveCost))})</span>}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-700 pt-1.5">
                <span className="text-gray-400">평가 손익</span>
                <span className={`font-bold ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : ''}{formatKRW(pnlTotal)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">수익률</span>
                <span className={`font-bold text-sm ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : ''}{pnlPct.toFixed(2)}%
                </span>
              </div>
              {startPrice != null && startPrice > 0 && price != null && (() => {
                const bhCost = startPrice * (1 + (feeEnabled ? BUY_FEE_RATE : 0))
                const bhProceeds = price * (1 - (feeEnabled ? SELL_FEE_RATE : 0))
                const bhPct = ((bhProceeds - bhCost) / bhCost) * 100
                const diff = pnlPct - bhPct
                return (
                  <div className="flex justify-between border-t border-gray-700 pt-1.5">
                    <span className="text-gray-400">바이앤홀드 대비</span>
                    <span className={`font-bold text-sm ${diff >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%
                      <span className="text-xs font-normal text-gray-500 ml-1">
                        ({diff >= 0 ? '초과수익' : '미달'})
                      </span>
                    </span>
                  </div>
                )
              })()}
            </div>
          )
        })()}

        {!holding && price != null && (() => {
          const symbolTrades = tradeHistory.filter((t) => t.symbol === symbol)
          const buys = symbolTrades.filter((t) => t.type === 'buy')
          const sells = symbolTrades.filter((t) => t.type === 'sell')
          if (buys.length === 0 || sells.length === 0) return null

          const totalSpent = buys.reduce((s, t) => s + t.total, 0)
          const totalReceived = sells.reduce((s, t) => s + t.total, 0)
          const realizedPnl = totalReceived - totalSpent
          const realizedPct = (realizedPnl / totalSpent) * 100
          const pos = realizedPnl >= 0

          return (
            <div className={`rounded-xl px-3 py-2.5 text-xs space-y-1.5 ${pos ? 'bg-red-500/10 border border-red-500/20' : 'bg-blue-500/10 border border-blue-500/20'}`}>
              <p className="text-gray-400 font-medium">매도 완료 결과</p>
              <div className="flex justify-between">
                <span className="text-gray-400">총 매수 금액</span>
                <span className="text-white">{formatKRW(totalSpent)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">총 매도 금액</span>
                <span className="text-white">{formatKRW(totalReceived)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-700 pt-1.5">
                <span className="text-gray-400">실현 손익</span>
                <span className={`font-bold ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : ''}{formatKRW(Math.round(realizedPnl))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">실현 수익률</span>
                <span className={`font-bold text-sm ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : ''}{realizedPct.toFixed(2)}%
                </span>
              </div>
              {startPrice != null && startPrice > 0 && (() => {
                const bhCost = startPrice * (1 + (feeEnabled ? BUY_FEE_RATE : 0))
                const bhProceeds = price * (1 - (feeEnabled ? SELL_FEE_RATE : 0))
                const bhPct = ((bhProceeds - bhCost) / bhCost) * 100
                const diff = realizedPct - bhPct
                return (
                  <div className="flex justify-between border-t border-gray-700 pt-1.5">
                    <span className="text-gray-400">바이앤홀드 대비</span>
                    <span className={`font-bold ${diff >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(2)}%
                      <span className="text-xs font-normal text-gray-500 ml-1">
                        ({diff >= 0 ? '초과수익' : '미달'})
                      </span>
                    </span>
                  </div>
                )
              })()}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
