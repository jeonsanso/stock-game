import { Link } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW, formatChangePercent, changeColor } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

export default function ModeSelectPage() {
  const realtime = useGameStore()
  const history = useHistoryStore()

  const realtimeProfitRate = ((realtime.cash + Object.values(realtime.holdings).reduce(
    (s, h) => s + h.avgPrice * h.quantity, 0
  ) - INITIAL_CASH) / INITIAL_CASH) * 100

  const historyProfitRate = ((history.cash + Object.values(history.holdings).reduce(
    (s, h) => s + h.avgPrice * h.quantity, 0
  ) - INITIAL_CASH) / INITIAL_CASH) * 100

  const historyDateStr = new Date(history.gameDate).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const historyTradeCount = history.tradeHistory.length
  const realtimeTradeCount = realtime.tradeHistory.length
  const today = Date.now()
  const historyEnded = history.gameDate >= today

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-white text-3xl font-bold tracking-tight">주식 모의투자</h1>
          <p className="text-gray-400 text-sm">플레이할 모드를 선택하세요</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 실시간 모의투자 카드 */}
          <Link
            to="/realtime"
            className="group block bg-gray-900 border border-gray-800 hover:border-indigo-500/50 rounded-2xl p-6 transition-all hover:shadow-lg hover:shadow-indigo-500/10"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-xl">
                📡
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">실시간 모의투자</h2>
                <p className="text-gray-500 text-xs">현재가 기반</p>
              </div>
            </div>

            <p className="text-gray-400 text-sm mb-5 leading-relaxed">
              네이버 증권 실시간 시세로 지금 이 순간의 한국 주식 시장에서 투자 연습을 합니다.
            </p>

            {realtimeTradeCount > 0 ? (
              <div className="bg-gray-800/60 rounded-xl px-4 py-3 space-y-1">
                <p className="text-gray-400 text-xs">진행 중인 게임</p>
                <div className="flex items-center justify-between">
                  <span className="text-gray-300 text-sm">{realtimeTradeCount}회 거래</span>
                  <span className={`text-sm font-semibold ${changeColor(realtimeProfitRate)}`}>
                    {formatChangePercent(realtimeProfitRate)}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">이어하기 →</p>
              </div>
            ) : (
              <div className="bg-gray-800/60 rounded-xl px-4 py-3">
                <p className="text-gray-500 text-xs">시작 전 · 초기 자본 {formatKRW(INITIAL_CASH)}</p>
              </div>
            )}
          </Link>

          {/* 역사 시뮬레이션 카드 */}
          <Link
            to="/history"
            className="group block bg-gray-900 border border-gray-800 hover:border-amber-500/50 rounded-2xl p-6 transition-all hover:shadow-lg hover:shadow-amber-500/10"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-xl">
                ⏱️
              </div>
              <div>
                <h2 className="text-white font-bold text-lg">역사 시뮬레이션</h2>
                <p className="text-gray-500 text-xs">6개월 전부터 현재까지</p>
              </div>
            </div>

            <p className="text-gray-400 text-sm mb-5 leading-relaxed">
              6개월 전 과거로 돌아가 매수·매도·홀드를 결정하며 하루씩 진행합니다. 당신의 선택이 맞았는지 확인해보세요.
            </p>

            {historyTradeCount > 0 ? (
              <div className="bg-gray-800/60 rounded-xl px-4 py-3 space-y-1">
                <p className="text-gray-400 text-xs">
                  {historyEnded ? '시뮬레이션 종료' : `${historyDateStr} 진행 중`}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-gray-300 text-sm">{historyTradeCount}회 거래</span>
                  <span className={`text-sm font-semibold ${changeColor(historyProfitRate)}`}>
                    {formatChangePercent(historyProfitRate)}
                  </span>
                </div>
                <p className="text-gray-500 text-xs">이어하기 →</p>
              </div>
            ) : (
              <div className="bg-gray-800/60 rounded-xl px-4 py-3 space-y-1">
                <p className="text-gray-500 text-xs">시작 전 · 초기 자본 {formatKRW(INITIAL_CASH)}</p>
                <p className="text-amber-500/70 text-xs">{historyDateStr}부터 시작</p>
              </div>
            )}
          </Link>
        </div>

        <p className="text-center text-gray-600 text-xs">
          각 모드의 자산과 거래 내역은 독립적으로 저장됩니다
        </p>
      </div>
    </div>
  )
}
