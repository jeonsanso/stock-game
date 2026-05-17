import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  paperTradingApi,
  type ActiveTrade,
  type PerformanceSummary,
  type TradeRecord,
} from '../api/aiRecommend'

// ── 유틸 ──────────────────────────────────────────────────────

function fmtDate(s: string): string {
  return s.length === 8
    ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`
    : s
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

function pctColor(v: number | null | undefined): string {
  if (v == null) return 'text-gray-400'
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString() + '원'
}

// ── 성과 요약 카드 ─────────────────────────────────────────────

interface SummaryCardProps {
  label: string
  value: string
  valueClass: string
  sub: string
}

function SummaryCard({ label, value, valueClass, sub }: SummaryCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-gray-500 text-xs mt-1">{sub}</p>
    </div>
  )
}

// ── 보유 종목 행 ───────────────────────────────────────────────

function ActiveRow({ t }: { t: ActiveTrade }) {
  return (
    <tr className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
      <td className="px-4 py-3 text-gray-400 text-xs">{t.recommended_rank ?? '—'}</td>
      <td className="px-4 py-3">
        <span className="text-white font-mono text-xs">{t.symbol}</span>
        {t.name && <span className="text-gray-400 text-xs ml-1.5">{t.name}</span>}
      </td>
      <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(t.recommended_date)}</td>
      <td className="px-4 py-3 text-right text-gray-300 text-xs">{fmtPrice(t.recommended_price)}</td>
      <td className="px-4 py-3 text-right text-gray-300 text-xs">{fmtPrice(t.current_price)}</td>
      <td className={`px-4 py-3 text-right text-xs font-medium ${pctColor(t.unrealized_pct)}`}>
        {fmtPct(t.unrealized_pct)}
      </td>
      <td className="px-4 py-3 text-right text-gray-400 text-xs">{t.holding_days}일</td>
      <td className="px-4 py-3 text-right text-gray-500 text-xs">
        {t.recommended_prob != null ? `${(t.recommended_prob * 100).toFixed(1)}%` : '—'}
      </td>
    </tr>
  )
}

// ── 거래 이력 행 ───────────────────────────────────────────────

function TradeRow({ t }: { t: TradeRecord }) {
  const statusBadge =
    t.status === 'closed'
      ? 'bg-emerald-500/10 text-emerald-400'
      : t.status === 'expired'
      ? 'bg-gray-700 text-gray-400'
      : 'bg-blue-500/10 text-blue-400'

  return (
    <tr className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
      <td className="px-4 py-3">
        <span className="text-white font-mono text-xs">{t.symbol}</span>
        {t.name && <span className="text-gray-400 text-xs ml-1.5">{t.name}</span>}
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusBadge}`}>
          {t.status}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(t.recommended_date)}</td>
      <td className="px-4 py-3 text-gray-400 text-xs">
        {t.close_date ? fmtDate(t.close_date) : '—'}
      </td>
      <td className="px-4 py-3 text-right text-gray-300 text-xs">{fmtPrice(t.recommended_price)}</td>
      <td className="px-4 py-3 text-right text-gray-300 text-xs">{fmtPrice(t.close_price)}</td>
      <td className={`px-4 py-3 text-right text-xs font-medium ${pctColor(t.return_pct)}`}>
        {fmtPct(t.return_pct)}
      </td>
      <td className="px-4 py-3 text-right text-gray-400 text-xs">
        {t.holding_days != null ? `${t.holding_days}일` : '—'}
      </td>
    </tr>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────

