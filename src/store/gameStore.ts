import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { INITIAL_CASH } from '../api/constants'

export interface Holding {
  symbol: string
  name: string
  quantity: number
  avgPrice: number
}

export interface TradeRecord {
  id: string
  symbol: string
  name: string
  type: 'buy' | 'sell'
  quantity: number
  price: number
  total: number
  timestamp: number
}

interface GameState {
  cash: number
  holdings: Record<string, Holding>
  tradeHistory: TradeRecord[]

  buy: (symbol: string, name: string, price: number, quantity: number) => string | null
  sell: (symbol: string, name: string, price: number, quantity: number) => string | null
  reset: () => void
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      cash: INITIAL_CASH,
      holdings: {},
      tradeHistory: [],

      buy: (symbol, name, price, quantity) => {
        const total = price * quantity
        const { cash, holdings, tradeHistory } = get()
        if (total > cash) return '잔고가 부족합니다.'
        if (quantity <= 0) return '수량을 1주 이상 입력하세요.'

        const prev = holdings[symbol]
        const newQty = (prev?.quantity ?? 0) + quantity
        const newAvg = prev
          ? (prev.avgPrice * prev.quantity + price * quantity) / newQty
          : price

        const record: TradeRecord = {
          id: crypto.randomUUID(),
          symbol,
          name,
          type: 'buy',
          quantity,
          price,
          total,
          timestamp: Date.now(),
        }

        set({
          cash: cash - total,
          holdings: {
            ...holdings,
            [symbol]: { symbol, name, quantity: newQty, avgPrice: newAvg },
          },
          tradeHistory: [record, ...tradeHistory],
        })
        return null
      },

      sell: (symbol, name, price, quantity) => {
        const { cash, holdings, tradeHistory } = get()
        const holding = holdings[symbol]
        if (!holding || holding.quantity < quantity) return '보유 수량이 부족합니다.'
        if (quantity <= 0) return '수량을 1주 이상 입력하세요.'

        const total = price * quantity
        const newQty = holding.quantity - quantity
        const newHoldings = { ...holdings }

        if (newQty === 0) {
          delete newHoldings[symbol]
        } else {
          newHoldings[symbol] = { ...holding, quantity: newQty }
        }

        const record: TradeRecord = {
          id: crypto.randomUUID(),
          symbol,
          name,
          type: 'sell',
          quantity,
          price,
          total,
          timestamp: Date.now(),
        }

        set({
          cash: cash + total,
          holdings: newHoldings,
          tradeHistory: [record, ...tradeHistory],
        })
        return null
      },

      reset: () =>
        set({
          cash: INITIAL_CASH,
          holdings: {},
          tradeHistory: [],
        }),
    }),
    { name: 'stock-game-state' },
  ),
)
