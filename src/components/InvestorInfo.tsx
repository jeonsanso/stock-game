import type { CandleBar } from '../api/yahooFinance'
import { calcInvestorFlow } from '../utils/investorData'

interface Props {
  candle: CandleBar
  prev: CandleBar | null
}

function formatUnit(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}조`
  if (abs >= 100_000_000) return `${(value / 100_000_000).toFixed(0)}억`
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}천만`
  return `${(value / 1_000_000).toFixed(0)}백만`
}

export default function InvestorInfo({ candle, prev }: Props) {
  const flow = calcInvestorFlow(candle, prev)

  const rows = [
    { label: '외국인', value: flow.foreign },
    { label: '기관', value: flow.institution },
    { label: '개인', value: flow.individual },
  ]

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 font-medium">투자자별 순매수</p>
        <p className="text-xs text-gray-600">추정치</p>
      </div>
      <div className="space-y-2.5">
        {rows.map(({ label, value }) => {
          const pos = value >= 0
          const barPct = (Math.abs(value) / maxAbs) * 100
          return (
            <div key={label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">{label}</span>
                <span className={`font-semibold tabular-nums ${pos ? 'text-red-400' : 'text-blue-400'}`}>
                  {pos ? '+' : '-'}{formatUnit(Math.abs(value))}
                </span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${pos ? 'bg-red-500' : 'bg-blue-500'}`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
