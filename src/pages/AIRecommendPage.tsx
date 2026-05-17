import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, Link } from 'react-router-dom'
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineSeries,
  type UTCTimestamp,
} from 'lightweight-charts'
import { fetchQuote, fetchCandlesCached, searchSymbols, type SearchResult } from '../api/yahooFinance'
import {
  aiApi,
  getWatchlist, toggleWatchlist,
  getMemo, saveMemo,
  getVirtualTrades, addVirtualTrade, deleteVirtualTrade,
  type Prediction, type ShapEntry, type TickerDetail,
  type PerformanceResponse, type PriceBar, type CostsApplied,
  type MarketTrend, type DailySummary, type VirtualTrade,
  type RetrainStatus, type ExcludedStock, type CooldownStock,
  type TradeStrategy,
} from '../api/aiRecommend'

// ── 유틸 ──────────────────────────────────────────────────────

function yyyymmddToTs(s: string): UTCTimestamp {
  const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8)
  return Math.floor(new Date(y, m, d, 9, 0, 0).getTime() / 1000) as UTCTimestamp
}
function fmtDate(s: string): string {
  return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : s
}
const normalizeSymbol = (s: string) => s.replace(/\.(KS|KQ)$/, '')
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

const CHART_OPTS = {
  layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#9CA3AF' },
  grid: { vertLines: { color: '#1F2937' }, horzLines: { color: '#1F2937' } },
  crosshair: {
    vertLine: { color: '#6366F1', labelBackgroundColor: '#6366F1' },
    horzLine: { color: '#6366F1', labelBackgroundColor: '#6366F1' },
  },
  rightPriceScale: { borderColor: '#1F2937' },
  timeScale: { borderColor: '#1F2937' },
}

// ── 재학습 버튼 ───────────────────────────────────────────────

function fmtElapsed(sec: number | null): string {
  if (sec == null) return ''
  const m = Math.floor(sec / 60), s = sec % 60
  return m > 0 ? `${m}분 ${s}초` : `${s}초`
}

