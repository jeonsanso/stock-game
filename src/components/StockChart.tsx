import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type SeriesType } from 'lightweight-charts'
import { fetchCandles, type CandleBar } from '../api/yahooFinance'

type Range = '1mo' | '3mo' | '6mo' | '1y' | '2y'

interface StockChartProps {
  symbol: string
  /** 외부에서 미리 가져온 캔들 데이터. 제공 시 내부 fetch 생략 */
  candles?: CandleBar[]
  /** Unix ms. 제공 시 이 시점 이후 캔들 숨김 (역사 시뮬레이션용) */
  cutoffDate?: number
}

const RANGES: { label: string; value: Range }[] = [
  { label: '1개월', value: '1mo' },
  { label: '3개월', value: '3mo' },
  { label: '6개월', value: '6mo' },
  { label: '1년', value: '1y' },
  { label: '2년', value: '2y' },
]

export default function StockChart({ symbol, candles: externalCandles, cutoffDate }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const maSeriesRefs = useRef<ISeriesApi<SeriesType>[]>([])
  const initialFitDoneRef = useRef(false)
  const [range, setRange] = useState<Range>('3mo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isHistoryMode = externalCandles !== undefined

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
      height: 420,
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
      initialFitDoneRef.current = false
    }
  }, [])

  const calcMA = (bars: CandleBar[], period: number) => {
    return bars.map((b, i) => {
      if (i < period - 1) return null
      const avg = bars.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period
      return { time: b.time as unknown as import('lightweight-charts').Time, value: avg }
    }).filter((v): v is { time: import('lightweight-charts').Time; value: number } => v !== null)
  }

  const applyBars = (bars: CandleBar[]) => {
    if (!chartRef.current) return
    const cutoffSec = cutoffDate != null ? Math.floor(cutoffDate / 1000) : Infinity
    const filtered = bars.filter((b) => b.time <= cutoffSec)

    if (seriesRef.current) {
      chartRef.current.removeSeries(seriesRef.current)
      seriesRef.current = null
    }
    if (volumeSeriesRef.current) {
      chartRef.current.removeSeries(volumeSeriesRef.current)
      volumeSeriesRef.current = null
    }
    for (const ma of maSeriesRefs.current) {
      chartRef.current.removeSeries(ma)
    }
    maSeriesRefs.current = []

    const series = chartRef.current.addSeries(CandlestickSeries, {
      upColor: '#EF4444',
      downColor: '#3B82F6',
      borderUpColor: '#EF4444',
      borderDownColor: '#3B82F6',
      wickUpColor: '#EF4444',
      wickDownColor: '#3B82F6',
      priceScaleId: 'right',
    })
    series.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    })

    const volumeSeries = chartRef.current.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    const formatted = filtered.map((b) => ({
      time: b.time as unknown as import('lightweight-charts').Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }))

    const volumeFormatted = filtered.map((b) => ({
      time: b.time as unknown as import('lightweight-charts').Time,
      value: b.volume,
      color: b.close >= b.open ? '#EF444466' : '#3B82F666',
    }))

    const MA_CONFIGS = [
      { period: 5,  color: '#FBBF24' },
      { period: 20, color: '#A78BFA' },
      { period: 60, color: '#34D399' },
    ]

    const maSeries = MA_CONFIGS.map(({ period, color }) => {
      const s = chartRef.current!.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceScaleId: 'right',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      s.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } })
      s.setData(calcMA(filtered, period))
      return s
    })

    seriesRef.current = series
    volumeSeriesRef.current = volumeSeries
    maSeriesRefs.current = maSeries
    series.setData(formatted)
    volumeSeries.setData(volumeFormatted)

    if (isHistoryMode && formatted.length > 0) {
      series.setMarkers([{
        time: formatted[formatted.length - 1].time,
        position: 'aboveBar',
        color: '#F59E0B',
        shape: 'arrowDown',
        text: '현재',
      }])
    }

    if (!initialFitDoneRef.current) {
      chartRef.current.timeScale().fitContent()
      initialFitDoneRef.current = true
    } else {
      setTimeout(() => {
        chartRef.current?.timeScale().scrollToPosition(0, false)
      }, 0)
    }
  }

  // 외부 캔들이 주어지면 그것을 사용 (역사 시뮬레이션 모드)
  useEffect(() => {
    if (externalCandles === undefined) return
    setError(null)
    setLoading(false)
    applyBars(externalCandles)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalCandles, cutoffDate])

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
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400 font-medium">주가 차트</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#FBBF24]" />MA5</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#A78BFA]" />MA20</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[#34D399]" />MA60</span>
          </div>
        </div>
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
