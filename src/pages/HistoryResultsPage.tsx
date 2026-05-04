import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchCandlesCached, type CandleBar } from '../api/yahooFinance'
import { getSyntheticCandles, getSyntheticName, isSynthetic } from '../api/syntheticStocks'
import { WATCHLIST } from '../api/constants'
import { useHistoryStore, type TradeRecord } from '../store/historyStore'
import { formatKRW, formatChangePercent } from '../utils/format'
import { INITIAL_CASH, BUY_FEE_RATE, SELL_FEE_RATE } from '../api/constants'

const watchlistNameMap = Object.fromEntries(WATCHLIST.map((w) => [w.symbol, w.name]))

// ── 툴팁 ──────────────────────────────────────────────────────────────────────
function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow((v) => !v)}
        className="w-4 h-4 rounded-full bg-gray-700 text-gray-400 text-xs inline-flex items-center justify-center hover:bg-gray-600 hover:text-white transition-colors select-none"
      >
        ?
      </button>
      {show && (
        <span className="absolute left-0 bottom-6 z-20 w-64 bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-xs text-gray-300 leading-relaxed shadow-2xl pointer-events-none block">
          {text}
        </span>
      )}
    </span>
  )
}

// ── FIFO 실현 손익 ─────────────────────────────────────────────────────────────
interface RealizedTrade {
  sellId: string
  sellDate: number
  sellPrice: number
  quantity: number
  avgCostBasis: number
  proceeds: number
  pnl: number
  pnlPct: number
  maxPriceAfter: number | null
  missedPct: number | null
}

function computeFifoRealizedTrades(
  buys: TradeRecord[],
  sells: TradeRecord[],
  allCandles: CandleBar[],
  endSec: number,
  feeEnabled: boolean,
): RealizedTrade[] {
  const queue: { price: number; qty: number }[] = []
  for (const b of [...buys].sort((a, b) => a.timestamp - b.timestamp))
    queue.push({ price: b.price, qty: b.quantity })

  const results: RealizedTrade[] = []
  for (const sell of [...sells].sort((a, b) => a.timestamp - b.timestamp)) {
    let remaining = sell.quantity
    let totalCost = 0
    let totalQty = 0
    while (remaining > 0 && queue.length > 0) {
      const lot = queue[0]
      const take = Math.min(lot.qty, remaining)
      totalCost += take * lot.price * (1 + (feeEnabled ? BUY_FEE_RATE : 0))
      totalQty += take
      lot.qty -= take
      remaining -= take
      if (lot.qty === 0) queue.shift()
    }
    if (totalQty === 0) continue
    const avgCostBasis = totalCost / totalQty
    const sellPriceAdj = sell.price * (1 - (feeEnabled ? SELL_FEE_RATE : 0))
    const proceeds = sellPriceAdj * totalQty
    const pnl = proceeds - totalCost
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0
    const sellSec = Math.floor(sell.timestamp / 1000)
    const afterCandles = allCandles.filter((c) => c.time > sellSec && c.time <= endSec)
    const maxPriceAfter = afterCandles.length > 0 ? Math.max(...afterCandles.map((c) => c.high)) : null
    const missedPct = maxPriceAfter != null && sell.price > 0
      ? ((maxPriceAfter - sell.price) / sell.price) * 100 : null
    results.push({ sellId: sell.id, sellDate: sell.timestamp, sellPrice: sell.price, quantity: totalQty, avgCostBasis, proceeds, pnl, pnlPct, maxPriceAfter, missedPct })
  }
  return results
}

// ── 등급 ──────────────────────────────────────────────────────────────────────
function getGrade(beatBh: number | null, pnlPct: number) {
  const score = pnlPct * 0.5 + (beatBh ?? 0) * 0.5
  if (score >= 20) return { grade: 'S', color: 'text-yellow-400', label: '완벽한 거래' }
  if (score >= 10) return { grade: 'A', color: 'text-green-400', label: '훌륭한 거래' }
  if (score >= 3)  return { grade: 'B', color: 'text-emerald-400', label: '양호한 거래' }
  if (score >= -3) return { grade: 'C', color: 'text-gray-300', label: '보통 수준' }
  if (score >= -10) return { grade: 'D', color: 'text-orange-400', label: '개선 필요' }
  return { grade: 'F', color: 'text-red-500', label: '아쉬운 거래' }
}

