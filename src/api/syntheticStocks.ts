import type { CandleBar } from './yahooFinance'

export interface SyntheticStock {
  symbol: string
  name: string
  sector: string
}

// 실제 코스닥 종목 - 다양한 섹터/추세 혼합
export const SYNTHETIC_STOCKS: SyntheticStock[] = [
  { symbol: '196170.KQ', name: '알테오젠',         sector: '바이오'     },
  { symbol: '028300.KQ', name: 'HLB',              sector: '바이오'     },
  { symbol: '214150.KQ', name: '클래시스',         sector: '의료기기'   },
  { symbol: '277810.KQ', name: '레인보우로보틱스', sector: '로봇'       },
  { symbol: '293490.KQ', name: '카카오게임즈',     sector: '게임'       },
  { symbol: '263750.KQ', name: '펄어비스',         sector: '게임'       },
  { symbol: '357780.KQ', name: '솔브레인',         sector: '반도체소재' },
  { symbol: '058470.KQ', name: '리노공업',         sector: '반도체부품' },
  { symbol: '403870.KQ', name: 'HPSP',             sector: '반도체장비' },
  { symbol: '214450.KQ', name: '파마리서치',       sector: '바이오'     },
]

export const ALTERNATE_STOCKS: SyntheticStock[] = [
  { symbol: '237690.KQ', name: '에스티팜',         sector: '바이오'     },
  { symbol: '328130.KQ', name: '루닛',             sector: 'AI의료'     },
  { symbol: '213420.KQ', name: '덕산네오룩스',     sector: 'OLED소재'   },
  { symbol: '352480.KQ', name: '씨앤씨인터내셔널', sector: '화장품'     },
  { symbol: '022100.KQ', name: '포스코DX',         sector: 'IT'         },
  { symbol: '240810.KQ', name: '원익IPS',          sector: '반도체장비' },
  { symbol: '145020.KQ', name: '휴젤',             sector: '바이오'     },
  { symbol: '257720.KQ', name: '실리콘투',         sector: 'K뷰티'      },
  { symbol: '031980.KQ', name: '피에스케이홀딩스', sector: '반도체장비' },
  { symbol: '214370.KQ', name: '케어젠',           sector: '바이오'     },
]

const ALL_STOCKS = [...SYNTHETIC_STOCKS, ...ALTERNATE_STOCKS]
const NAME_MAP = Object.fromEntries(ALL_STOCKS.map((s) => [s.symbol, s.name]))

export function getSyntheticName(symbol: string): string {
  return NAME_MAP[symbol] ?? symbol
}

export function isSynthetic(symbol: string): boolean {
  return symbol.startsWith('SIM')
}

// 구버전 저장 데이터 호환용
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSyntheticCandles(_symbol: string): CandleBar[] {
  return []
}
