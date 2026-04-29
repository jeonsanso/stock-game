import { Link, useLocation } from 'react-router-dom'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatChangePercent, changeColor } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

interface HistoryHeaderProps {
  totalAsset: number
}

export default function HistoryHeader({ totalAsset }: HistoryHeaderProps) {
  const { cash, gameDate, reset } = useHistoryStore()
  const location = useLocation()
  const today = Date.now()
  const isEnded = gameDate >= today

  const gameDateStr = new Date(gameDate).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const profitAmount = totalAsset - INITIAL_CASH
  const profitRate = (profitAmount / INITIAL_CASH) * 100

  const isActive = (path: string) =>
    location.pathname === path || location.pathname === path + '/'
      ? 'text-white border-b-2 border-amber-400'
      : 'text-gray-400 hover:text-white'

  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
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
          <div className="hidden sm:flex items-center">
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                isEnded
                  ? 'bg-gray-700 text-gray-400'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}
            >
              {isEnded ? '시뮬레이션 종료' : `${gameDateStr} 시뮬레이션 중`}
            </span>
          </div>

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
              if (confirm('시뮬레이션을 초기화할까요? 모든 거래 내역이 삭제되고 6개월 전으로 돌아갑니다.')) reset()
            }}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 모바일용 날짜 표시 */}
      <div className="sm:hidden border-t border-gray-800 px-4 py-1.5 flex items-center justify-between">
        <span className={`text-xs font-medium ${isEnded ? 'text-gray-500' : 'text-amber-400'}`}>
          {isEnded ? '시뮬레이션 종료' : `📅 ${gameDateStr}`}
        </span>
        <span className="text-xs text-gray-500">{formatKRW(cash)} 보유</span>
      </div>
    </header>
  )
}
