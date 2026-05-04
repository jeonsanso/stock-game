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
  note?: string
}

export interface SavedSnapshot {
  id: string
  name: string
  savedAt: number
  stockPositions: Record<string, number>
  completedStocks: string[]
  cash: number
  holdings: Record<string, Holding>
  tradeHistory: TradeRecord[]
}

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000

interface HistoryState {
  cash: number
  holdings: Record<string, Holding>
  tradeHistory: TradeRecord[]
  stockPositions: Record<string, number>
  completedStocks: string[]
  customSymbols: Record<string, string>  // symbol → name (user-searched stocks)
  startDate: number
  feeEnabled: boolean
  saves: SavedSnapshot[]

  buy: (symbol: string, name: string, price: number, quantity: number, note?: string) => string | null
  sell: (symbol: string, name: string, price: number, quantity: number, noFee?: boolean, note?: string) => string | null
  toggleFee: () => void
  advanceStockTo: (symbol: string, ms: number) => void
  completeStock: (symbol: string) => void
  addCustomSymbol: (symbol: string, name: string) => void
  removeCustomSymbol: (symbol: string) => void
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
      stockPositions: {},
      completedStocks: [],
      customSymbols: {},
      startDate: Date.now() - SIX_MONTHS_MS,
      feeEnabled: false,
      saves: [],

      buy: (symbol, name, price, quantity, note?) => {
        const { cash, holdings, tradeHistory, stockPositions, startDate, feeEnabled } = get()
        const stockDate = stockPositions[symbol] ?? startDate
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
          timestamp: stockDate,
          note: note?.trim() || undefined,
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

      sell: (symbol, name, price, quantity, noFee = false, note?) => {
        const { cash, holdings, tradeHistory, stockPositions, startDate, feeEnabled } = get()
        const stockDate = stockPositions[symbol] ?? startDate
        const holding = holdings[symbol]
        if (!holding || holding.quantity < quantity) return '보유 수량이 부족합니다.'
        if (quantity <= 0) return '수량을 1주 이상 입력하세요.'

        const feeRate = (!noFee && feeEnabled) ? SELL_FEE_RATE : 0
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
          timestamp: stockDate,
          note: note?.trim() || undefined,
        }

        set({
          cash: cash + totalAfterFee,
          holdings: newHoldings,
          tradeHistory: [record, ...tradeHistory],
        })
        return null
      },

      toggleFee: () => set({ feeEnabled: !get().feeEnabled }),

      advanceStockTo: (symbol, ms) => {
        set({
          stockPositions: {
            ...get().stockPositions,
            [symbol]: Math.min(ms, Date.now()),
          },
        })
      },

      completeStock: (symbol) => {
        const { completedStocks } = get()
        if (!completedStocks.includes(symbol)) {
          set({ completedStocks: [...completedStocks, symbol] })
        }
      },

      addCustomSymbol: (symbol, name) => {
        const { customSymbols } = get()
        if (!customSymbols[symbol]) {
          set({ customSymbols: { ...customSymbols, [symbol]: name } })
        }
      },

      removeCustomSymbol: (symbol) => {
        const { customSymbols } = get()
        const next = { ...customSymbols }
        delete next[symbol]
        set({ customSymbols: next })
      },

      saveSnapshot: (name) => {
        const { cash, holdings, tradeHistory, stockPositions, completedStocks, saves } = get()
        const snapshot: SavedSnapshot = {
          id: crypto.randomUUID(),
          name,
          savedAt: Date.now(),
          stockPositions,
          completedStocks,
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
          stockPositions: snapshot.stockPositions ?? {},
          completedStocks: snapshot.completedStocks ?? [],
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
          stockPositions: {},
          completedStocks: [],
          customSymbols: {},
          startDate: newStart,
        })
      },
    }),
    {
      name: 'history-game-state-v2',
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!state.stockPositions) state.stockPositions = {}
          if (!state.completedStocks) state.completedStocks = []
          if (!state.customSymbols) state.customSymbols = {}
        }
      },
    },
  ),
)
