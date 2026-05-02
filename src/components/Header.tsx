import { Link, useLocation } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { formatKRW, formatChangePercent, changeColor } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

interface HeaderProps {
  totalAsset: number
}

export default function Header({ totalAsset }: HeaderProps) {
  const { cash, reset } = useGameStore()
  const location = useLocation()

  const profitAmount = totalAsset - INITIAL_CASH
  const profitRate = (profitAmount / INITIAL_CASH) * 100

  const isActive = (path: string) =>
    location.pathname === path || (path === '/realtime' && location.pathname === '/realtime/')
      ? 'text-white border-b-2 border-indigo-400'
      : 'text-gray-400 hover:text-white'

  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-gray-400 hover:text-gray-300 text-xs transition-colors">
            ← 모드 선택
          </Link>
          <Link to="/realtime" className="text-white font-bold text-lg tracking-tight">
            실시간 모의투자
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link to="/realtime" className={`pb-0.5 transition-colors ${isActive('/realtime')}`}>
              홈
            </Link>
            <Link to="/realtime/portfolio" className={`pb-0.5 transition-colors ${isActive('/realtime/portfolio')}`}>
              포트폴리오
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-4 text-sm">
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
              if (confirm('게임을 초기화할까요? 모든 거래 내역이 삭제됩니다.')) reset()
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