export default function PaperTradingPage() {
  const [active, setActive] = useState<ActiveTrade[]>([])
  const [perf, setPerf] = useState<PerformanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    let cancelled = false
    Promise.all([paperTradingApi.getActive(), paperTradingApi.getPerformance()])
      .then(([activeData, perfData]) => {
        if (cancelled) return
        setActive(activeData)
        setPerf(perfData)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  const totalReturnClass = pctColor(perf?.total_return_pct)

  const winRateClass =
    perf?.win_rate == null
      ? 'text-gray-400'
      : perf.win_rate >= 0.6
      ? 'text-emerald-400'
      : perf.win_rate >= 0.4
      ? 'text-yellow-400'
      : 'text-red-400'

  const closedTrades = perf?.closed_trades ?? 0

  return (
    <div className="min-h-screen bg-slate-950">
      {/* 상단 내비 */}
      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center gap-3">
          <Link
            to="/"
            className="text-gray-400 hover:text-white transition-colors p-1 -ml-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-white font-bold text-sm">AI 모의투자 추적</h1>
          <div className="h-4 w-px bg-gray-700" />
          <span className="text-purple-400 text-xs font-medium">Paper Trading</span>
          <div className="ml-auto">
            <span className="text-gray-500 text-xs">5거래일 자동 청산</span>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* 에러 */}
        {error && (
          <div className="bg-gray-900 border border-red-500/30 rounded-xl p-5">
            <p className="text-red-400 font-medium text-sm">서버 연결 실패</p>
            <p className="text-gray-400 text-xs mt-1">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24">
            <p className="text-gray-500 text-sm">불러오는 중...</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* 1. 누적 성과 카드 4개 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="누적 수익률"
                value={fmtPct(perf?.total_return_pct)}
                valueClass={totalReturnClass}
                sub={closedTrades > 0 ? `${closedTrades}건 청산 합산` : '청산 없음'}
              />
              <SummaryCard
                label="승률"
                value={
                  perf?.win_rate != null
                    ? `${(perf.win_rate * 100).toFixed(1)}%`
                    : '—'
                }
                valueClass={winRateClass}
                sub={
                  perf?.win_count != null
                    ? `${perf.win_count}승 / ${closedTrades}건`
                    : '데이터 없음'
                }
              />
              <SummaryCard
                label="평균 보유일"
                value={perf?.avg_holding_days != null ? `${perf.avg_holding_days}일` : '—'}
                valueClass="text-white"
                sub="5거래일 자동 청산 기준"
              />
              <SummaryCard
                label="총 거래"
                value={perf ? String(perf.total_trades) : '—'}
                valueClass="text-white"
                sub={`보유 ${perf?.open_trades ?? 0} · 만료 ${perf?.expired_trades ?? 0}`}
              />
            </div>

            {/* 2. 현재 보유 종목 */}
            <section>
              <h2 className="text-white font-semibold text-sm mb-3">
                현재 보유 종목
                <span className="ml-2 text-gray-500 font-normal text-xs">{active.length}개</span>
              </h2>
              {active.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                  <p className="text-gray-500 text-sm">보유 중인 종목 없음</p>
                </div>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-400 text-xs">
                          <th className="text-left px-4 py-3 font-medium">순위</th>
                          <th className="text-left px-4 py-3 font-medium">종목</th>
                          <th className="text-left px-4 py-3 font-medium">추천일</th>
                          <th className="text-right px-4 py-3 font-medium">매수가</th>
                          <th className="text-right px-4 py-3 font-medium">현재가</th>
                          <th className="text-right px-4 py-3 font-medium">손익률</th>
                          <th className="text-right px-4 py-3 font-medium">보유일</th>
                          <th className="text-right px-4 py-3 font-medium">확률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {active.map(t => <ActiveRow key={t.id} t={t} />)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* 3. 베스트 / 워스트 거래 */}
            {(perf?.best_trade || perf?.worst_trade) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {perf.best_trade && (
                  <div className="bg-gray-900 border border-emerald-500/20 rounded-xl p-4">
                    <p className="text-emerald-400 text-xs font-medium mb-2">베스트 거래</p>
                    <p className="text-white font-mono text-sm">{perf.best_trade.symbol}</p>
                    {perf.best_trade.name && (
                      <p className="text-gray-400 text-xs">{perf.best_trade.name}</p>
                    )}
                    <p className="text-emerald-400 text-2xl font-bold mt-2 tabular-nums">
                      {fmtPct(perf.best_trade.return_pct)}
                    </p>
                  </div>
                )}
                {perf.worst_trade && (
                  <div className="bg-gray-900 border border-red-500/20 rounded-xl p-4">
                    <p className="text-red-400 text-xs font-medium mb-2">워스트 거래</p>
                    <p className="text-white font-mono text-sm">{perf.worst_trade.symbol}</p>
                    {perf.worst_trade.name && (
                      <p className="text-gray-400 text-xs">{perf.worst_trade.name}</p>
                    )}
                    <p className="text-red-400 text-2xl font-bold mt-2 tabular-nums">
                      {fmtPct(perf.worst_trade.return_pct)}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 4. 최근 청산 이력 */}
            <section>
              <h2 className="text-white font-semibold text-sm mb-3">최근 청산 이력</h2>
              {!perf?.recent_trades || perf.recent_trades.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-1">
                  <p className="text-gray-500 text-sm">아직 청산된 거래 없음</p>
                  <p className="text-gray-600 text-xs">
                    약 5거래일(~2026.05.20) 후 첫 결과가 표시됩니다
                  </p>
                </div>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-400 text-xs">
                          <th className="text-left px-4 py-3 font-medium">종목</th>
                          <th className="text-left px-4 py-3 font-medium">상태</th>
                          <th className="text-left px-4 py-3 font-medium">추천일</th>
                          <th className="text-left px-4 py-3 font-medium">청산일</th>
                          <th className="text-right px-4 py-3 font-medium">매수가</th>
                          <th className="text-right px-4 py-3 font-medium">매도가</th>
                          <th className="text-right px-4 py-3 font-medium">수익률</th>
                          <th className="text-right px-4 py-3 font-medium">보유일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perf.recent_trades.map(t => <TradeRow key={t.id} t={t} />)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