function RetrainButton() {
  const [status, setStatus] = useState<RetrainStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [tick, setTick] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  const isRunning = status?.status === 'running'

  // 폴링: 모달이 열려있을 때만
  useEffect(() => {
    if (!open) return
    const id = setInterval(async () => {
      try { setStatus(await aiApi.retrainStatus()) } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(id)
  }, [open])

  // 실행 중 경과시간 1초 tick
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [status?.log?.length])

  const handleOpen = async () => {
    setOpen(true)
    try { setStatus(await aiApi.retrainStatus()) } catch { /* ignore */ }
  }

  const handleStart = async (quick: boolean) => {
    const msg = quick
      ? '빠른 재학습을 시작합니다.\n• 데이터 수집 스킵 (이미 최신)\n• 15 Optuna trials (~2-3분)\n계속할까요?'
      : '전체 재학습을 시작합니다.\n• 3년치 데이터 재수집\n• 50 Optuna trials (~9분)\n계속할까요?'
    if (!confirm(msg)) return
    setStarting(true)
    try {
      await aiApi.startRetrain(quick)
      setStatus({ status: 'running', elapsed_sec: 0, log: [`[시작] ${quick ? '빠른' : '전체'} 재학습 파이프라인 실행 중...`] })
      const s = await aiApi.retrainStatus()
      setStatus(s)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const displayedElapsed = isRunning && status?.elapsed_sec != null
    ? status.elapsed_sec + tick
    : status?.elapsed_sec ?? null

  const statusLabel = !status || status.status === 'idle' ? '대기 중'
    : status.status === 'running' ? `실행 중 — ${fmtElapsed(displayedElapsed)}`
    : status.status === 'done' ? `완료 (${fmtElapsed(status.elapsed_sec)})`
    : `오류 (exit=${status.return_code})`

  return (
    <>
      <button
        onClick={handleOpen}
        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
          isRunning
            ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
            : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
        }`}
      >
        {isRunning
          ? <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-ping" />
              재학습 중 {fmtElapsed(displayedElapsed)}
            </span>
          : '재학습'}
      </button>

      {open && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)',
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{ background: '#111827', border: '1px solid #374151', borderRadius: '16px',
                     width: '100%', maxWidth: '512px', maxHeight: 'calc(100vh - 32px)',
                     display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* 헤더 — 고정 */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '16px 20px', borderBottom: '1px solid #1f2937' }}>
              <div>
                <p style={{ color: '#fff', fontWeight: 600, fontSize: '14px', margin: 0 }}>모델 재학습</p>
                <p style={{ color: '#6b7280', fontSize: '12px', margin: '2px 0 0' }}>target_5d · val_days=252</p>
              </div>
              <button onClick={() => setOpen(false)} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 본문 — 스크롤 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* 상태 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            background: 'rgba(31,41,55,0.6)', borderRadius: '8px', padding: '10px 16px' }}>
                <span style={{ color: '#9ca3af', fontSize: '14px' }}>상태</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {isRunning && (
                    <div style={{ width: 14, height: 14, border: '2px solid #facc15', borderTopColor: 'transparent',
                                  borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  )}
                  <span style={{ fontSize: '14px', fontWeight: 500,
                                 color: !status || status.status === 'idle' ? '#9ca3af'
                                      : status.status === 'running' ? '#facc15'
                                      : status.status === 'done' ? '#34d399' : '#f87171' }}>
                    {statusLabel}
                  </span>
                </div>
              </div>

              {/* 로그 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280', fontSize: '12px' }}>로그</span>
                  {isRunning && <span style={{ color: '#facc15', fontSize: '12px' }}>● 실행 중</span>}
                </div>
                <div ref={logRef}
                  style={{ background: '#030712', border: '1px solid #1f2937', borderRadius: '8px',
                           padding: '10px 12px', height: '200px', overflowY: 'auto',
                           fontFamily: 'monospace', fontSize: '12px' }}>
                  {(!status || status.log.length === 0)
                    ? <span style={{ color: '#374151' }}>로그 없음 — 재학습을 시작하면 여기에 출력됩니다</span>
                    : status.log.map((line, i) => (
                        <div key={i} style={{
                          color: line.includes('완료') || line.includes('Completed') ? '#34d399'
                               : line.includes('오류') || line.includes('Error') || line.includes('실패') ? '#f87171'
                               : line.includes('단계') || line.includes('===') ? '#fde68a'
                               : '#9ca3af',
                          marginBottom: '2px', wordBreak: 'break-all'
                        }}>{line}</div>
                      ))
                  }
                </div>
              </div>

              {/* 안내 */}
              <div style={{ background: 'rgba(31,41,55,0.4)', borderRadius: '8px', padding: '10px 12px',
                            fontSize: '12px', color: '#6b7280', lineHeight: '1.6' }}>
                <p style={{ margin: '0 0 6px', color: '#9ca3af', fontWeight: 500 }}>빠른 재학습 (~2-3분)</p>
                <p style={{ margin: '0 0 2px' }}>• 데이터 수집 스킵 (일일 업데이트가 이미 최신 유지)</p>
                <p style={{ margin: '0 0 8px' }}>• 15 Optuna trials — 정확도 소폭 감소, 빠른 모델 갱신</p>
                <p style={{ margin: '0 0 6px', color: '#9ca3af', fontWeight: 500 }}>전체 재학습 (~9분)</p>
                <p style={{ margin: '0 0 2px' }}>• 3년치 전종목 데이터 재수집 → 피처 → 50 trials 학습</p>
                <p style={{ margin: 0 }}>• 완료 후 서버가 자동으로 새 모델로 전환됩니다</p>
              </div>
            </div>

            {/* 버튼 — 고정 */}
            <div style={{ flexShrink: 0, padding: '16px 20px', borderTop: '1px solid #1f2937', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {isRunning ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                              background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)',
                              borderRadius: '8px', padding: '10px', color: '#facc15', fontSize: '14px' }}>
                  <div style={{ width: 14, height: 14, border: '2px solid #facc15', borderTopColor: 'transparent',
                                borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  학습 진행 중... {fmtElapsed(displayedElapsed)} 경과
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => handleStart(true)} disabled={starting}
                    style={{ flex: 1, background: starting ? '#065f46' : '#047857', border: 'none', borderRadius: '8px',
                             padding: '9px 8px', color: '#fff', fontSize: '13px', cursor: starting ? 'not-allowed' : 'pointer',
                             opacity: starting ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                    {starting && <div style={{ width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent',
                                              borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />}
                    ⚡ 빠른 재학습
                    <span style={{ fontSize: '11px', opacity: 0.8 }}>~2분</span>
                  </button>
                  <button onClick={() => handleStart(false)} disabled={starting}
                    style={{ flex: 1, background: starting ? '#4338ca' : '#4f46e5', border: 'none', borderRadius: '8px',
                             padding: '9px 8px', color: '#fff', fontSize: '13px', cursor: starting ? 'not-allowed' : 'pointer',
                             opacity: starting ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                    전체 재학습
                    <span style={{ fontSize: '11px', opacity: 0.8 }}>~9분</span>
                  </button>
                </div>
              )}
              <button onClick={() => setOpen(false)}
                style={{ width: '100%', padding: '7px 16px', background: '#1f2937', border: 'none', borderRadius: '8px',
                         color: '#d1d5db', fontSize: '14px', cursor: 'pointer' }}>
                닫기
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── 신호 강도 ──────────────────────────────────────────────────

function signalInfo(prob: number): { label: string; stars: number; cls: string } {
  if (prob >= 0.75) return { label: '강한 매수', stars: 5, cls: 'text-emerald-400' }
  if (prob >= 0.65) return { label: '매수', stars: 4, cls: 'text-green-400' }
  if (prob >= 0.55) return { label: '주목', stars: 3, cls: 'text-yellow-400' }
  if (prob >= 0.45) return { label: '중립', stars: 2, cls: 'text-gray-400' }
  return { label: '관망', stars: 1, cls: 'text-gray-500' }
}

function SignalStrength({ prob, size = 'sm' }: { prob: number; size?: 'sm' | 'md' }) {
  const { label, stars, cls } = signalInfo(prob)
  const starEl = Array.from({ length: 5 }, (_, i) => (
    <span key={i} className={i < stars ? cls : 'text-gray-700'}>★</span>
  ))
  return (
    <div className={`flex items-center gap-1.5 ${size === 'md' ? 'text-sm' : 'text-xs'}`}>
      <span className={`font-medium ${cls}`}>{label}</span>
      <span className="tracking-tight">{starEl}</span>
    </div>
  )
}

// ── 시장 배너 ─────────────────────────────────────────────────

function MarketBanner({ market }: { market: MarketTrend }) {
  const trendColor = market.trend === 'bull' ? 'emerald' : market.trend === 'bear' ? 'red' : 'yellow'
  const borderCls = `border-${trendColor}-500/30`
  const bgCls = `bg-${trendColor}-500/5`
  const textCls = `text-${trendColor}-400`
  const ret20Sign = market.ret_20d_pct >= 0 ? '+' : ''
  const ret5Sign  = market.ret_5d_pct  >= 0 ? '+' : ''

  return (
    <div className={`rounded-xl border ${borderCls} ${bgCls} px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2`}>
      <div className="flex items-center gap-2">
        <span className={`text-base font-bold ${textCls}`}>{market.label}</span>
        {market.badge && (
          <span className="text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
            {market.badge}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-400">5일 수익률: <span className={textCls}>{ret5Sign}{market.ret_5d_pct}%</span></span>
        <span className="text-gray-400">20일 수익률: <span className={textCls}>{ret20Sign}{market.ret_20d_pct}%</span></span>
        <span className="text-gray-400">모델 신뢰도:
          <span className={`ml-1 font-medium ${
            market.confidence === 'high' ? 'text-emerald-400' :
            market.confidence === 'low' ? 'text-red-400' : 'text-yellow-400'
          }`}>{
            market.confidence === 'high' ? '높음' :
            market.confidence === 'low' ? '낮음' : '보통'
          }</span>
        </span>
      </div>
    </div>
  )
}

// ── 일일 요약 ─────────────────────────────────────────────────

function DailySummaryCard({ summary, names }: { summary: DailySummary; names: Record<string, string> }) {
  const [open, setOpen] = useState(true)
  const { market, top3, caution, model_confidence } = summary

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold text-sm">📋 오늘의 아침 요약</span>
          <span className="text-gray-400 text-xs">{fmtDate(summary.date)}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-4 space-y-3 border-t border-gray-800">
          {/* 시장 상황 */}
          <div className="pt-3">
            <p className="text-gray-400 text-xs mb-1.5">시장 상황</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`font-bold text-sm ${
                market.trend === 'bull' ? 'text-emerald-400' :
                market.trend === 'bear' ? 'text-red-400' : 'text-yellow-400'
              }`}>{market.label}</span>
              <span className="text-gray-400 text-xs">20일: {market.ret_20d_pct >= 0 ? '+' : ''}{market.ret_20d_pct}%</span>
              <span className="text-gray-300 text-xs bg-gray-800 px-2 py-0.5 rounded">{caution}</span>
            </div>
          </div>

          {/* 핵심 3종목 */}
          <div>
            <p className="text-gray-400 text-xs mb-2">핵심 추천 3종목</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {top3.map((p, i) => {
                const { label, stars, cls } = signalInfo(p.probability)
                return (
                  <div key={p.symbol} className="bg-gray-800/60 rounded-lg px-3 py-2 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-xs">#{i + 1}</span>
                      <span className="text-white font-medium text-sm truncate">{names[p.symbol] || p.symbol}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${cls}`}>{label} {'★'.repeat(stars)}</span>
                      <span className={`text-xs font-bold ${cls}`}>{Math.round(p.probability * 100)}%</span>
                    </div>
                    <p className="text-gray-500 text-xs truncate">
                      {p.shap_top[0] ? `${p.shap_top[0].direction === 'up' ? '▲' : '▼'} ${p.shap_top[0].label}` : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 주의사항 */}
          <div className="text-xs text-gray-500 border-t border-gray-800 pt-2">
            모델 신뢰도 <span className={`font-medium ${
              model_confidence === '높음' ? 'text-emerald-400' :
              model_confidence === '낮음' ? 'text-red-400' : 'text-yellow-400'
            }`}>{model_confidence}</span>
            &nbsp;·&nbsp;백테스트 기준 5일 보유 전략 · 개인 판단 후 실행
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sparkline ──────────────────────────────────────────────────

function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <div className="h-9 bg-gray-800 rounded animate-pulse" />
  const min = Math.min(...prices), max = Math.max(...prices)
  const range = max - min || 1
  const W = 100, H = 36
  const pts = prices.map((v, i) => `${(i / (prices.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ')
  const isUp = prices[prices.length - 1] >= prices[0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-9">
      <polyline points={pts} fill="none" stroke={isUp ? '#EF4444' : '#3B82F6'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ── 지표 용어 설명 ────────────────────────────────────────────

const FEATURE_HINTS: Record<string, string> = {
  'ATR 비율':       'Average True Range를 주가로 나눈 변동성 지표. 클수록 가격 등락폭이 큼',
  '볼린저 폭':      '볼린저밴드 상·하단 간격 ÷ 중간선. 수축은 큰 움직임 예고, 확장은 추세 확인',
  'PBR':            '주가순자산비율. 주가 ÷ 주당순자산. 1 미만이면 장부가 이하 거래 중',
  'PER':            '주가수익비율. 주가 ÷ 주당순이익. 낮을수록 이익 대비 저평가 가능성',
  'RSI(14)':        '14일 상대강도지수(0~100). 30 이하 과매도(반등 기대), 70 이상 과매수(조정 경계)',
  'RSI(7)':         '7일 상대강도지수. RSI(14)보다 민감해 단기 과매수·과매도를 빠르게 포착',
  'MA5 이격':       '현재가 ÷ 5일 이동평균 − 1. 양수 = 단기 평균선 위, 클수록 단기 과열',
  'MA20 이격':      '현재가 ÷ 20일 이동평균 − 1. 20일선은 단기 추세의 기준선',
  'MA60 이격':      '현재가 ÷ 60일 이동평균 − 1. 중기 추세 이탈 정도',
  '5일MA 이격도':   '현재가 ÷ 5일 이동평균 − 1. 단기 과열·침체 판단',
  '20일MA 이격도':  '현재가 ÷ 20일 이동평균 − 1',
  '60일MA 이격도':  '현재가 ÷ 60일 이동평균 − 1. 중기 추세',
  '120일MA 이격도': '현재가 ÷ 120일 이동평균 − 1. 장기 추세 이탈 정도',
  '볼린저 위치':    '볼린저밴드 내 현재가 위치(0=하단, 1=상단). 0.1 이하 과매도권, 0.9 이상 과매수권',
  '거래량비(5일)':  '최근 5일 평균 거래량 ÷ 이전 기간 평균. 1 초과 = 거래 증가, 2 이상 = 급등 신호',
  '거래량비(20일)': '최근 20일 평균 거래량 ÷ 이전 기간 평균. 중기 매매 활발도',
  '시장대비(5일)':  '종목 5일 수익률 − KOSPI/KOSDAQ 5일 수익률. 양수 = 시장 초과 성과',
  '시장대비(20일)': '종목 20일 수익률 − KOSPI/KOSDAQ 20일 수익률. 양수 = 시장 초과 성과',
  '섹터대비(20일)': '종목 20일 수익률 − 동일 섹터 평균 수익률. 업종 내 상대적 강도',
  '5일 수익률':     '최근 5거래일 종가 기준 수익률',
  '60일 수익률':    '최근 60거래일 종가 기준 수익률. 중장기 모멘텀 확인',
  'MACD Hist':      'MACD − 신호선의 차. 양수 확대 = 상승 모멘텀 강화, 음수 확대 = 하락 가속',
  '외인 보유율':    '외국인 투자자 보유 비율(%). 높을수록 안정적 수요 기반',
  '외인 1일 변화':  '외국인 보유율의 전일 대비 변화(%p). 양수 = 순매수, 음수 = 순매도',
}

// ── ShapChip ───────────────────────────────────────────────────

function ShapChip({ entry }: { entry: ShapEntry }) {
  const isUp = entry.direction === 'up'
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
      isUp ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400'
    }`}>
      {isUp ? '▲' : '▼'} <span className="truncate max-w-[5rem]">{entry.label}</span>
    </span>
  )
}

// ── 전략 바 (카드 하단) ─────────────────────────────────────────

function StrategyBar({ strategy }: { strategy: TradeStrategy }) {
  const actionColor =
    strategy.action_label === '관망 권장' ? 'text-red-400' :
    strategy.action_label === '신중 진입' ? 'text-yellow-400' :
    'text-emerald-400'

  const riskColor =
    strategy.risk_level === '높음' ? 'text-red-400/70' :
    strategy.risk_level === '중간' ? 'text-yellow-400/70' :
    'text-emerald-400/70'

  const t = strategy.exit_targets
  return (
    <div className="flex items-center justify-between gap-1 text-xs">
      <span className={`font-semibold shrink-0 ${actionColor}`}>{strategy.action_label}</span>
      <span className="text-gray-500 shrink-0">
        목표 <span className="text-red-400">{t.target1_pct}</span>
        {' '}/ 손절 <span className="text-blue-400">{t.stop_loss_pct}</span>
      </span>
      <span className={`shrink-0 ${riskColor}`}>{strategy.risk_level}위험</span>
    </div>
  )
}

// ── PredictionCard ─────────────────────────────────────────────

interface PredictionWithMeta extends Prediction {
  name: string
  sparkline: number[]
}

function PredictionCard({
  pred, onClick, onCompareToggle, inCompare, watchlist, onStarChange,
}: {
  pred: PredictionWithMeta
  onClick: () => void
  onCompareToggle: (sym: string) => void
  inCompare: boolean
  watchlist: string[]
  onStarChange?: () => void
}) {
  const [starred, setStarred] = useState(watchlist.some(w => normalizeSymbol(w) === normalizeSymbol(pred.symbol)))
  const pct = Math.round(pred.probability * 100)

  const handleStar = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = toggleWatchlist(normalizeSymbol(pred.symbol))
    setStarred(next)
    onStarChange?.()
  }
  const handleCompare = (e: React.MouseEvent) => {
    e.stopPropagation()
    onCompareToggle(pred.symbol)
  }

  return (
    <div className={`relative bg-gray-900 border rounded-xl p-4 transition-all space-y-3 ${
      inCompare ? 'border-indigo-500/60 shadow-lg shadow-indigo-500/10' : 'border-gray-800 hover:border-emerald-500/40'
    }`}>
      {/* 상단 버튼 */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        <button onClick={handleCompare} title="비교에 추가"
          className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
            inCompare ? 'bg-indigo-500/30 text-indigo-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'
          }`}>비교</button>
        <button onClick={handleStar} title="관심 종목"
          className={`text-base transition-colors ${starred ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-400'}`}>
          ★
        </button>
      </div>

      <button onClick={onClick} className="w-full text-left group space-y-3">
        <div className="flex items-start gap-2 pr-16">
          <span className="shrink-0 text-xs font-bold text-gray-400 bg-gray-800 rounded px-1.5 py-0.5 group-hover:text-white transition-colors">
            #{pred.rank}
          </span>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm leading-tight truncate">
              {pred.name !== pred.symbol ? pred.name : '—'}
            </p>
            <p className="text-gray-400 text-xs">{pred.symbol}</p>
          </div>
        </div>

        <div className="space-y-1">
          <SignalStrength prob={pred.probability} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">상승 확률</span>
            <span className={`text-sm font-bold ${pct >= 75 ? 'text-emerald-400' : pct >= 60 ? 'text-green-400' : 'text-gray-300'}`}>{pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 60 ? 'bg-green-500/80' : 'bg-emerald-700/60'}`}
              style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {pred.shap_top.slice(0, 3).map((s, i) => <ShapChip key={i} entry={s} />)}
        </div>

        <div className="pt-1 border-t border-gray-800/60">
          {pred.sparkline.length > 0
            ? <Sparkline prices={pred.sparkline} />
            : <div className="h-9 bg-gray-800/50 rounded animate-pulse" />}
        </div>

        {pred.strategy && (
          <div className="pt-1 border-t border-gray-800/60">
            <StrategyBar strategy={pred.strategy} />
          </div>
        )}
      </button>
    </div>
  )
}

// ── 비교 패널 ─────────────────────────────────────────────────

function ComparePanel({
  symbols, names, details, onClose,
}: {
  symbols: string[]
  names: Record<string, string>
  details: Record<string, TickerDetail | null>
  onClose: () => void
}) {
  const KEY_ROWS = [
    { key: 'probability', label: '상승 확률', fmt: (v: number) => `${Math.round(v * 100)}%` },
    { key: 'rank', label: '순위', fmt: (v: number) => `#${v}` },
    { key: 'rsi_14', label: 'RSI(14)', fmt: (v: number) => v.toFixed(1) },
    { key: 'ma20_dev', label: 'MA20 이격', fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
    { key: 'bb_pct', label: '볼린저 위치', fmt: (v: number) => v.toFixed(2) },
    { key: 'vol_ratio_5d', label: '거래량비(5일)', fmt: (v: number) => `${v.toFixed(2)}×` },
    { key: 'foreign_rate', label: '외인 보유율', fmt: (v: number) => `${v.toFixed(1)}%` },
    { key: 'per', label: 'PER', fmt: (v: number) => v.toFixed(1) },
    { key: 'pbr', label: 'PBR', fmt: (v: number) => v.toFixed(2) },
  ]

  return (
    <div className="bg-gray-900 border border-indigo-500/30 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <span className="text-white font-semibold text-sm">종목 비교</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">닫기</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left text-gray-500 px-4 py-2 font-normal w-28">지표</th>
              {symbols.map(s => (
                <th key={s} className="text-center px-4 py-2 font-medium text-white">
                  <div>{names[s] || s}</div>
                  <div className="text-gray-400 font-normal">{s}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KEY_ROWS.map(({ key, label, fmt }) => {
              const vals = symbols.map(s => {
                const d = details[s]
                if (!d) return null
                if (key === 'probability') return d.probability
                if (key === 'rank') return d.rank
                return d.recent_features[key]
              })
              const nums = vals.filter((v): v is number => v != null)
              const best = nums.length ? Math.max(...nums) : null

              return (
                <tr key={key} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                  <td className="text-gray-400 px-4 py-2">{label}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={`text-center px-4 py-2 font-mono ${
                      v != null && v === best ? 'text-emerald-400 font-bold' : 'text-gray-300'
                    }`}>
                      {v == null ? '—' : fmt(v)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── SHAP Bar ───────────────────────────────────────────────────

function ShapBarChart({ shaps }: { shaps: ShapEntry[] }) {
  const visible = shaps.slice(0, 14)
  const maxAbs = Math.max(...visible.map(s => Math.abs(s.shap)), 0.001)
  return (
    <div className="space-y-2">
      {visible.map((s, i) => {
        const pct = (Math.abs(s.shap) / maxAbs) * 100
        const isUp = s.direction === 'up'
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-28 text-gray-300 text-right truncate shrink-0 cursor-help"
              title={FEATURE_HINTS[s.label]}>{s.label}</div>
            <div className="flex-1 relative h-3 bg-gray-800 rounded overflow-hidden">
              <div className={`absolute inset-y-0 left-0 rounded ${isUp ? 'bg-red-500/50' : 'bg-blue-500/50'}`}
                style={{ width: `${pct}%` }} />
            </div>
            <div className={`w-14 text-right font-mono tabular-nums ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
              {isUp ? '+' : ''}{s.shap.toFixed(4)}
            </div>
          </div>
        )
      })}
      <p className="text-gray-400 text-xs pt-1">▲ 빨간색: 상승 기여 · ▼ 파란색: 하락 기여</p>
    </div>
  )
}

// ── Feature Grid ───────────────────────────────────────────────

const KEY_FEATURES: { key: string; label: string; fmt: (v: number) => string; hint?: (v: number) => { text: string; cls: string } | null }[] = [
  { key: 'rsi_14', label: 'RSI(14)', fmt: v => v.toFixed(1), hint: v => v < 30 ? { text: '과매도', cls: 'text-red-400' } : v > 70 ? { text: '과매수', cls: 'text-blue-400' } : null },
  { key: 'rsi_7', label: 'RSI(7)', fmt: v => v.toFixed(1) },
  { key: 'ma5_dev', label: 'MA5 이격', fmt: v => `${(v * 100).toFixed(2)}%` },
  { key: 'ma20_dev', label: 'MA20 이격', fmt: v => `${(v * 100).toFixed(2)}%` },
  { key: 'ma60_dev', label: 'MA60 이격', fmt: v => `${(v * 100).toFixed(2)}%` },
  { key: 'bb_pct', label: '볼린저 위치', fmt: v => v.toFixed(2), hint: v => v < 0.1 ? { text: '하단', cls: 'text-red-400' } : v > 0.9 ? { text: '상단', cls: 'text-blue-400' } : null },
  { key: 'macd_hist', label: 'MACD Hist', fmt: v => v.toFixed(4) },
  { key: 'vol_ratio_5d', label: '거래량비(5일)', fmt: v => `${v.toFixed(2)}×` },
  { key: 'foreign_rate', label: '외인 보유율', fmt: v => `${v.toFixed(1)}%` },
  { key: 'foreign_1d_chg', label: '외인 1일 변화', fmt: v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%` },
  { key: 'per', label: 'PER', fmt: v => v.toFixed(1) },
  { key: 'pbr', label: 'PBR', fmt: v => v.toFixed(2) },
]

function FeatureGrid({ features }: { features: Record<string, number | null> }) {
  const items = KEY_FEATURES.filter(({ key }) => features[key] != null)
  if (items.length === 0) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {items.map(({ key, label, fmt, hint }) => {
        const val = features[key] as number
        const h = hint?.(val)
        return (
          <div key={key} className="bg-gray-800/60 rounded-lg px-3 py-2">
            <p className="text-gray-400 text-xs mb-0.5 cursor-help" title={FEATURE_HINTS[label]}>{label}</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-white font-mono text-sm font-medium">{fmt(val)}</span>
              {h && <span className={`text-xs ${h.cls}`}>{h.text}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── 차트 ──────────────────────────────────────────────────────

function ModalChart({ priceHistory }: { priceHistory: PriceBar[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || priceHistory.length === 0) return
    const el = ref.current
    const chart = createChart(el, { ...CHART_OPTS, height: 260, width: el.clientWidth })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#EF4444', downColor: '#3B82F6',
      borderUpColor: '#EF4444', borderDownColor: '#3B82F6',
      wickUpColor: '#EF4444', wickDownColor: '#3B82F6',
    })
    series.setData(priceHistory.map(p => ({ time: yyyymmddToTs(p.time), open: p.open, high: p.high, low: p.low, close: p.close })))
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => { chart.remove(); ro.disconnect() }
  }, [priceHistory])
  return <div ref={ref} />
}

function BacktestChart({ dates, values }: { dates: string[]; values: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current || dates.length === 0) return
    const el = ref.current
    const isPos = values[values.length - 1] >= 0
    const chart = createChart(el, { ...CHART_OPTS, height: 200, width: el.clientWidth })
    const series = chart.addSeries(LineSeries, { color: isPos ? '#10B981' : '#EF4444', lineWidth: 2 })
    series.setData(dates.map((d, i) => ({ time: yyyymmddToTs(d), value: values[i] })))
    series.createPriceLine({ price: 0, color: '#374151', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => { chart.remove(); ro.disconnect() }
  }, [dates, values])
  return <div ref={ref} />
}

// ── 메모 패널 ─────────────────────────────────────────────────

function MemoPanel({ symbol }: { symbol: string }) {
  const [text, setText] = useState(() => getMemo(symbol))
  const [saved, setSaved] = useState(false)
  const save = () => { saveMemo(symbol, text); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="이 종목에 대한 본인 분석, 매수 이유, 주의사항 등을 기록하세요..."
        className="w-full h-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-emerald-400 text-xs">저장됨</span>}
        <button onClick={save} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors">
          저장
        </button>
      </div>
    </div>
  )
}

// ── 가상 매매 패널 ────────────────────────────────────────────

function VirtualTradePanel({ symbol }: { symbol: string }) {
  const [trades, setTrades] = useState<VirtualTrade[]>(() => getVirtualTrades(symbol))
  const [form, setForm] = useState({ action: 'buy' as 'buy' | 'sell', date: todayStr(), price: '', shares: '', note: '' })

  const addTrade = () => {
    if (!form.price || !form.shares) return
    addVirtualTrade({ symbol, ...form, price: +form.price, shares: +form.shares })
    setTrades(getVirtualTrades(symbol))
    setForm(f => ({ ...f, price: '', shares: '', note: '' }))
  }
  const delTrade = (id: string) => { deleteVirtualTrade(id); setTrades(getVirtualTrades(symbol)) }

  const totalBuy = trades.filter(t => t.action === 'buy').reduce((s, t) => s + t.price * t.shares, 0)
  const totalSell = trades.filter(t => t.action === 'sell').reduce((s, t) => s + t.price * t.shares, 0)
  const pnl = totalSell - totalBuy

  return (
    <div className="space-y-3">
      {/* 입력 폼 */}
      <div className="bg-gray-800/60 rounded-lg p-3 space-y-2">
        <p className="text-gray-300 text-xs font-medium">거래 기록 추가</p>
        <div className="grid grid-cols-2 gap-2">
          <select value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value as 'buy' | 'sell' }))}
            className="bg-gray-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none">
            <option value="buy">매수</option>
            <option value="sell">매도</option>
          </select>
          <input type="text" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            placeholder="날짜 YYYYMMDD" className="bg-gray-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder:text-gray-500" />
          <input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
            placeholder="가격 (원)" className="bg-gray-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder:text-gray-500" />
          <input type="number" value={form.shares} onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
            placeholder="수량 (주)" className="bg-gray-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder:text-gray-500" />
        </div>
        <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          placeholder="메모 (선택)" className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder:text-gray-500" />
        <button onClick={addTrade} className="w-full text-xs bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 rounded transition-colors">
          기록 추가
        </button>
      </div>

      {/* 손익 요약 */}
      {trades.length > 0 && (
        <div className="flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2 text-xs">
          <span className="text-gray-400">가상 손익</span>
          <span className={`font-bold ${pnl >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toLocaleString()}원
          </span>
        </div>
      )}

      {/* 거래 목록 */}
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {trades.length === 0 && <p className="text-gray-500 text-xs text-center py-3">거래 기록 없음</p>}
        {trades.map(t => (
          <div key={t.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className={`font-bold ${t.action === 'buy' ? 'text-red-400' : 'text-blue-400'}`}>
                {t.action === 'buy' ? '매수' : '매도'}
              </span>
              <span className="text-gray-400">{fmtDate(t.date)}</span>
              <span className="text-white">{t.price.toLocaleString()}원 × {t.shares}주</span>
              {t.note && <span className="text-gray-500 truncate max-w-[8rem]">{t.note}</span>}
            </div>
            <button onClick={() => delTrade(t.id)} className="text-gray-600 hover:text-red-400 transition-colors ml-2">✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 매매 전략 패널 ────────────────────────────────────────────

function StrategyPanel({ strategy }: { strategy?: TradeStrategy }) {
  if (!strategy) {
    return <p className="text-gray-500 text-sm py-8 text-center">전략 데이터 없음</p>
  }

  const actionColor =
    strategy.action_label === '관망 권장' ? { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400' } :
    strategy.action_label === '신중 진입' ? { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' } :
    { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' }

  const riskColor =
    strategy.risk_level === '높음' ? 'text-red-400' :
    strategy.risk_level === '중간' ? 'text-yellow-400' :
    'text-emerald-400'

  const t = strategy.exit_targets
  const e = strategy.entry

  return (
    <div className="space-y-4">
      {/* 진입 판단 */}
      <div className={`rounded-xl border p-4 ${actionColor.bg} ${actionColor.border}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-base font-bold ${actionColor.text}`}>{strategy.action_label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${actionColor.border} ${actionColor.text}`}>
            위험 {strategy.risk_level}
          </span>
        </div>
        <p className="text-gray-300 text-xs leading-relaxed">{strategy.action_reason}</p>
      </div>

      {/* 경고 */}
      {strategy.warnings.length > 0 && (
        <div className="space-y-1.5">
          {strategy.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-300">
              <span className="shrink-0 mt-0.5">⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* 2열 레이아웃: 진입가 + 목표/손절 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* 진입 가격대 */}
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-3">
          <p className="text-gray-300 text-xs font-semibold uppercase tracking-wide">진입 가격대</p>
          {e.caution && (
            <p className="text-red-400 text-xs">{e.caution}</p>
          )}
          {e.warning && (
            <p className="text-yellow-400 text-xs">{e.warning}</p>
          )}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">매수 하한</span>
              <span className="text-white font-mono font-medium">
                {e.buy_price_low.toLocaleString()}원
                <span className="text-blue-400 ml-1">({e.buy_low_pct})</span>
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">매수 상한</span>
              <span className="text-white font-mono font-medium">
                {e.buy_price_high.toLocaleString()}원
                <span className="text-red-400 ml-1">({e.buy_high_pct})</span>
              </span>
            </div>
          </div>
        </div>

        {/* 목표가 / 손절가 */}
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-3">
          <p className="text-gray-300 text-xs font-semibold uppercase tracking-wide">목표가 / 손절가</p>
          <div className="space-y-2">
            <div className="flex justify-between items-start text-xs gap-2">
              <span className="text-red-400 shrink-0">목표 1</span>
              <div className="text-right">
                <p className="text-white font-mono">{t.target1_price.toLocaleString()}원 <span className="text-red-400">({t.target1_pct})</span></p>
                <p className="text-gray-500">{t.target1_action}</p>
              </div>
            </div>
            <div className="flex justify-between items-start text-xs gap-2">
              <span className="text-red-300 shrink-0">목표 2</span>
              <div className="text-right">
                <p className="text-white font-mono">{t.target2_price.toLocaleString()}원 <span className="text-red-300">({t.target2_pct})</span></p>
                <p className="text-gray-500">{t.target2_action}</p>
              </div>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between items-start text-xs gap-2">
              <span className="text-blue-400 shrink-0">손절</span>
              <div className="text-right">
                <p className="text-white font-mono">{t.stop_loss_price.toLocaleString()}원 <span className="text-blue-400">({t.stop_loss_pct})</span></p>
                <p className="text-gray-500">{t.stop_loss_action}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 포지션 크기 + 보유 전략 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
          <p className="text-gray-300 text-xs font-semibold uppercase tracking-wide">포지션 비중</p>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${riskColor}`}>{strategy.position.weight_pct}%</span>
            <span className="text-gray-400 text-xs">변동성 {strategy.position.weight_label}</span>
          </div>
          <p className="text-gray-500 text-xs">총 투자금 대비 이 종목 권장 비중</p>
        </div>
        <div className="bg-gray-800/60 rounded-xl p-4 space-y-2">
          <p className="text-gray-300 text-xs font-semibold uppercase tracking-wide">보유 전략</p>
          <p className="text-white text-xs font-medium">최대 {strategy.holding.max_days}거래일</p>
          <p className="text-gray-400 text-xs leading-relaxed">{strategy.holding.strategy}</p>
        </div>
      </div>
    </div>
  )
}

// ── 상세 모달 ─────────────────────────────────────────────────

type ModalTab = 'analysis' | 'strategy' | 'memo' | 'trade'

function DetailModal({
  symbol, name, detail, loading, error, onClose,
}: {
  symbol: string; name: string; detail: TickerDetail | null
  loading: boolean; error: string | null; onClose: () => void
}) {
  const [tab, setTab] = useState<ModalTab>('analysis')
  const [starred, setStarred] = useState(() => getWatchlist().includes(symbol))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleStar = () => { const next = toggleWatchlist(normalizeSymbol(symbol)); setStarred(next) }

  const TABS: { id: ModalTab; label: string }[] = [
    { id: 'analysis', label: 'AI 분석' },
    { id: 'strategy', label: '매매 전략' },
    { id: 'memo', label: '메모' },
    { id: 'trade', label: '가상 매매' },
  ]

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-4xl my-8" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 rounded-t-2xl z-10">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={handleStar} className={`text-xl transition-colors shrink-0 ${starred ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-300'}`}>★</button>
            <div className="min-w-0">
              <h2 className="text-white font-bold text-base leading-tight truncate">{name && name !== symbol ? name : symbol}</h2>
              <p className="text-gray-400 text-xs">{symbol}</p>
            </div>
            {detail && (
              <>
                <div className="h-8 w-px bg-gray-700 shrink-0" />
                <div className="shrink-0 space-y-0.5">
                  <SignalStrength prob={detail.probability} size="md" />
                  <p className={`text-lg font-bold leading-none ${detail.probability >= 0.7 ? 'text-emerald-400' : 'text-gray-200'}`}>
                    {Math.round(detail.probability * 100)}%
                  </p>
                </div>
                {detail.rank != null && (
                  <>
                    <div className="h-8 w-px bg-gray-700 shrink-0" />
                    <div className="text-center shrink-0">
                      <p className="text-lg font-bold text-gray-200">#{detail.rank}</p>
                      <p className="text-gray-400 text-xs">전체 순위</p>
                    </div>
                  </>
                )}
                <div className="h-8 w-px bg-gray-700 shrink-0" />
                <p className="text-gray-400 text-xs shrink-0">{fmtDate(detail.date)} 기준</p>
              </>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 ml-3 text-gray-400 hover:text-white transition-colors p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-6 py-2.5 text-sm font-medium transition-colors ${
                tab === t.id ? 'text-white border-b-2 border-indigo-500' : 'text-gray-400 hover:text-gray-200'
              }`}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="space-y-2 text-center">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-gray-500 text-sm">분석 데이터 로딩 중...</p>
              </div>
            </div>
          )}
          {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">{error}</div>}

          {detail && !loading && (
            <>
              {tab === 'analysis' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <h3 className="text-white font-medium text-sm">AI 예측 근거 (SHAP 기여도)</h3>
                      <ShapBarChart shaps={detail.shap_full} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-white font-medium text-sm">최근 {detail.price_history.length}일 주가</h3>
                      <ModalChart priceHistory={detail.price_history} />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-white font-medium text-sm mb-3">주요 기술 지표</h3>
                    <FeatureGrid features={detail.recent_features} />
                  </div>
                  <details className="group">
                    <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200 transition-colors select-none list-none flex items-center gap-1">
                      <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      지표 용어 설명
                    </summary>
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {Object.entries(FEATURE_HINTS).map(([term, desc]) => (
                        <div key={term} className="bg-gray-800/40 rounded-lg px-3 py-2 space-y-0.5">
                          <p className="text-gray-200 text-xs font-semibold">{term}</p>
                          <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
              {tab === 'strategy' && (
                <StrategyPanel strategy={detail.strategy} />
              )}
              {tab === 'memo' && (
                <div>
                  <p className="text-gray-400 text-xs mb-3">개인 분석 메모 (기기 로컬 저장)</p>
                  <MemoPanel symbol={symbol} />
                </div>
              )}
              {tab === 'trade' && (
                <div>
                  <p className="text-gray-400 text-xs mb-3">가상 매수/매도 기록 (실제 거래 아님, 기기 로컬 저장)</p>
                  <VirtualTradePanel symbol={symbol} />
                </div>
              )}
            </>
          )}
          {!detail && !loading && !error && tab !== 'analysis' && (
            <div className="space-y-4">
              {tab === 'strategy' && <StrategyPanel />}
              {tab === 'memo' && <MemoPanel symbol={symbol} />}
              {tab === 'trade' && <VirtualTradePanel symbol={symbol} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 시장 국면 경고 배너 ───────────────────────────────────────

const MARKET_MODE_DETAIL: Record<string, string> = {
  cautious:  '횡보장에서는 추세 전환 신호가 약합니다. 강한 확신이 있는 종목만 추천하며, 분할 매수와 손절 라인을 명확히 설정하세요.',
  defensive: '약세장에서는 대부분의 매수 신호가 데드캣 바운스(일시적 반등)일 가능성이 있습니다. 추천 종목 수를 5개로 제한했으며, 현금 비중 70% 이상 유지를 권장합니다.',
}

function MarketModeBanner({ mode, message }: { mode: string; message: string }) {
  const [expanded, setExpanded] = useState(false)
  if (mode === 'aggressive' || !message) return null

  const isDefensive = mode === 'defensive'
  const detail = MARKET_MODE_DETAIL[mode] ?? ''

  return (
    <div className={`rounded-xl border px-4 py-3 space-y-2 ${
      isDefensive
        ? 'border-red-500/30 bg-red-500/10'
        : 'border-yellow-500/30 bg-yellow-500/10'
    }`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base">{isDefensive ? '🔴' : '🟡'}</span>
          <span className={`font-semibold text-sm ${isDefensive ? 'text-red-300' : 'text-yellow-300'}`}>
            {message}
          </span>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className={`text-xs shrink-0 transition-colors ${
            isDefensive ? 'text-red-400 hover:text-red-200' : 'text-yellow-400 hover:text-yellow-200'
          }`}
        >
          {expanded ? '닫기 ▲' : '자세히 보기 ▼'}
        </button>
      </div>
      {expanded && (
        <p className={`text-xs leading-relaxed border-t pt-2 ${
          isDefensive
            ? 'border-red-500/20 text-red-300/80'
            : 'border-yellow-500/20 text-yellow-300/80'
        }`}>
          {detail}
        </p>
      )}
    </div>
  )
}

// ── 공시 위험 제외 종목 ────────────────────────────────────────

const SEVERITY_STYLES = {
  critical: {
    badge: 'bg-red-500/20 text-red-300 border border-red-500/40',
    panel: 'bg-red-500/5 border border-red-500/20',
    accent: 'text-red-400',
    dot: 'bg-red-400',
  },
  high: {
    badge: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    panel: 'bg-orange-500/5 border border-orange-500/20',
    accent: 'text-orange-400',
    dot: 'bg-orange-400',
  },
  medium: {
    badge: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    panel: 'bg-yellow-500/5 border border-yellow-500/20',
    accent: 'text-yellow-400',
    dot: 'bg-yellow-400',
  },
} as const

function ExcludedStockRow({
  ex, name, code, onClickSymbol,
}: {
  ex: ExcludedStock
  name: string
  code: string
  onClickSymbol: (symbol: string, name: string) => void
}) {
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const a = ex.analysis
  const sty = a ? SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.high : SEVERITY_STYLES.high

  return (
    <div className="border-b border-gray-800/50 last:border-0">
      {/* 종목 행 */}
      <div
        onClick={() => onClickSymbol(code, name)}
        className="flex flex-col sm:flex-row sm:items-start gap-3 px-5 py-3 hover:bg-gray-800/30 transition-colors cursor-pointer"
      >
        <div className="sm:w-40 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {ex.rank != null && (
              <span className="text-gray-500 text-xs font-mono">#{ex.rank}</span>
            )}
            <p className="text-white text-sm font-medium truncate">{name}</p>
            {a && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${sty.badge}`}>
                {a.severity_label}
              </span>
            )}
          </div>
          <p className="text-gray-400 text-xs mt-0.5">{code}</p>
        </div>

        {/* 공시 목록 */}
        <div className="flex-1 space-y-1.5">
          {ex.risks.map((risk, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
              <span className="shrink-0 bg-orange-500/15 text-orange-300 border border-orange-500/30 px-1.5 py-0.5 rounded font-medium">
                {risk.matched_keyword}
              </span>
              {risk.rcept_no ? (
                <a
                  href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${risk.rcept_no}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-orange-300/80 hover:text-orange-200 underline underline-offset-2 flex-1 min-w-0 truncate"
                >
                  {risk.report_nm}
                </a>
              ) : (
                <span className="text-gray-300 flex-1 min-w-0 truncate">{risk.report_nm}</span>
              )}
              <span className="shrink-0 text-gray-500">{fmtDate(risk.rcept_dt)}</span>
            </div>
          ))}
        </div>

        {/* 분석 토글 버튼 */}
        {a && (
          <button
            onClick={e => { e.stopPropagation(); setAnalysisOpen(o => !o) }}
            className={`shrink-0 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              analysisOpen
                ? `${sty.badge} opacity-100`
                : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500'
            }`}
          >
            {analysisOpen ? '분석 닫기' : '영향 분석 ▾'}
          </button>
        )}
      </div>

      {/* 분석 패널 */}
      {a && analysisOpen && (
        <div className={`mx-4 mb-3 rounded-xl p-4 ${sty.panel}`}>
          {/* 헤더 */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className={`text-xs font-semibold uppercase tracking-wide ${sty.accent}`}>
              주가 영향 분석
            </span>
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <span className="text-gray-500">방향</span>
              <span className={`font-medium ${sty.accent}`}>{a.direction}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <span className="text-gray-500">예상 등락</span>
              <span className="font-medium text-white">{a.range}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-300">
              <span className="text-gray-500">반응 시점</span>
              <span className="text-gray-300">{a.timing}</span>
            </div>
          </div>

          {/* 분석 본문 */}
          <p className="text-gray-300 text-xs leading-relaxed">{a.analysis}</p>

          {/* 재순위 가능 여부 */}
          <div className={`mt-3 pt-3 border-t ${
            a.severity === 'critical' ? 'border-red-500/20' :
            a.severity === 'high' ? 'border-orange-500/20' : 'border-yellow-500/20'
          }`}>
            {a.rerank_eligible ? (
              <p className="text-xs text-yellow-300/80">
                ⚡ 아래 재순위 결과에 주의 등급으로 포함됩니다 — 공시 원문 확인 후 판단하세요.
              </p>
            ) : (
              <p className={`text-xs ${sty.accent}`}>
                ✕ 위험도가 높아 재순위에서도 제외됩니다.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExcludedSection({
  excluded, names, onClickSymbol,
}: {
  excluded: ExcludedStock[]
  names: Record<string, string>
  onClickSymbol: (symbol: string, name: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (excluded.length === 0) return null

  return (
    <div className="bg-gray-900 border border-yellow-500/20 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">⚠️</span>
          <span className="text-yellow-300 font-medium text-sm">
            공시 위험으로 제외된 {excluded.length}종목 — 영향 분석 보기
          </span>
          <span className="text-gray-500 text-xs hidden sm:block">— AI 추천에서 제외됨</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-800">
          {excluded.map(ex => {
            const code = normalizeSymbol(ex.symbol)
            const name = names[code] ?? '—'
            return (
              <ExcludedStockRow
                key={ex.symbol}
                ex={ex} name={name} code={code}
                onClickSymbol={onClickSymbol}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 쿨다운 제외 종목 ──────────────────────────────────────────

function CooldownSection({
  excluded, names, onClickSymbol,
}: {
  excluded: CooldownStock[]
  names: Record<string, string>
  onClickSymbol: (symbol: string, name: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (excluded.length === 0) return null

  return (
    <div className="bg-gray-900 border border-blue-500/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-400">🔄</span>
          <span className="text-blue-300 font-medium text-sm">
            최근 추천으로 쿨다운된 {excluded.length}종목 보기
          </span>
          <span className="text-gray-500 text-xs hidden sm:block">— 5일 재진입 차단</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-800 divide-y divide-gray-800/50">
          {excluded.map(ex => {
            const code = normalizeSymbol(ex.symbol)
            const name = names[code] ?? '—'
            return (
              <div
                key={ex.symbol}
                onClick={() => onClickSymbol(code, name)}
                className="flex items-center gap-4 px-5 py-3 hover:bg-gray-800/30 transition-colors cursor-pointer"
              >
                <div className="w-36 shrink-0">
                  <div className="flex items-center gap-1.5">
                    {ex.rank != null && (
                      <span className="text-gray-500 text-xs font-mono">#{ex.rank}</span>
                    )}
                    <p className="text-white text-sm font-medium truncate">{name}</p>
                  </div>
                  <p className="text-gray-400 text-xs">{code}</p>
                </div>
                <span className="text-xs bg-blue-500/15 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded">
                  {ex.reason}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Backtest 섹션 ─────────────────────────────────────────────

const METRIC_GUIDE = [
  { term: 'AUC', desc: '모델이 상승/비상승 종목을 얼마나 잘 구별하는지. 0.5 = 동전 던지기, 1.0 = 완벽. 0.7 이상이면 실용적 수준.' },
  { term: 'P@K', desc: '상위 K개 추천 종목 중 실제로 기준 이상 상승한 비율.' },
  { term: '누적 수익률', desc: '수수료·거래세·슬리피지·유동성 필터 반영 후 현실적 가상 수익률.' },
  { term: 'Sharpe Ratio', desc: '위험 1단위당 초과수익. 1 이상 양호, 2 이상 우수.' },
  { term: 'MDD', desc: '고점 대비 최대 낙폭. 작을수록 안정적.' },
  { term: '승률', desc: '추천 포트폴리오가 해당 보유 기간 동안 플러스 수익을 낸 비율.' },
]

function StatCard({ label, value, cls, hint }: { label: string; value: string; cls: string; hint?: string }) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-3 py-2.5 text-center space-y-0.5">
      <p className="text-gray-400 text-xs">{label}</p>
      <p className={`font-bold text-lg ${cls}`}>{value}</p>
      {hint && <p className="text-gray-400 text-xs leading-tight">{hint}</p>}
    </div>
  )
}

function CostsBadge({ costs }: { costs: CostsApplied }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-4 py-3 space-y-2">
      <p className="text-gray-300 text-xs font-medium">반영된 매매 비용 및 필터</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2">
        <div><p className="text-gray-500 text-xs">수수료 (양방향)</p><p className="text-gray-200 text-sm font-medium">{costs.commission_pct}% × 2</p></div>
        <div><p className="text-gray-500 text-xs">증권거래세 (매도)</p><p className="text-gray-200 text-sm font-medium">{costs.sell_tax_pct}%</p></div>
        <div><p className="text-gray-500 text-xs">슬리피지 (양방향)</p><p className="text-gray-200 text-sm font-medium">{costs.slippage_pct}% × 2</p></div>
        <div><p className="text-gray-500 text-xs">유동성 기준</p><p className="text-gray-200 text-sm font-medium">일 {costs.min_volume_bn}억 이상</p></div>
        <div><p className="text-gray-500 text-xs">매일 평균 제외</p><p className="text-yellow-400 text-sm font-medium">{Math.round(costs.avg_excluded_per_day)}개</p></div>
      </div>
    </div>
  )
}

function BacktestSection({ perf }: { perf: PerformanceResponse }) {
  const bt = perf.backtest
  const topk = perf.precision_at_topk
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-white font-semibold text-sm">백테스트 성과</h2>
          <p className="text-gray-400 text-xs mt-0.5">
            {bt?.costs_applied ? '수수료·거래세·슬리피지·유동성 필터 반영 현실적 성과' : '검증 기간 기준 · 가상 성과'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          {perf.val_auc != null && (
            <div className="text-center">
              <span className="block text-xs text-gray-400">AUC</span>
              <span className="text-white font-bold text-base">{perf.val_auc.toFixed(3)}</span>
              <span className="block text-xs text-gray-400">{perf.val_auc >= 0.75 ? '우수' : perf.val_auc >= 0.65 ? '양호' : '보통'}</span>
            </div>
          )}
          {topk && Object.entries(topk).map(([k, v]) => (
            <div key={k} className="text-center">
              <span className="block text-xs text-gray-400">P@{k}</span>
              <span className="text-white font-bold text-base">{(v * 100).toFixed(1)}%</span>
              <span className="block text-xs text-gray-400">상위{k}중 적중</span>
            </div>
          ))}
        </div>
      </div>

      {bt ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="누적 수익률 (비용 후)" value={`${bt.total_return_pct > 0 ? '+' : ''}${bt.total_return_pct.toFixed(1)}%`}
              cls={bt.total_return_pct > 0 ? 'text-red-400' : 'text-blue-400'}
              hint={bt.gross_total_return_pct != null ? `비용 전 ${bt.gross_total_return_pct > 0 ? '+' : ''}${bt.gross_total_return_pct.toFixed(1)}%` : undefined} />
            <StatCard label="Sharpe (비용 후)" value={bt.sharpe_ratio.toFixed(2)}
              cls={bt.sharpe_ratio > 1 ? 'text-emerald-400' : bt.sharpe_ratio > 0 ? 'text-gray-300' : 'text-blue-400'}
              hint={bt.gross_sharpe_ratio != null ? `비용 전 ${bt.gross_sharpe_ratio.toFixed(2)}` : undefined} />
            <StatCard label="최대 낙폭 MDD" value={`${bt.max_drawdown_pct.toFixed(1)}%`} cls="text-blue-400" hint="고점 대비 최대 손실" />
            <StatCard label="승률 (비용 후)" value={`${(bt.win_rate * 100).toFixed(1)}%`}
              cls={bt.win_rate > 0.5 ? 'text-red-400' : 'text-gray-300'}
              hint={bt.gross_win_rate != null ? `비용 전 ${(bt.gross_win_rate * 100).toFixed(1)}%` : undefined} />
          </div>
          {bt.costs_applied && <CostsBadge costs={bt.costs_applied} />}
          <BacktestChart dates={bt.dates} values={bt.cumulative_return_pct} />
        </>
      ) : (
        <p className="text-gray-500 text-sm py-4">백테스트 데이터 없음</p>
      )}

      <details className="group">
        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200 transition-colors select-none list-none flex items-center gap-1">
          <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          지표 용어 설명
        </summary>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {METRIC_GUIDE.map(({ term, desc }) => (
            <div key={term} className="bg-gray-800/40 rounded-lg px-3 py-2 space-y-0.5">
              <p className="text-gray-200 text-xs font-semibold">{term}</p>
              <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────

export default function AIRecommendPage() {
  const navigate = useNavigate()
  const [predictions, setPredictions] = useState<PredictionWithMeta[]>([])
  const [perf, setPerf] = useState<PerformanceResponse | null>(null)
  const [market, setMarket] = useState<MarketTrend | null>(null)
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})

  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false)
  const [watchlist, setWatchlist] = useState<string[]>(() => getWatchlist())
  const [watchlistExtras, setWatchlistExtras] = useState<PredictionWithMeta[]>([])
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  const [excluded, setExcluded] = useState<ExcludedStock[]>([])
  const [excludedCooldown, setExcludedCooldown] = useState<CooldownStock[]>([])
  const [marketMode, setMarketMode] = useState<string>('aggressive')
  const [marketMessage, setMarketMessage] = useState<string>('')

  const [showRerank, setShowRerank] = useState(false)

  const [compareList, setCompareList] = useState<string[]>([])
  const [compareDetails, setCompareDetails] = useState<Record<string, TickerDetail | null>>({})

  const [modalSymbol, setModalSymbol] = useState<string | null>(null)
  const [modalName, setModalName] = useState('')
  const [detail, setDetail] = useState<TickerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // ── 초기 로드 ──
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    let cancelled = false
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const [todayResp, perfResp, marketResp] = await Promise.all([
          aiApi.predictions(30), aiApi.performance(), aiApi.marketTrend(),
        ])
        if (cancelled) return
        setPerf(perfResp); setDate(todayResp.date); setMarket(marketResp)
        setMarketMode(todayResp.market_mode ?? 'aggressive')
        setMarketMessage(todayResp.market_message ?? '')

        const initial: PredictionWithMeta[] = todayResp.predictions.map(p => ({ ...p, name: p.symbol, sparkline: [] }))
        setPredictions(initial)
        setExcluded(todayResp.excluded ?? [])
        setExcludedCooldown(todayResp.excluded_cooldown ?? [])

        // Daily summary (별도 요청)
        aiApi.dailySummary().then(s => { if (!cancelled) setSummary(s) }).catch(() => {})

        // 이름 + 스파크라인 비동기 병렬 로드
        todayResp.predictions.forEach((p, i) => {
          fetchQuote(p.symbol).then(q => {
            if (!cancelled) {
              setPredictions(prev => prev.map((x, j) => j === i ? { ...x, name: q.shortName } : x))
              setNames(prev => ({ ...prev, [p.symbol]: q.shortName }))
            }
          }).catch(() => {})
          fetchCandlesCached(p.symbol, '1mo').then(candles => {
            if (!cancelled)
              setPredictions(prev => prev.map((x, j) => j === i ? { ...x, sparkline: candles.slice(-30).map(c => c.close) } : x))
          }).catch(() => {})
        })

        // excluded + cooldown 종목 회사명 비동기 로드 (같은 names 상태에 합산)
        ;[...(todayResp.excluded ?? []).map(e => e.symbol),
           ...(todayResp.excluded_cooldown ?? []).map(e => e.symbol)
        ].forEach(sym => {
          const code = normalizeSymbol(sym)
          fetchQuote(code).then(q => {
            if (!cancelled) setNames(prev => ({ ...prev, [code]: q.shortName }))
          }).catch(() => {})
        })

      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── 비교 종목 상세 로드 ──
  const toggleCompare = useCallback(async (sym: string) => {
    setCompareList(prev => {
      if (prev.includes(sym)) return prev.filter(s => s !== sym)
      if (prev.length >= 3) return prev
      return [...prev, sym]
    })
    if (!compareDetails[sym]) {
      try {
        const d = await aiApi.ticker(sym)
        setCompareDetails(prev => ({ ...prev, [sym]: d }))
      } catch {
        setCompareDetails(prev => ({ ...prev, [sym]: null }))
      }
    }
  }, [compareDetails])

  // ── 검색 ──
  const filteredPredictions = useMemo(() => {
    let list: PredictionWithMeta[]
    if (showWatchlistOnly) {
      const inPreds = predictions.filter(p => watchlist.some(w => normalizeSymbol(w) === normalizeSymbol(p.symbol)))
      const inPredSymbols = new Set(inPreds.map(p => normalizeSymbol(p.symbol)))
      const extras = watchlistExtras.filter(p => !inPredSymbols.has(normalizeSymbol(p.symbol)))
      list = [...inPreds, ...extras]
    } else {
      list = predictions
    }
    if (searchQuery.trim()) {
      list = list.filter(p =>
        p.name.includes(searchQuery) || normalizeSymbol(p.symbol).includes(searchQuery)
      )
    }
    return list
  }, [predictions, watchlist, watchlistExtras, showWatchlistOnly, searchQuery])

  useEffect(() => {
    const q = searchQuery.trim()
    if (!q || filteredPredictions.length > 0) { setSearchHits([]); return }
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try { setSearchHits((await searchSymbols(q)).slice(0, 6)) }
      catch { setSearchHits([]) }
      finally { setSearchLoading(false) }
    }, 350)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, filteredPredictions.length])

  // ── 모달 ──
  const openModalForSymbol = async (symbol: string, name: string) => {
    setModalSymbol(symbol); setModalName(name)
    setDetail(null); setDetailError(null); setDetailLoading(true)
    try { setDetail(await aiApi.ticker(symbol)) }
    catch (e) { setDetailError((e as Error).message) }
    finally { setDetailLoading(false) }
  }
  const openModal = (pred: PredictionWithMeta) => openModalForSymbol(pred.symbol, pred.name)
  const closeModal = () => { setModalSymbol(null); setDetail(null); setDetailError(null) }

  const refreshWatchlist = () => setWatchlist(getWatchlist())

  const handleWatchlistToggle = useCallback(async () => {
    const turningOn = !showWatchlistOnly
    setShowWatchlistOnly(turningOn)
    const wl = getWatchlist()
    setWatchlist(wl)

    if (!turningOn) { setWatchlistExtras([]); return }

    // top-30에 없는 관심 종목은 별도 API 호출
    const predSymbols = new Set(predictions.map(p => normalizeSymbol(p.symbol)))
    const missing = wl.filter(s => !predSymbols.has(normalizeSymbol(s)))
    if (missing.length === 0) return

    setWatchlistLoading(true)
    const settled = await Promise.allSettled(missing.map(s => aiApi.ticker(s)))
    const extras: PredictionWithMeta[] = []
    settled.forEach((r, i) => {
      if (r.status !== 'fulfilled') return
      const d = r.value
      extras.push({
        rank: d.rank ?? 9999,
        symbol: missing[i],
        probability: d.probability,
        shap_top: d.shap_full.slice(0, 6),
        name: missing[i],
        sparkline: d.price_history.slice(-30).map(p => p.close),
      })
    })
    setWatchlistExtras(extras)
    setWatchlistLoading(false)

    extras.forEach(p => {
      fetchQuote(p.symbol).then(q => {
        setWatchlistExtras(prev => prev.map(x => x.symbol === p.symbol ? { ...x, name: q.shortName } : x))
      }).catch(() => {})
    })
  }, [showWatchlistOnly, predictions])

  // ── 렌더 ──
  return (
    <div className="min-h-screen bg-slate-950">
      {/* 상단 내비 */}
      <div className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur border-b border-gray-800/60">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors p-1 -ml-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-white font-bold text-sm">AI 추천 종목</h1>
          <div className="h-4 w-px bg-gray-700" />
          <span className="text-emerald-400 text-xs font-medium">LightGBM · SHAP</span>
          {date && (<><div className="h-4 w-px bg-gray-700" /><span className="text-gray-400 text-xs">기준 {fmtDate(date)}</span></>)}
          {perf?.val_auc != null && (<><div className="h-4 w-px bg-gray-700" /><span className="text-gray-400 text-xs">AUC <span className="text-white">{perf.val_auc.toFixed(3)}</span></span></>)}
          {perf?.trained_at && <span className="text-gray-400 text-xs hidden sm:block">학습일 {perf.trained_at}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/paper-trading"
              className="text-purple-400 hover:text-purple-300 text-xs transition-colors hidden sm:block"
            >
              모의투자 성과 →
            </Link>
            <Link
              to="/help"
              className="text-gray-500 hover:text-gray-300 text-xs transition-colors hidden sm:block"
            >
              사용 안내
            </Link>
            <RetrainButton />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* 에러 */}
        {error && (
          <div className="bg-gray-900 border border-red-500/30 rounded-xl p-5 space-y-2">
            <p className="text-red-400 font-medium text-sm">AI 서버에 연결할 수 없습니다</p>
            <p className="text-gray-400 text-xs">{error}</p>
            <div className="bg-gray-800/60 rounded-lg p-3 font-mono text-xs text-gray-300 space-y-1">
              <p className="text-gray-500"># FastAPI 서버 실행</p>
              <p>cd backend/server</p>
              <p>uvicorn main:app --reload --port 8000</p>
            </div>
          </div>
        )}

        {/* 로딩 스켈레톤 */}
        {loading && !error && (
          <div className="space-y-5">
            <div className="h-12 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
            <div className="h-44 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-52 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* 시장 배너 */}
            {market && <MarketBanner market={market} />}

            {/* 일일 요약 */}
            {summary && <DailySummaryCard summary={summary} names={names} />}

            {/* 백테스트 */}
            {perf && <BacktestSection perf={perf} />}

            {/* 공시 위험 제외 종목 */}
            <ExcludedSection excluded={excluded} names={names} onClickSymbol={openModalForSymbol} />

            {/* 공시 재순위 */}
            {excluded.length > 0 && (() => {
              const eligible = excluded.filter(ex => ex.analysis?.rerank_eligible && ex.rank != null)
              if (eligible.length === 0) return null

              const merged = [
                ...predictions.map(p => ({ type: 'safe' as const, rank: p.rank, pred: p, ex: null as ExcludedStock | null })),
                ...eligible.map(ex => ({ type: 'risky' as const, rank: ex.rank!, pred: null as PredictionWithMeta | null, ex })),
              ].sort((a, b) => a.rank - b.rank)

              return (
                <div className="bg-gray-900 border border-gray-700/50 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowRerank(o => !o)}
                    className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm">⚡</span>
                      <span className="text-gray-200 font-medium text-sm">
                        공시 포함 재순위 — {eligible.length}종목 주의 등급 편입
                      </span>
                      <span className="text-gray-500 text-xs hidden sm:block">— 위험 감수 시 참고용</span>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${showRerank ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showRerank && (
                    <div className="border-t border-gray-800 divide-y divide-gray-800/40">
                      <p className="px-5 py-2 text-xs text-gray-500">
                        공시 필터를 제외하고 AI 확률 순위만 기준으로 재배열한 결과입니다. 매수 전 반드시 공시 원문을 확인하세요.
                      </p>
                      {merged.map(item => {
                        if (item.type === 'safe' && item.pred) {
                          const p = item.pred
                          return (
                            <div
                              key={p.symbol}
                              onClick={() => openModalForSymbol(p.symbol, p.name)}
                              className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-800/30 transition-colors cursor-pointer"
                            >
                              <span className="text-gray-500 text-xs font-mono w-6 shrink-0">#{item.rank}</span>
                              <span className="text-white text-sm font-medium truncate flex-1">{p.name}</span>
                              <span className="text-gray-400 text-xs shrink-0">{p.symbol.replace(/\.(KS|KQ)$/, '')}</span>
                              <span className="text-emerald-400 text-xs font-medium shrink-0">{(p.probability * 100).toFixed(1)}%</span>
                            </div>
                          )
                        }
                        const ex = item.ex!
                        const code = normalizeSymbol(ex.symbol)
                        const exName = names[code] ?? '—'
                        const a = ex.analysis!
                        const sty = SEVERITY_STYLES[a.severity] ?? SEVERITY_STYLES.high
                        return (
                          <div
                            key={ex.symbol}
                            onClick={() => openModalForSymbol(code, exName)}
                            className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-800/30 transition-colors cursor-pointer"
                          >
                            <span className="text-gray-500 text-xs font-mono w-6 shrink-0">#{item.rank}</span>
                            <span className="text-white text-sm font-medium truncate flex-1">{exName}</span>
                            <span className="text-gray-400 text-xs shrink-0">{code}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${sty.badge}`}>
                              {a.severity_label}
                            </span>
                            <span className="text-xs text-gray-500 shrink-0 hidden sm:block truncate max-w-32">{a.matched_keyword}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}

            {/* 쿨다운 제외 종목 */}
            <CooldownSection excluded={excludedCooldown} names={names} onClickSymbol={openModalForSymbol} />

            {/* 추천 그리드 */}
            <div>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h2 className="text-white font-semibold">상위 {predictions.length}종목 예측</h2>
                  <p className="text-gray-400 text-xs mt-0.5">5일 보유 전략 · 클릭하면 상세 분석</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleWatchlistToggle}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                      showWatchlistOnly ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {watchlistLoading
                      ? <><div className="w-3 h-3 border border-yellow-400 border-t-transparent rounded-full animate-spin" />불러오는 중...</>
                      : '★ 관심 종목만'}
                  </button>
                  {compareList.length > 0 && (
                    <button onClick={() => setCompareList([])} className="text-xs bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 px-3 py-1.5 rounded-lg hover:bg-indigo-600/50 transition-colors">
                      비교 ({compareList.length}) 초기화
                    </button>
                  )}
                  <span className="text-emerald-500 text-xs font-medium bg-emerald-500/10 px-2.5 py-1 rounded-full">{date ? fmtDate(date) : ''}</span>
                </div>
              </div>

              {/* 검색 */}
              <div className="relative mb-4">
                <div className="flex items-center bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 gap-2 focus-within:border-emerald-500/60 transition-colors">
                  <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="종목명 또는 코드 검색 (예: 삼성전자, 005930)"
                    className="flex-1 bg-transparent text-sm text-white placeholder:text-gray-500 focus:outline-none" />
                  {searchQuery && (
                    <button onClick={() => { setSearchQuery(''); setSearchHits([]) }} className="text-gray-500 hover:text-white transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {searchQuery.trim() && filteredPredictions.length === 0 && (
                  <div className="absolute top-full mt-1 w-full bg-gray-900 border border-gray-700 rounded-xl overflow-hidden z-20 shadow-xl">
                    {searchLoading && (
                      <div className="flex items-center gap-2 px-4 py-3 text-gray-400 text-sm">
                        <div className="w-3.5 h-3.5 border border-emerald-500 border-t-transparent rounded-full animate-spin" />검색 중...
                      </div>
                    )}
                    {!searchLoading && searchHits.length === 0 && <p className="text-gray-500 text-sm px-4 py-3">검색 결과 없음</p>}
                    {searchHits.map(hit => {
                      const code = hit.symbol.replace(/\.(KS|KQ)$/, '')
                      return (
                        <button key={hit.symbol} onClick={() => { setSearchQuery(''); setSearchHits([]); openModalForSymbol(code, hit.shortname) }}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800 transition-colors text-left border-t border-gray-800 first:border-0">
                          <span className="text-white text-sm font-medium">{hit.shortname}</span>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>{code}</span>
                            <span className="bg-gray-700 px-1.5 py-0.5 rounded">{hit.exchDisp}</span>
                            <span className="text-emerald-400">AI 분석 →</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 시장 국면 경고 배너 */}
              <MarketModeBanner mode={marketMode} message={marketMessage} />

              {/* 카드 그리드 */}
              {predictions.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">예측 데이터가 없습니다.</div>
              ) : showWatchlistOnly && filteredPredictions.length === 0 && !watchlistLoading ? (
                <div className="text-center py-16 text-gray-500 text-sm">관심 종목이 없습니다. 카드의 ★를 눌러 추가하세요.</div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredPredictions.map(pred => (
                    <PredictionCard key={pred.symbol} pred={pred}
                      onClick={() => openModal(pred)}
                      onCompareToggle={toggleCompare}
                      inCompare={compareList.includes(pred.symbol)}
                      watchlist={watchlist}
                      onStarChange={refreshWatchlist}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 비교 패널 */}
            {compareList.length >= 2 && (
              <ComparePanel
                symbols={compareList}
                names={names}
                details={compareDetails}
                onClose={() => setCompareList([])}
              />
            )}
          </>
        )}
      </div>

      {/* 상세 모달 */}
      {modalSymbol && (
        <DetailModal
          symbol={modalSymbol} name={modalName}
          detail={detail} loading={detailLoading} error={detailError}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
