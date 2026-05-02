import type { CandleBar } from '../api/yahooFinance'

export interface InvestorFlow {
  foreign: number
  institution: number
  individual: number
}

function seededRand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

export function calcInvestorFlow(candle: CandleBar, prev: CandleBar | null): InvestorFlow {
  const rand = seededRand(candle.time * 31337)
  const r = () => rand() * 2 - 1

  const changePct = prev && prev.close > 0 ? (candle.close - prev.close) / prev.close : 0
  const totalValue = candle.volume * candle.close

  // 상승일: 외국인·기관 순매수, 개인 순매도 경향
  // 하락일: 개인 순매수(물타기), 외국인·기관 순매도 경향
  const trend = changePct * 0.6

  const foreignRatio = trend + r() * 0.15
  const institutionRatio = trend * 0.6 + r() * 0.1
  const individualRatio = -(foreignRatio + institutionRatio) + r() * 0.05

  const scale = totalValue * 0.3

  return {
    foreign: Math.round(foreignRatio * scale),
    institution: Math.round(institutionRatio * scale),
    individual: Math.round(individualRatio * scale),
  }
}
