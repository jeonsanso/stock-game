import { useState } from 'react'
import { useHistoryStore } from '../store/historyStore'
import { formatKRW } from '../utils/format'
import { INITIAL_CASH } from '../api/constants'

export default function SaveLoadPanel() {
  const { saves, saveSnapshot, loadSnapshot, deleteSnapshot, cash, holdings, gameDate } = useHistoryStore()
  const [open, setOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const totalAsset = cash + Object.values(holdings).reduce((sum, h) => sum + h.avgPrice * h.quantity, 0)
  const returnPct = ((totalAsset - INITIAL_CASH) / INITIAL_CASH) * 100

  const handleSave = () => {
    const name = saveName.trim() || new Date(gameDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    saveSnapshot(name)
    setSaveName('')
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg transition-colors"
      >
        저장 / 불러오기
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-white font-bold">저장 / 불러오기</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-300 text-lg">✕</button>
            </div>

            <div className="p-5 space-y-5">
              {/* 현재 상태 저장 */}
              <div>
                <p className="text-xs text-gray-400 mb-2">현재 상태 저장</p>
                <p className="text-xs text-gray-400 mb-3">
                  {new Date(gameDate).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} ·{' '}
                  {formatKRW(totalAsset)}{' '}
                  <span className={returnPct >= 0 ? 'text-red-400' : 'text-blue-400'}>
                    ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%)
                  </span>
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    placeholder="저장 이름 (선택)"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    저장
                  </button>
                </div>
              </div>

              {/* 저장 목록 */}
              <div>
                <p className="text-xs text-gray-400 mb-2">저장 목록 ({saves.length})</p>
                {saves.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-6">저장된 상태가 없습니다.</p>
                ) : (
                  <ul className="space-y-2 max-h-64 overflow-y-auto">
                    {saves.map((s) => {
                      const ret = ((s.cash + Object.values(s.holdings).reduce((sum, h) => sum + h.avgPrice * h.quantity, 0) - INITIAL_CASH) / INITIAL_CASH) * 100
                      return (
                        <li key={s.id} className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-white text-sm font-medium truncate">{s.name}</p>
                            <p className="text-gray-400 text-xs mt-0.5">
                              {new Date(s.savedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ·{' '}
                              <span className={ret >= 0 ? 'text-red-400' : 'text-blue-400'}>
                                {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                              </span>
                            </p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => { loadSnapshot(s.id); setOpen(false) }}
                              className="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-xs rounded-lg transition-colors"
                            >
                              불러오기
                            </button>
                            {confirmDelete === s.id ? (
                              <button
                                onClick={() => { deleteSnapshot(s.id); setConfirmDelete(null) }}
                                className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs rounded-lg transition-colors"
                              >
                                확인
                              </button>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(s.id)}
                                className="px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-400 text-xs rounded-lg transition-colors"
                              >
                                삭제
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
