import { Link, useLocation } from 'react-router-dom'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatChangePercent, changeColor } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

interface HistoryHeaderProps {
  totalAsset: number
}

export default function HistoryHeader({ totalAsset }: HistoryHeaderProps) {
  const { cash, reset } = useHistoryStore()
  const location = useLocation()

  const isActive = (path: string) =>
    location.pathname === path || location.pathname === path + '/'
      ? 'text-white border-b-2 border-amber-400'
      : 'text-gray-400 hover:text-white'

  const profitAmount = totalAsset - INITIAL_CASH
  const profitRate = (profitAmount / INITIAL_CASH) * 100

  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-gray-300 text-xs transition-colors">
            ← 모드 선택
          </Link>
          <Link to="/history" className="text-white font-bold text-lg tracking-tight">
            역사 시뮬레이션
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link to="/history" className={`pb-0.5 transition-colors ${isActive('/history')}`}>
              홈
            </Link>
            <Link to="/history/portfolio" className={`pb-0.5 transition-colors ${isActive('/history/portfolio')}`}>
              포트폴리오
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-gray-400 text-xs">현금</span>
            <span className="text-white font-semibold">{formatKRW(cash)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-gray-400 text-xs">총 자산</span>
            <span className="text-white font-semibold">{formatKRW(totalAsset)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-gray-400 text-xs">수익률</span>
            <span className={`font-semibold ${changeColor(profitRate)}`}>
              {formatChangePercent(profitRate)}
            </span>
          </div>
          <button
            onClick={() => {
              if (confirm('시뮬레이션을 초기화할까요? 모든 거래 내역이 삭제됩니다.')) reset()
            }}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
          >
            초기화
          </button>
        </div>
      </div>
    </header>
  )
}