// ── 총평 생성 ─────────────────────────────────────────────────────────────────
interface SummaryPoint { icon: string; color: string; text: string }

function buildSummary(p: {
  pnlPct: number
  beatBh: number | null
  buyScore: number | null
  sellScore: number | null
  tradeCount: number
  optimalReturn: number | null
  hasHolding: boolean
  grade: string
}): { headline: string; points: SummaryPoint[]; advice: string } {
  const { pnlPct, beatBh, buyScore, sellScore, tradeCount, optimalReturn, hasHolding, grade } = p

  // 첫 문장
  let headline = ''
  if (grade === 'S') headline = `완벽에 가까운 거래였습니다. ${pnlPct.toFixed(1)}%의 높은 수익을 달성하며 시장도 이겼습니다.`
  else if (grade === 'A') headline = `훌륭한 거래였습니다. ${pnlPct.toFixed(1)}% 수익을 내며 단순 보유보다 더 나은 성과를 거뒀습니다.`
  else if (grade === 'B') headline = `양호한 거래였습니다. ${pnlPct.toFixed(1)}% 수익으로 준수한 결과를 냈습니다.`
  else if (grade === 'C') headline = pnlPct >= 0
    ? `${pnlPct.toFixed(1)}% 수익으로 무난한 결과를 냈지만, 단순 보유 전략과 비슷한 수준입니다.`
    : `${Math.abs(pnlPct).toFixed(1)}% 손실이 발생했습니다. 전략을 돌아볼 필요가 있습니다.`
  else if (grade === 'D') headline = `아쉬운 결과입니다. ${Math.abs(pnlPct).toFixed(1)}%의 손실이 발생했고 단순 보유보다도 낮은 성과입니다.`
  else headline = `큰 손실이 발생한 거래였습니다. 무엇이 잘못됐는지 아래 분석을 꼼꼼히 확인해보세요.`

  const points: SummaryPoint[] = []

  // 바이앤홀드 비교
  if (beatBh != null) {
    if (beatBh >= 5)
      points.push({ icon: '✓', color: 'text-green-400', text: `적극적 매매가 효과를 발휘했습니다. 단순 보유 대비 ${beatBh.toFixed(1)}% 초과 수익을 달성했습니다.` })
    else if (beatBh >= 0)
      points.push({ icon: '~', color: 'text-gray-400', text: `단순 보유와 거의 같은 성과입니다. 활발하게 거래했지만 추가 이득은 크지 않았습니다.` })
    else if (beatBh >= -5)
      points.push({ icon: '!', color: 'text-orange-400', text: `단순 보유보다 ${Math.abs(beatBh).toFixed(1)}% 낮은 성과입니다. 이 종목은 사고 기다리는 것이 더 유리했습니다.` })
    else
      points.push({ icon: '✗', color: 'text-red-400', text: `단순 보유보다 ${Math.abs(beatBh).toFixed(1)}% 크게 낮은 성과입니다. 타이밍을 맞추려는 시도가 오히려 손해로 이어졌습니다.` })
  }

  // 매수 타이밍
  if (buyScore != null) {
    if (buyScore >= 70)
      points.push({ icon: '✓', color: 'text-green-400', text: `매수 타이밍이 우수합니다(${buyScore}점). 비교적 저점에 가까운 시점에 진입했습니다.` })
    else if (buyScore >= 40)
      points.push({ icon: '~', color: 'text-gray-400', text: `매수 타이밍은 평균 수준입니다(${buyScore}점). 더 낮은 가격을 기다렸다면 수익이 커졌을 수 있습니다.` })
    else
      points.push({ icon: '✗', color: 'text-red-400', text: `매수 타이밍이 아쉽습니다(${buyScore}점). 상대적으로 높은 가격에 진입했습니다.` })
  }

  // 매도 타이밍
  if (sellScore != null) {
    if (sellScore >= 70)
      points.push({ icon: '✓', color: 'text-green-400', text: `매도 타이밍도 좋았습니다(${sellScore}점). 상대적으로 고점 근처에서 잘 팔았습니다.` })
    else if (sellScore >= 40)
      points.push({ icon: '~', color: 'text-gray-400', text: `매도 타이밍은 평균 수준입니다(${sellScore}점). 조금 더 기다렸다면 더 높은 가격에 팔 수 있었습니다.` })
    else
      points.push({ icon: '✗', color: 'text-red-400', text: `매도 타이밍이 아쉽습니다(${sellScore}점). 너무 이른 시점에 팔아 수익 기회를 놓쳤습니다.` })
  }

  // 거래 횟수
  if (tradeCount >= 10)
    points.push({ icon: '!', color: 'text-orange-400', text: `거래 횟수가 ${tradeCount}회로 많습니다. 잦은 매매는 수수료를 늘리고 수익을 깎을 수 있습니다.` })
  else if (tradeCount <= 2)
    points.push({ icon: '~', color: 'text-gray-400', text: `거래 횟수가 ${tradeCount}회로 적습니다. 다양한 타이밍 전략을 시도해보세요.` })

  // 최대 수익 대비
  if (optimalReturn != null && pnlPct < optimalReturn * 0.3 && optimalReturn > 10)
    points.push({ icon: '!', color: 'text-yellow-400', text: `이 기간 최대 ${optimalReturn.toFixed(0)}%의 수익이 가능했습니다. 실제 달성률은 약 ${Math.max(0, (pnlPct / optimalReturn * 100)).toFixed(0)}%였습니다.` })

  // 보유 중
  if (hasHolding)
    points.push({ icon: '~', color: 'text-amber-400', text: `아직 보유 중인 주식이 있습니다. 위 결과에는 종료 시점 기준 평가금액이 포함됐습니다.` })

  // 조언
  let advice = ''
  const weakBuy = buyScore != null && buyScore < 40
  const weakSell = sellScore != null && sellScore < 40
  const lostToBh = beatBh != null && beatBh < -3

  if (weakBuy && weakSell) advice = '매수와 매도 모두 타이밍 개선이 필요합니다. 지지선 근처에서 분할 매수, 저항선 근처에서 분할 매도 전략을 연습해보세요.'
  else if (weakBuy) advice = '매수 타이밍을 더 낮은 가격대로 낮추는 연습이 필요합니다. 급등 후 추격 매수보다 눌림목을 기다리는 것이 유리합니다.'
  else if (weakSell) advice = '매도 타이밍을 개선하면 수익을 더 높일 수 있습니다. 목표 수익률을 미리 정해두고 도달하면 매도하는 전략을 써보세요.'
  else if (lostToBh) advice = '이 종목은 장기 보유 전략이 더 효과적이었습니다. 다음엔 자주 사고팔기보다 강하게 상승하는 추세를 믿고 보유해보세요.'
  else if (grade === 'S' || grade === 'A') advice = '이번 결과는 훌륭합니다. 같은 전략을 다른 종목에도 적용해보세요. 단, 모든 종목이 같은 패턴을 보이지는 않습니다.'
  else advice = '전반적으로 무난한 결과입니다. 매수/매도 타이밍을 조금 더 다듬으면 바이앤홀드를 안정적으로 이길 수 있을 것입니다.'

  return { headline, points, advice }
}

