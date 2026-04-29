export function formatKRW(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ko-KR').format(value)
}

export function formatChangePercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatChange(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${formatNumber(Math.round(value))}`
}

export function changeColor(value: number): string {
  if (value > 0) return 'text-red-400'
  if (value < 0) return 'text-blue-400'
  return 'text-gray-400'
}

export function changeBg(value: number): string {
  if (value > 0) return 'bg-red-500/10 text-red-400'
  if (value < 0) return 'bg-blue-500/10 text-blue-400'
  return 'bg-gray-500/10 text-gray-400'
}
