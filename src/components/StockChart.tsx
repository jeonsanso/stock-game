import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type SeriesType } from 'lightweight-charts'
import { fetchCandles, type CandleBar } from '../api/yahooFinance'

type Range = '1mo' | '3mo' | '6mo' | '1y' | '2y'

interface StockChartProps {
  symbol: string
}

const RANGES: { label: string; value: Range }[] = [
  { label: '1개월', value: '1mo' },
  { label: '3개월', value: '3mo' },
  { label: '6개월', value: '6mo' },
  { label: '1년', value: '1y' },
  { label: '2년', value: '2y' },
]

export default function StockChart({ symbol }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null)
  const [range, setRange] = useState<Range>('3mo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      height: 360,
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
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const bars: CandleBar[] = await fetchCandles(symbol, range)
        if (cancelled) return

        if (seriesRef.current) {
          chartRef.current!.removeSeries(seriesRef.current)
          seriesRef.current = null
        }

        const series = chartRef.current!.addSeries(CandlestickSeries, {
          upColor: '#EF4444',
          downColor: '#3B82F6',
          borderUpColor: '#EF4444',
          borderDownColor: '#3B82F6',
          wickUpColor: '#EF4444',
          wickDownColor: '#3B82F6',
        })

        const formatted = bars.map((b) => ({
          time: b.time as unknown as import('lightweight-charts').Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))

        seriesRef.current = series
        series.setData(formatted)
        chartRef.current!.timeScale().fitContent()
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
  }, [symbol, range])

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm text-gray-400 font-medium">주가 차트</span>
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
