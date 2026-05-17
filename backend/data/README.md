# 주식 데이터 수집 모듈

KOSPI + KOSDAQ 전종목의 3년치 데이터를 SQLite에 수집합니다.

## 데이터 소스 (실제 작동 기준)

| 데이터 | 소스 | 비고 |
|---|---|---|
| 종목 목록 | Naver Finance sise 페이지 | KOSPI ~800개, KOSDAQ ~1,600개 |
| 종목명 | `m.stock.naver.com/api/stock/{code}/basic` | |
| OHLCV | pykrx `get_market_ohlcv_by_date` | 내부적으로 Naver fchart 사용 |
| 시총/PER/PBR/배당수익률 | `m.stock.naver.com/api/stock/{code}/integration` | |
| 외국인 보유비율 | 동일 integration API (`foreignRate`) | |

> **KRX data.krx.co.kr 관련**: KRX 데이터포털이 2024년 이후 인증 방식을 변경해  
> pykrx의 전종목 일괄 조회 API (`get_market_ohlcv_by_ticker` 등)가 작동하지 않습니다.  
> 이 모듈은 Naver Finance API만 사용하므로 안정적으로 동작합니다.

## 파일 구조

```
backend/data/
├── db.py            # SQLite 스키마 + CRUD 헬퍼
├── collector.py     # 데이터 수집 메인 로직
├── scheduler.py     # 매일 오후 4시 자동 실행
├── requirements.txt # Python 의존성
├── stocks.db        # 수집된 DB (최초 실행 후 생성)
├── collector.log    # 수집 로그
└── scheduler.log    # 스케줄러 로그
```

## DB 스키마

```sql
stocks        -- 종목 마스터 (symbol, name, market, sector)
prices        -- 일별 OHLCV + 시가총액(억원)
fundamentals  -- 일별 PER / PBR / 배당수익률
flows         -- 일별 외국인 보유비율(%)
```

- 모든 데이터 테이블은 `(symbol, date)` 복합 PK → **중복 없음, 증분 업데이트 자동 지원**
- `INSERT OR IGNORE` 방식: 이미 저장된 날짜는 자동 스킵

---

## 설치

```bash
cd backend/data

# 가상환경 생성 및 활성화
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

### VS Code Python 인터프리터 설정

VS Code에서 패키지 미설치 경고가 뜨면:
1. `Ctrl+Shift+P` → "Python: Select Interpreter"
2. `backend/data/.venv/Scripts/python.exe` 선택

---

## 실행 방법

### 1. 최초 전체 수집 (3년치)

```bash
python collector.py
```

- 수집 기간: 오늘로부터 3년 전 ~ 오늘
- 소요 시간: **약 3~6시간** (전종목 ~2,400개 × 3년)
- 진행률은 tqdm 프로그레스바로 표시
- 오류 발생 종목은 스킵 후 로그 기록 (`collector.log`)

### 2. 기간 지정 수집

```bash
# 특정 기간만 수집
python collector.py --start 20240101 --end 20241231

# 최근 1개월만 (빠른 테스트)
python collector.py --start 20250401
```

### 3. 단계별 실행

```bash
# DB 스키마만 생성
python collector.py --init-only

# 종목 마스터만 갱신 (이름 변경, 상장폐지 반영)
python collector.py --tickers-only

# OHLCV만 수집 (종목 마스터가 이미 있어야 함)
python collector.py --ohlcv-only --start 20250101
```

### 4. 스케줄러 실행 (매일 오후 4시 자동 수집)

```bash
# 포그라운드 실행 (터미널 유지)
python scheduler.py

# 지금 즉시 수집 후 스케줄 대기
python scheduler.py --run-now

# 즉시 한 번만 실행하고 종료 (CI/cron 사용)
python scheduler.py --run-now --once
```

### 5. Windows 작업 스케줄러 등록

```powershell
# 관리자 권한 PowerShell에서 실행
$python = "C:\01coding\stock-game\backend\data\.venv\Scripts\python.exe"
$script = "C:\01coding\stock-game\backend\data\scheduler.py"
$workdir = "C:\01coding\stock-game\backend\data"

$action  = New-ScheduledTaskAction -Execute $python `
             -Argument "$script --run-now --once" `
             -WorkingDirectory $workdir
$trigger = New-ScheduledTaskTrigger -Daily -At "16:00"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 4)

Register-ScheduledTask -TaskName "StockDataCollector" `
  -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

---

## 데이터 확인

```bash
sqlite3 stocks.db

.tables
SELECT COUNT(*) FROM stocks;                         -- 종목 수
SELECT COUNT(*) FROM prices;                         -- 가격 레코드 수
SELECT MAX(date) FROM prices;                        -- 마지막 수집 날짜
SELECT * FROM prices WHERE symbol='005930'
  ORDER BY date DESC LIMIT 5;                        -- 삼성전자 최근 5일
SELECT per, pbr, div_yield FROM fundamentals
  WHERE symbol='005930' ORDER BY date DESC LIMIT 3;  -- 펀더멘털
.quit
```

---

## 주의사항

- Naver Finance API는 공개 엔드포인트지만 **과도한 병렬 요청은 차단** 위험이 있습니다.
  - 기본 워커 수: `THREAD_WORKERS = 8` (`collector.py` 상단에서 조정 가능)
  - 기본 요청 간격: `API_DELAY = 0.3초`
- 최초 3년치 수집은 장 시간(09:00~15:30) **외**에 실행하는 것을 권장합니다.
- 수집 오류 종목은 로그에 기록되며 다음 실행 시 재시도됩니다 (`INSERT OR IGNORE`로 중복 없음).
