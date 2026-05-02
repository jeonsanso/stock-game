import { useEffect, useRef, useState } from 'react'
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type SeriesType } from 'lightweight-charts'
import { fetchCandles, type CandleBar } from '../api/yahooFinance'

type Range = '1mo' | '3mo' | '6mo' | '1y' | '2y'

interface TradeMark {
  type: 'buy' | 'sell'
  timestamp: number
}

interface StockChartProps {
  symbol: string
  candles?: CandleBar[]
  cutoffDate?: number
  trades?: TradeMark[]
  startDate?: number
  changePct?: number | null
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
}

const RANGES: { label: string; value: Range }[] = [
  { label: '1개월', value: '1mo' },
  { label: '3개월', value: '3mo' },
  { label: '6개월', value: '6mo' },
  { label: '1년', value: '1y' },
  { label: '2년', value: '2y' },
]

export default function StockChart({ symbol, candles: externalCandles, cutoffDate, trades, startDate, changePct, isFullscreen = false, onToggleFullscreen }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const maSeriesRefs = useRef<ISeriesApi<SeriesType>[]>([])
  const markersPluginRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null)
  const initialFitDoneRef = useRef(false)
  const [range, setRange] = useState<Range>('3mo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartHeight, setChartHeight] = useState(() =>
    Math.max(420, Math.min(720, window.innerHeight - 360))
  )
  const [volumeRatio, setVolumeRatio] = useState(0.25)
  const isHistoryMode = externalCandles !== undefined

  useEffect(() => {
    const onResize = () => {
      if (isFullscreen) {
        setChartHeight(window.innerHeight - 48)
      } else {
        setChartHeight(Math.max(420, Math.min(720, window.innerHeight - 360)))
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isFullscreen])

  useEffect(() => {
    if (isFullscreen) {
      setChartHeight(window.innerHeight - 48)
    } else {
      setChartHeight(Math.max(420, Math.min(720, window.innerHeight - 360)))
    }
  }, [isFullscreen])

  useEffect(() => {
    chartRef.current?.applyOptions({ height: chartHeight })
  }, [chartHeight])

  useEffect(() => {
    seriesRef.current?.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: volumeRatio } })
    volumeSeriesRef.current?.priceScale().applyOptions({ scaleMargins: { top: 1 - volumeRatio, bottom: 0 } })
    maSeriesRefs.current.forEach((s) => s.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: volumeRatio } }))
  }, [volumeRatio])

  useEffect(() => {
    if (!containerRef.current) return

    chartRef.current = createChart(containerRef.current, {
      layout: {
        background: { color: '#111827' },
        textColor: '#9CA3AF',
      },
      grid: {
        vertLines: { color: '#1F2937' },
        horzLines: { color: '#1F2937' },
      },
      crosshair: {
        vertLine: { color: '#6366F1' },
        horzLine: { color: '#6366F1' },
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
      width: containerRef.current.clientWidth,
      height: chartHeight,
    })

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      chartRef.current?.remove()
      chartRef.current = null
      seriesRef.current = null
      volumeSeriesRef.current = null
      maSeriesRefs.current = []
      markersPluginRef.current = null
      initialFitDoneRef.current = false
    }
  }, [])

  const MA_CONFIGS = [
    { period: 5,  color: '#FBBF24' },
    { period: 20, color: '#A78BFA' },
    { period: 60, color: '#34D399' },
  ]

  const calcMA = (bars: CandleBar[], period: number) => {
    return bars.map((b, i) => {
      if (i < period - 1) return null
      const avg = bars.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period
      return { time: b.time as unknown as import('lightweight-charts').Time, value: avg }
    }).filter((v): v is { time: import('lightweight-charts').Time; value: number } => v !== null)
  }

  const ensureSeries = () => {
    if (!chartRef.current || seriesRef.current) return

    const series = chartRef.current.addSeries(CandlestickSeries, {
      upColor: '#EF4444', downColor: '#3B82F6',
      borderUpColor: '#EF4444', borderDownColor: '#3B82F6',
      wickUpColor: '#EF4444', wickDownColor: '#3B82F6',
      priceScaleId: 'right',
    })
    series.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: volumeRatio } })
    seriesRef.current = series

    const volumeSeries = chartRef.current.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 1 - volumeRatio, bottom: 0 } })
    volumeSeriesRef.current = volumeSeries

    maSeriesRefs.current = MA_CONFIGS.map(({ color }) => {
      const s = chartRef.current!.addSeries(LineSeries, {
        color, lineWidth: 1, priceScaleId: 'right',
        crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
      })
      s.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: volumeRatio } })
      return s
    })
  }

  const applyBars = (bars: CandleBar[]) => {
    if (!chartRef.current) return
    ensureSeries()
    if (!seriesRef.current || !volumeSeriesRef.current) return

    const cutoffSec = cutoffDate != null ? Math.floor(cutoffDate / 1000) : Infinity
    const filtered = bars.filter((b) => b.time <= cutoffSec)

    const formatted = filtered.map((b) => ({
      time: b.time as unknown as import('lightweight-charts').Time,
      open: b.open, high: b.high, low: b.low, close: b.close,
    }))
    const volumeFormatted = filtered.map((b) => ({
      time: b.time as unknown as import('lightweight-charts').Time,
      value: b.volume,
      color: b.close >= b.open ? '#EF444466' : '#3B82F666',
    }))

    seriesRef.current.setData(formatted)
    volumeSeriesRef.current.setData(volumeFormatted)
    maSeriesRefs.current.forEach((s, i) => s.setData(calcMA(filtered, MA_CONFIGS[i].period)))

    if (isHistoryMode && formatted.length > 0) {
      type Marker = Parameters<typeof createSeriesMarkers>[1][number]
      const markers: Marker[] = []

      if (startDate != null) {
        const startSec = Math.floor(startDate / 1000)
        const startCandle = filtered.reduce((best, c) =>
          Math.abs(c.time - startSec) < Math.abs(best.time - startSec) ? c : best
        , filtered[0])
        if (startCandle) {
          markers.push({
            time: startCandle.time as unknown as import('lightweight-charts').Time,
            position: 'belowBar',
            color: '#818CF8',
            shape: 'arrowUp',
            text: '시작',
          })
        }
      }

      for (const trade of trades ?? []) {
        const tradeSec = Math.floor(trade.timestamp / 1000)
        const candle = filtered.reduce((best, c) =>
          Math.abs(c.time - tradeSec) < Math.abs(best.time - tradeSec) ? c : best
        , filtered[0])
        if (!candle) continue
        markers.push({
          time: candle.time as unknown as import('lightweight-charts').Time,
          position: trade.type === 'buy' ? 'belowBar' : 'aboveBar',
          color: trade.type === 'buy' ? '#22C55E' : '#F87171',
          shape: trade.type === 'buy' ? 'arrowUp' : 'arrowDown',
          text: trade.type === 'buy' ? '매수' : '매도',
        })
      }
      markers.push({
        time: formatted[formatted.length - 1].time,
        position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: '현재',
      })
      markers.sort((a, b) => (a.time as number) - (b.time as number))
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers(markers)
      } else {
        markersPluginRef.current = createSeriesMarkers(seriesRef.current, markers)
      }
    }

    if (!initialFitDoneRef.current) {
      chartRef.current.timeScale().fitContent()
      initialFitDoneRef.current = true
    }
  }

  // 외부 캔들이 주어지면 그것을 사용 (역사 시뮬레이션 모드)
  useEffect(() => {
    if (externalCandles === undefined) return
    setError(null)
    setLoading(false)
    applyBars(externalCandles)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalCandles, cutoffDate, trades])

  // 내부 fetch 모드 (실시간)
  useEffect(() => {
    if (externalCandles !== undefined) return
    if (!chartRef.current) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const bars: CandleBar[] = await fetchCandles(symbol, range)
        if (cancelled) return
        applyBars(bars)
      } catch (e) {
        if (!cancelled) setError('차트 데이터를 불러오지 못했습니다.')
        console.error(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range, externalCandles])

  return (
    <div className={isFullscreen
      ? 'flex flex-col h-full bg-gray-900'
      : 'bg-gray-900 rounded-xl border border-gray-800 overflow-hidden'
    }>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 font-medium">주가 차트</span>
          {changePct != null && (
            <span className={`text-sm font-bold tabular-nums ${changePct >= 0 ? 'text-red-400' : 'text-blue-400'}`}>
              {changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
            </span>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#FBBF24]" />MA5</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#A78BFA]" />MA20</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#34D399]" />MA60</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 border-l border-gray-700 pl-3">
            <span>거래량</span>
            <input
              type="range"
              min={10}
              max={45}
              value={Math.round(volumeRatio * 100)}
              onChange={(e) => setVolumeRatio(Number(e.target.value) / 100)}
              className="w-16 h-1 accent-indigo-500 cursor-pointer"
            />
            <span className="w-6 text-right">{Math.round(volumeRatio * 100)}%</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isHistoryMode && (
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    range === r.value
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={onToggleFullscreen}
            title={isFullscreen ? '축소 (ESC)' : '전체화면'}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            {isFullscreen ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="relative">
        <div ref={containerRef} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
            <span className="text-gray-400 text-sm">로딩 중...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
            <span className="text-red-400 text-sm">{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