// ── UI 헬퍼 ───────────────────────────────────────────────────────────────────
function ScoreBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <div className="w-full bg-gray-800 rounded-full h-2 mt-1.5">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function PriceRangeBar({ min, max, buyAvg, sellAvg }: { min: number; max: number; buyAvg: number | null; sellAvg: number | null }) {
  const range = max - min
  if (range <= 0) return null
  const pct = (v: number) => Math.min(98, Math.max(2, ((v - min) / range) * 100))
  return (
    <div className="relative w-full h-10 mt-4">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-gray-700 rounded-full" />
      {buyAvg != null && (
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${pct(buyAvg)}%` }}>
          <div className="w-3.5 h-3.5 rounded-full bg-red-400 border-2 border-red-300 shadow" />
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-red-400 whitespace-nowrap font-medium">매수</span>
        </div>
      )}
      {sellAvg != null && (
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${pct(sellAvg)}%` }}>
          <div className="w-3.5 h-3.5 rounded-full bg-blue-400 border-2 border-blue-300 shadow" />
          <span className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-blue-400 whitespace-nowrap font-medium">매도</span>
        </div>
      )}
      <span className="absolute left-0 -bottom-5 text-xs text-gray-500">{formatKRW(min)}</span>
      <span className="absolute right-0 -bottom-5 text-xs text-gray-500">{formatKRW(max)}</span>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function HistoryResultsPage() {
  const { symbol } = useParams<{ symbol: string }>()
  const decoded = symbol ? decodeURIComponent(symbol) : ''
  const { tradeHistory, holdings, stockPositions, startDate, feeEnabled, customSymbols } = useHistoryStore()

  const [allCandles, setAllCandles] = useState<CandleBar[]>([])
  const [loading, setLoading] = useState(true)

  const stockDate = stockPositions[decoded] ?? startDate
  const name = isSynthetic(decoded)
    ? getSyntheticName(decoded)
    : (watchlistNameMap[decoded] ?? customSymbols[decoded] ?? decoded)

  useEffect(() => {
    if (!decoded) return
    setLoading(true)
    const getCandles = isSynthetic(decoded)
      ? Promise.resolve(getSyntheticCandles(decoded))
      : fetchCandlesCached(decoded, '1y')
    getCandles.then(setAllCandles).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded])

  const symbolTrades = tradeHistory.filter((t) => t.symbol === decoded)
  const buys  = symbolTrades.filter((t) => t.type === 'buy')
  const sells = symbolTrades.filter((t) => t.type === 'sell')
  const holding = holdings[decoded]

  const startSec = Math.floor(startDate / 1000)
  const endSec   = Math.floor(stockDate / 1000)
  const periodCandles = allCandles.filter((c) => c.time >= startSec && c.time <= endSec)

  const startPrice = periodCandles.length > 0 ? periodCandles[0].close : null
  const endPrice   = periodCandles.length > 0 ? periodCandles[periodCandles.length - 1].close : null
  const periodMin  = periodCandles.length > 0 ? Math.min(...periodCandles.map((c) => c.low))  : null
  const periodMax  = periodCandles.length > 0 ? Math.max(...periodCandles.map((c) => c.high)) : null
  const periodAvg  = periodCandles.length > 0
    ? periodCandles.reduce((s, c) => s + c.close, 0) / periodCandles.length : null

  const totalSpent    = buys.reduce((s, t)  => s + t.total, 0)
  const totalReceived = sells.reduce((s, t) => s + t.total, 0)
  const holdingValue  = holding && endPrice != null ? endPrice * holding.quantity : 0
  const netPnl  = totalReceived + holdingValue - totalSpent
  const pnlPct  = totalSpent > 0 ? (netPnl / totalSpent) * 100 : 0

  const bhCost     = startPrice != null ? startPrice * (1 + (feeEnabled ? BUY_FEE_RATE : 0)) : null
  const bhProceeds = endPrice   != null ? endPrice   * (1 - (feeEnabled ? SELL_FEE_RATE : 0)) : null
  const bhPct  = bhCost && bhProceeds && bhCost > 0 ? ((bhProceeds - bhCost) / bhCost) * 100 : null
  const beatBh = bhPct != null ? pnlPct - bhPct : null

  const optimalReturn = periodMin && periodMax && periodMin > 0
    ? ((periodMax - periodMin) / periodMin) * 100 : null

  const totalBuyQty  = buys.reduce((s, t)  => s + t.quantity, 0)
  const totalSellQty = sells.reduce((s, t) => s + t.quantity, 0)
  const avgBuyPrice  = totalBuyQty  > 0 ? buys.reduce((s, t)  => s + t.price * t.quantity, 0) / totalBuyQty  : null
  const avgSellPrice = totalSellQty > 0 ? sells.reduce((s, t) => s + t.price * t.quantity, 0) / totalSellQty : null

  const buyScore  = avgBuyPrice  != null && periodMin != null && periodMax != null && periodMax > periodMin
    ? Math.round(100 - ((avgBuyPrice  - periodMin) / (periodMax - periodMin)) * 100) : null
  const sellScore = avgSellPrice != null && periodMin != null && periodMax != null && periodMax > periodMin
    ? Math.round(((avgSellPrice - periodMin) / (periodMax - periodMin)) * 100) : null

  const buyVsAvgPct  = avgBuyPrice  != null && periodAvg != null && periodAvg > 0
    ? ((avgBuyPrice  - periodAvg) / periodAvg) * 100 : null
  const sellVsAvgPct = avgSellPrice != null && periodAvg != null && periodAvg > 0
    ? ((avgSellPrice - periodAvg) / periodAvg) * 100 : null

  const realizedTrades = !loading
    ? computeFifoRealizedTrades(buys, sells, allCandles, endSec, feeEnabled) : []

  const { grade, color: gradeColor, label: gradeLabel } = getGrade(beatBh, pnlPct)
  const summary = buildSummary({ pnlPct, beatBh, buyScore, sellScore, tradeCount: symbolTrades.length, optimalReturn, hasHolding: !!holding, grade })

  const startDateStr = new Date(startDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  const endDateStr   = new Date(stockDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  const pos = netPnl >= 0

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* 헤더 */}
      <div>
        <Link to="/history" className="text-gray-400 hover:text-gray-300 text-sm inline-flex items-center gap-1 transition-colors">
          ← 목록으로
        </Link>
        <div className="mt-4 flex items-start justify-between">
          <div>
            <h1 className="text-white text-2xl font-bold">{name} 결과 분석</h1>
            <p className="text-gray-400 text-sm mt-1">{startDateStr} → {endDateStr}</p>
          </div>
          <div className="text-center ml-4 shrink-0">
            <span className={`text-5xl font-black ${gradeColor}`}>{grade}</span>
            <p className="text-gray-400 text-xs mt-1">{gradeLabel}</p>
          </div>
        </div>
      </div>

      {totalSpent === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-2">
          <p className="text-gray-400">이 종목에 거래 내역이 없습니다.</p>
          <Link to="/history" className="inline-block mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-xl transition-colors">
            목록으로
          </Link>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => <div key={i} className="h-24 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* 종합 성과 */}
          <div className={`rounded-2xl border p-5 ${pos ? 'bg-red-500/5 border-red-500/20' : 'bg-blue-500/5 border-blue-500/20'}`}>
            <p className="text-gray-400 text-xs mb-1">
              순 손익
              <InfoTip text="투자한 금액(매수) 대비 회수한 금액(매도 + 현재 보유 평가액)의 차이입니다. 수수료가 켜져 있으면 수수료까지 반영됩니다." />
            </p>
            <div className="flex items-end gap-3 flex-wrap">
              <span className={`text-4xl font-bold ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                {pos ? '+' : ''}{formatKRW(Math.round(netPnl))}
              </span>
              <span className={`text-xl font-bold px-3 py-1 rounded-full ${pos ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {pos ? '+' : ''}{pnlPct.toFixed(2)}%
              </span>
            </div>
            {bhPct != null && (
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <span className="text-gray-400 text-sm">
                  바이앤홀드
                  <InfoTip text="게임 시작 시점에 이 종목을 사서 종료 시점까지 아무 거래 없이 그대로 보유했을 때의 수익률입니다. 내 거래 성과를 비교하는 기준선이 됩니다. 이 수치를 못 넘기면 그냥 사놓고 기다리는 게 더 나았다는 뜻입니다." />
                  {' '}
                  <span className={bhPct >= 0 ? 'text-red-400' : 'text-blue-400'}>{bhPct >= 0 ? '+' : ''}{bhPct.toFixed(2)}%</span>
                </span>
                {beatBh != null && (
                  <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${beatBh >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                    {beatBh >= 0 ? '▲' : '▼'} {Math.abs(beatBh).toFixed(2)}% {beatBh >= 0 ? '초과수익' : '시장 미달'}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 총평 */}
          <section className="bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-4">
            <h2 className="text-white font-semibold">총평</h2>
            <p className="text-gray-200 text-sm leading-relaxed">{summary.headline}</p>
            <ul className="space-y-2">
              {summary.points.map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`font-bold shrink-0 mt-0.5 ${pt.color}`}>{pt.icon}</span>
                  <span className="text-gray-300 leading-relaxed">{pt.text}</span>
                </li>
              ))}
            </ul>
            <div className="pt-3 border-t border-gray-800">
              <p className="text-xs text-gray-500 font-medium mb-1">다음 거래를 위한 제안</p>
              <p className="text-indigo-300 text-sm leading-relaxed">{summary.advice}</p>
            </div>
          </section>

          {/* 핵심 지표 */}
          <section>
            <h2 className="text-white font-semibold mb-3">핵심 지표</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                <p className="text-gray-400 text-xs mb-1">
                  달성 수익률
                  <InfoTip text="내 실제 거래로 달성한 수익률입니다. 매수금 대비 (매도금 + 보유 평가액)으로 계산됩니다." />
                </p>
                <p className={`text-lg font-bold ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : ''}{pnlPct.toFixed(2)}%
                </p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                <p className="text-gray-400 text-xs mb-1">
                  최대 가능 수익률
                  <InfoTip text="이 기간 중 가장 낮은 가격(저가)에 매수하고 가장 높은 가격(고가)에 매도했을 때 달성 가능한 이론적 최대 수익률입니다. 실제로 달성하기는 매우 어렵지만, 이 기간의 수익 잠재력이 얼마였는지 보여줍니다." />
                </p>
                <p className="text-white text-lg font-bold">
                  {optimalReturn != null ? `+${optimalReturn.toFixed(1)}%` : '—'}
                </p>
                <p className="text-gray-500 text-xs mt-0.5">기간 최저 → 최고가 기준</p>
              </div>
              {buyScore != null && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <div className="flex justify-between items-center">
                    <p className="text-gray-400 text-xs">
                      매수 타이밍 점수
                      <InfoTip text="기간 내 최저가를 0점, 최고가를 100점으로 봤을 때 내 평균 매수가가 얼마나 낮은 위치에 있는지를 나타냅니다. 점수가 높을수록 저점에 가깝게 매수한 것으로, 좋은 진입 타이밍을 뜻합니다." />
                    </p>
                    <span className={`text-sm font-bold ${buyScore >= 60 ? 'text-green-400' : buyScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {buyScore}/100
                    </span>
                  </div>
                  <ScoreBar value={buyScore} color={buyScore >= 60 ? 'bg-green-500' : buyScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'} />
                  <p className="text-gray-500 text-xs mt-1.5">
                    {buyScore >= 70 ? '저점 근처에서 잘 매수했어요' : buyScore >= 40 ? '평균적인 타이밍으로 매수했어요' : '고점 근처에서 매수했어요'}
                  </p>
                </div>
              )}
              {sellScore != null && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <div className="flex justify-between items-center">
                    <p className="text-gray-400 text-xs">
                      매도 타이밍 점수
                      <InfoTip text="기간 내 최저가를 0점, 최고가를 100점으로 봤을 때 내 평균 매도가가 얼마나 높은 위치에 있는지를 나타냅니다. 점수가 높을수록 고점에 가깝게 매도한 것으로, 좋은 청산 타이밍을 뜻합니다." />
                    </p>
                    <span className={`text-sm font-bold ${sellScore >= 60 ? 'text-green-400' : sellScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {sellScore}/100
                    </span>
                  </div>
                  <ScoreBar value={sellScore} color={sellScore >= 60 ? 'bg-green-500' : sellScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'} />
                  <p className="text-gray-500 text-xs mt-1.5">
                    {sellScore >= 70 ? '고점 근처에서 잘 매도했어요' : sellScore >= 40 ? '평균적인 타이밍으로 매도했어요' : '저점 근처에서 매도했어요'}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* 매매 가격 분석 */}
          {periodMin != null && periodMax != null && (avgBuyPrice != null || avgSellPrice != null) && (
            <section>
              <h2 className="text-white font-semibold mb-1">
                매매 가격 분석
                <InfoTip text="가로 바는 이 종목의 기간 내 가격 범위(최저가~최고가)를 나타냅니다. 빨간 점은 내 평균 매수가, 파란 점은 내 평균 매도가의 위치입니다. 빨간 점은 왼쪽(저점)에 가까울수록, 파란 점은 오른쪽(고점)에 가까울수록 좋은 타이밍입니다." />
              </h2>
              <p className="text-gray-500 text-xs mb-4">가로 바 위 빨간 점 = 내 매수가, 파란 점 = 내 매도가</p>
              <div className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-5">
                <PriceRangeBar min={periodMin} max={periodMax} buyAvg={avgBuyPrice ?? null} sellAvg={avgSellPrice ?? null} />
                <div className="mt-10 space-y-3">
                  {avgBuyPrice != null && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
                        <span className="text-gray-400 text-sm">평균 매수가</span>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-semibold text-sm">{formatKRW(Math.round(avgBuyPrice))}</span>
                        {buyVsAvgPct != null && (
                          <span className={`ml-2 text-xs ${buyVsAvgPct <= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                            기간평균 대비 {buyVsAvgPct <= 0 ? '' : '+'}{buyVsAvgPct.toFixed(1)}%
                            <InfoTip text={`기간 평균 종가는 ${formatKRW(Math.round(periodAvg!))}입니다. 평균보다 ${buyVsAvgPct <= 0 ? '낮게(싸게)' : '높게(비싸게)'} 매수했습니다.`} />
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {avgSellPrice != null && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shrink-0" />
                        <span className="text-gray-400 text-sm">평균 매도가</span>
                      </div>
                      <div className="text-right">
                        <span className="text-white font-semibold text-sm">{formatKRW(Math.round(avgSellPrice))}</span>
                        {sellVsAvgPct != null && (
                          <span className={`ml-2 text-xs ${sellVsAvgPct >= 0 ? 'text-green-400' : 'text-orange-400'}`}>
                            기간평균 대비 {sellVsAvgPct >= 0 ? '+' : ''}{sellVsAvgPct.toFixed(1)}%
                            <InfoTip text={`기간 평균 종가는 ${formatKRW(Math.round(periodAvg!))}입니다. 평균보다 ${sellVsAvgPct >= 0 ? '높게(비싸게)' : '낮게(싸게)'} 매도했습니다.`} />
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="pt-2 border-t border-gray-800 grid grid-cols-3 gap-2 text-xs text-gray-500">
                    <div>최저가 <span className="text-gray-300 ml-1">{formatKRW(periodMin)}</span></div>
                    <div>평균가 <span className="text-gray-300 ml-1">{formatKRW(Math.round(periodAvg!))}</span></div>
                    <div>최고가 <span className="text-gray-300 ml-1">{formatKRW(periodMax)}</span></div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 거래별 실현 손익 */}
          {realizedTrades.length > 0 && (
            <section>
              <h2 className="text-white font-semibold mb-1">
                거래별 실현 손익
                <InfoTip text="매도 1건마다 FIFO(선입선출) 방식으로 원가를 계산해 실현 손익을 보여줍니다. 예를 들어 100주를 두 번 나눠 샀다면, 먼저 산 주식부터 팔린 것으로 계산합니다." />
              </h2>
              <p className="text-gray-500 text-xs mb-3">매도 건별 손익 (FIFO 원가 기준)</p>
              <div className="space-y-2">
                {realizedTrades.map((rt, i) => {
                  const rPos = rt.pnl >= 0
                  return (
                    <div key={rt.sellId} className={`rounded-xl border px-4 py-3 ${rPos ? 'bg-red-500/5 border-red-500/20' : 'bg-blue-500/5 border-blue-500/20'}`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-gray-400 text-xs">거래 #{i + 1} · {new Date(rt.sellDate).toLocaleDateString('ko-KR')} · {rt.quantity}주</p>
                          <p className="text-white text-sm mt-0.5">
                            평균단가 {formatKRW(Math.round(rt.avgCostBasis))} → 매도가 {formatKRW(rt.sellPrice)}
                          </p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className={`font-bold text-sm ${rPos ? 'text-red-400' : 'text-blue-400'}`}>
                            {rPos ? '+' : ''}{formatKRW(Math.round(rt.pnl))}
                          </p>
                          <p className={`text-xs ${rPos ? 'text-red-400' : 'text-blue-400'}`}>
                            {rPos ? '+' : ''}{rt.pnlPct.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                      {rt.missedPct != null && rt.missedPct > 2 && (
                        <p className="text-orange-400/80 text-xs mt-2">
                          ↗ 매도 후 최고 {rt.missedPct.toFixed(1)}% 추가 상승 — 더 기다렸다면 수익이 컸을 수 있어요
                        </p>
                      )}
                      {rt.missedPct != null && rt.missedPct <= -2 && (
                        <p className="text-green-400/80 text-xs mt-2">
                          ↘ 매도 후 {Math.abs(rt.missedPct).toFixed(1)}% 하락 — 좋은 타이밍에 매도했어요
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* 잔여 보유 */}
          {holding && endPrice != null && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              <p className="text-amber-400 text-sm font-medium">아직 {holding.quantity}주 보유 중</p>
              <p className="text-gray-400 text-xs mt-1">
                종료 시점 단가 {formatKRW(endPrice)} · 평가금액 {formatKRW(holdingValue)} (결과에 포함됨)
              </p>
            </div>
          )}

          {/* 거래 통계 */}
          <section>
            <h2 className="text-white font-semibold mb-3">거래 통계</h2>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '총 거래', value: `${symbolTrades.length}회`, tip: '이 종목에 대해 총 몇 번 주문(매수+매도)을 실행했는지입니다.' },
                { label: '매수', value: `${buys.length}회`, color: 'text-red-400', tip: '이 종목을 매수한 횟수입니다.' },
                { label: '매도', value: `${sells.length}회`, color: 'text-blue-400', tip: '이 종목을 매도한 횟수입니다.' },
                { label: '총 투자금', value: formatKRW(totalSpent), tip: '이 종목 매수에 사용한 총 금액(수수료 포함)입니다.' },
                { label: '총 매도금', value: formatKRW(totalReceived), tip: '이 종목 매도로 받은 총 금액(수수료 차감 후)입니다.' },
                { label: '자본 대비', value: formatChangePercent((netPnl / INITIAL_CASH) * 100), color: netPnl >= 0 ? 'text-red-400' : 'text-blue-400', tip: `게임 초기 자본(${formatKRW(INITIAL_CASH)}) 대비 이 종목에서 얼마를 벌었는지입니다.` },
              ].map((item) => (
                <div key={item.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <p className="text-gray-400 text-xs mb-1">
                    {item.label}
                    <InfoTip text={item.tip} />
                  </p>
                  <p className={`font-bold text-sm ${item.color ?? 'text-white'}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 전체 거래 내역 */}
          <section>
            <h2 className="text-white font-semibold mb-3">전체 거래 내역</h2>
            <div className="space-y-2">
              {[...symbolTrades].reverse().map((t) => (
                <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${t.type === 'buy' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'}`}>
                        {t.type === 'buy' ? '매수' : '매도'}
                      </span>
                      <div>
                        <p className="text-white text-sm">{t.quantity}주 @ {formatKRW(t.price)}</p>
                        <p className="text-gray-400 text-xs">{new Date(t.timestamp).toLocaleDateString('ko-KR')}</p>
                      </div>
                    </div>
                    <p className={`text-sm font-semibold ${t.type === 'buy' ? 'text-red-400' : 'text-blue-400'}`}>
                      {t.type === 'buy' ? '-' : '+'}{formatKRW(t.total)}
                    </p>
                  </div>
                  {t.note && (
                    <p className="mt-2 text-xs text-gray-400 bg-gray-800 rounded-lg px-3 py-1.5 border-l-2 border-indigo-500/50">
                      {t.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="flex gap-3">
        <Link to="/history" className="flex-1 py-3 text-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors">
          목록으로
        </Link>
        <Link to="/history/portfolio" className="flex-1 py-3 text-center bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-xl transition-colors">
          포트폴리오
        </Link>
      </div>
    </main>
  )
}
