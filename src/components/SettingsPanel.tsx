import { useState } from 'react'
import { useHistoryStore } from '../store/historyStore'
import { BUY_FEE_RATE, SELL_FEE_RATE } from '../api/constants'

export default function SettingsPanel() {
  const { feeEnabled, toggleFee } = useHistoryStore()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        설정
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-white font-bold">설정</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-300 text-lg">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">거래 수수료</p>
                <div
                  onClick={toggleFee}
                  className={`flex items-center justify-between rounded-xl px-4 py-3.5 cursor-pointer transition-colors border ${
                    feeEnabled
                      ? 'bg-indigo-600/20 border-indigo-500/40'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div>
                    <p className="text-white text-sm font-medium">수수료 적용</p>
                    <p className="text-gray-400 text-xs mt-0.5">매수 {(BUY_FEE_RATE * 100).toFixed(3)}% · 매도 {(SELL_FEE_RATE * 100).toFixed(3)}%</p>
                  </div>
                  <div className={`w-11 h-6 rounded-full transition-colors relative ${feeEnabled ? 'bg-indigo-600' : 'bg-gray-600'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${feeEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </div>
                </div>

                {feeEnabled && (
                  <div className="mt-3 bg-gray-800 rounded-xl px-4 py-3 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">매수 수수료</span>
                      <span className="text-gray-300">증권사 수수료 {(BUY_FEE_RATE * 100).toFixed(3)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">매도 수수료</span>
                      <span className="text-gray-300">수수료 0.015% + 증권거래세 0.2%</span>
                    </div>
                    <p className="text-xs text-amber-400/80 pt-1 border-t border-gray-700">
                      거래 시 자동으로 수수료가 차감됩니다.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
