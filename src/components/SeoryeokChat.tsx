import { useEffect, useRef } from 'react'

export interface ChatMessage {
  from: 'boss' | 'deputy' | 'spy'
  text: string
  ts: number // game timestamp ms
}

const NAMES = {
  boss:   '팀장',
  deputy: '부팀장',
  spy:    '감시자',
}
const COLORS = {
  boss:   'text-red-400',
  deputy: 'text-orange-400',
  spy:    'text-gray-400',
}
const AVATARS = {
  boss:   '👴',
  deputy: '😈',
  spy:    '👁',
}

interface Props {
  messages: ChatMessage[]
  compact?: boolean
}

export default function SeoryeokChat({ messages, compact = false }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center text-gray-600 text-xs">
        세력 감시 대기 중...
      </div>
    )
  }

  return (
    <div className={`bg-gray-950 border border-gray-800 rounded-xl flex flex-col ${compact ? 'max-h-64' : 'max-h-96'}`}>
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
        </div>
        <span className="text-gray-500 text-xs font-medium ml-1">세력 작전방 🔒</span>
        <span className="ml-auto text-gray-700 text-xs">{messages.length}개</span>
      </div>

      {/* 메시지 */}
      <div className="overflow-y-auto flex-1 px-3 py-2 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-base shrink-0 mt-0.5">{AVATARS[msg.from]}</span>
            <div className="flex-1 min-w-0">
              <span className={`text-xs font-semibold ${COLORS[msg.from]}`}>
                {NAMES[msg.from]}
              </span>
              <p className="text-gray-200 text-xs leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
                {msg.text}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── 룰 기반 메시지 생성 ───────────────────────────────────────

export function makeBuyMessages(price: number, qty: number): ChatMessage[] {
  const ts = Date.now()
  return [
    { from: 'spy',    text: `개미 포착\n${price.toLocaleString()}원 ${qty}주 매수`, ts },
    { from: 'boss',   text: '흔들어', ts: ts + 100 },
  ]
}

export function makeHoldMessages(changePct: number | null): ChatMessage[] {
  const ts = Date.now()
  if (changePct === null) return []

  if (changePct >= 5) return [
    { from: 'deputy', text: `+${changePct.toFixed(1)}% 올렸습니다\n개미 반응은요?`, ts },
    { from: 'spy',    text: '홀딩 중입니다', ts: ts + 100 },
    { from: 'boss',   text: '...', ts: ts + 200 },
  ]
  if (changePct >= 1) return [
    { from: 'spy',    text: `+${changePct.toFixed(1)}% 올랐는데 안 팝니다`, ts },
    { from: 'boss',   text: '더 눌러', ts: ts + 100 },
  ]
  if (changePct <= -5) return [
    { from: 'deputy', text: `${changePct.toFixed(1)}% 눌렀습니다`, ts },
    { from: 'spy',    text: '아직 홀딩 중입니다', ts: ts + 100 },
    { from: 'boss',   text: '조금만 더', ts: ts + 200 },
  ]
  if (changePct <= -1) return [
    { from: 'spy',    text: `${changePct.toFixed(1)}% 흔들었는데\n버티고 있습니다`, ts },
    { from: 'boss',   text: '냅둬', ts: ts + 100 },
  ]
  return [
    { from: 'spy', text: '변동 없음. 개미 홀딩 중', ts },
  ]
}

export function makeSellMessages(buyPrice: number, sellPrice: number, nextDayChangePct: number | null): ChatMessage[] {
  const ts = Date.now()
  const pnlPct = (sellPrice - buyPrice) / buyPrice * 100

  if (pnlPct >= 30) return [
    { from: 'spy',    text: `${sellPrice.toLocaleString()}원 매도\n+${pnlPct.toFixed(1)}% 챙겨갔습니다`, ts },
    { from: 'deputy', text: '팀장님...', ts: ts + 100 },
    { from: 'boss',   text: '다음 판 준비해', ts: ts + 200 },
  ]
  if (pnlPct >= 10) return [
    { from: 'spy',    text: `${sellPrice.toLocaleString()}원 매도`, ts },
    { from: 'deputy', text: `+${pnlPct.toFixed(1)}% 뒤통수 맞았습니다`, ts: ts + 100 },
    { from: 'boss',   text: nextDayChangePct !== null && nextDayChangePct < -2
        ? `내일 ${nextDayChangePct.toFixed(1)}% 줘\n아프게`
        : '올려. 더 올려', ts: ts + 200 },
  ]
  if (pnlPct >= 0) return [
    { from: 'spy',    text: `${sellPrice.toLocaleString()}원 매도\n+${pnlPct.toFixed(1)}%`, ts },
    { from: 'deputy', text: nextDayChangePct !== null && nextDayChangePct < 0
        ? `내일 ${nextDayChangePct.toFixed(1)}% 예정 ㅋ`
        : '적게 먹고 나갔네', ts: ts + 100 },
  ]
  return [
    { from: 'deputy', text: `손절 ${pnlPct.toFixed(1)}% ㅋㅋ`, ts },
    { from: 'boss',   text: '올려. 더 아프게', ts: ts + 100 },
  ]
}

export function makeCompleteMessages(totalPnlPct: number): ChatMessage[] {
  const ts = Date.now()
  if (totalPnlPct >= 20) return [
    { from: 'boss',   text: '이 개미 뭐야', ts },
    { from: 'deputy', text: `전체 +${totalPnlPct.toFixed(1)}% 챙겼습니다`, ts: ts + 100 },
    { from: 'boss',   text: '작전 다시 짜', ts: ts + 200 },
  ]
  if (totalPnlPct >= 0) return [
    { from: 'spy',    text: `종목 정리됨. 수익 +${totalPnlPct.toFixed(1)}%`, ts },
    { from: 'boss',   text: '다음 개미 대기시켜', ts: ts + 100 },
  ]
  return [
    { from: 'deputy', text: `손실 ${totalPnlPct.toFixed(1)}% ㅋㅋ`, ts },
    { from: 'boss',   text: '수고', ts: ts + 100 },
  ]
}
