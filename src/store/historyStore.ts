import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { INITIAL_CASH, BUY_FEE_RATE, SELL_FEE_RATE } from '../api/constants'

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

export interface SavedSnapshot {
  id: string
  name: string
  savedAt: number
  gameDate: number
  cash: number
  holdings: Record<string, Holding>
  tradeHistory: TradeRecord[]
}

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

interface HistoryState {
  cash: number
  holdings: Record<string, Holding>
  tradeHistory: TradeRecord[]
  gameDate: number
  startDate: number
  feeEnabled: boolean
  saves: SavedSnapshot[]

  buy: (symbol: string, name: string, price: number, quantity: number) => string | null
  sell: (symbol: string, name: string, price: number, quantity: number) => string | null
  toggleFee: () => void
  advanceDay: () => void
  advanceTo: (ms: number) => void
  saveSnapshot: (name: string) => void
  loadSnapshot: (id: string) => void
  deleteSnapshot: (id: string) => void
  reset: () => void
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      cash: INITIAL_CASH,
      holdings: {},
      tradeHistory: [],
      gameDate: Date.now() - SIX_MONTHS_MS,
      startDate: Date.now() - SIX_MONTHS_MS,
      feeEnabled: false,
      saves: [],

      buy: (symbol, name, price, quantity) => {
        const { cash, holdings, tradeHistory, gameDate, feeEnabled } = get()
        const feeRate = feeEnabled ? BUY_FEE_RATE : 0
        const total = price * quantity
        const fee = Math.round(total * feeRate)
        const totalWithFee = total + fee
        if (totalWithFee > cash) return '잔고가 부족합니다.'
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
          total: totalWithFee,
          timestamp: gameDate,
        }

        set({
          cash: cash - totalWithFee,
          holdings: {
            ...holdings,
            [symbol]: { symbol, name, quantity: newQty, avgPrice: newAvg },
          },
          tradeHistory: [record, ...tradeHistory],
        })
        return null
      },

      sell: (symbol, name, price, quantity) => {
        const { cash, holdings, tradeHistory, gameDate, feeEnabled } = get()
        const holding = holdings[symbol]
        if (!holding || holding.quantity < quantity) return '보유 수량이 부족합니다.'
        if (quantity <= 0) return '수량을 1주 이상 입력하세요.'

        const feeRate = feeEnabled ? SELL_FEE_RATE : 0
        const total = price * quantity
        const fee = Math.round(total * feeRate)
        const totalAfterFee = total - fee
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
          total: totalAfterFee,
          timestamp: gameDate,
        }

        set({
          cash: cash + totalAfterFee,
          holdings: newHoldings,
          tradeHistory: [record, ...tradeHistory],
        })
        return null
      },

      toggleFee: () => set({ feeEnabled: !get().feeEnabled }),

      advanceDay: () => set({ gameDate: get().gameDate + 86_400_000 }),
      advanceTo: (ms) => set({ gameDate: ms }),

      saveSnapshot: (name) => {
        const { cash, holdings, tradeHistory, gameDate, saves } = get()
        const snapshot: SavedSnapshot = {
          id: crypto.randomUUID(),
          name,
          savedAt: Date.now(),
          gameDate,
          cash,
          holdings,
          tradeHistory,
        }
        set({ saves: [snapshot, ...saves] })
      },

      loadSnapshot: (id) => {
        const snapshot = get().saves.find((s) => s.id === id)
        if (!snapshot) return
        set({
          cash: snapshot.cash,
          holdings: snapshot.holdings,
          tradeHistory: snapshot.tradeHistory,
          gameDate: snapshot.gameDate,
        })
      },

      deleteSnapshot: (id) => {
        set({ saves: get().saves.filter((s) => s.id !== id) })
      },

      reset: () => {
        const newStart = Date.now() - SIX_MONTHS_MS
        set({
          cash: INITIAL_CASH,
          holdings: {},
          tradeHistory: [],
          gameDate: newStart,
          startDate: newStart,
        })
      },

    }),
    { name: 'history-game-state' },
  ),
)
