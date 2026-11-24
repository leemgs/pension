# pension

노후 현금흐름(CIF) 시뮬레이터 (FI · CIF Simulator): 연금·세금·건보료를 반영한 월 실수령액 계산 도구입니다.

근로소득, 국민연금, 퇴직연금 DC, IRP, 연금저축, 개인연금, 주식투자, 주택연금과
현행 세법·지역건보료를 통합 반영하여 은퇴 후 현금흐름을 시뮬레이션합니다.

## 구조

```
.
├── FI_CIF_Web_Package_.zip      # 배포용 원본 압축 파일
├── tests/
│   ├── engine.test.js           # 계산 엔진 단위 테스트
│   ├── analysis.test.js         # 경고·스트레스·비교·인출방식·몬테카를로 테스트
│   └── verification.test.js     # 세금·건보료 손계산/공표값 검증
└── docs/
    ├── index.html               # 시뮬레이터 (진입점)
    ├── scenarios.html           # 시나리오 소개 (?preset=1~3 딥링크)
    ├── compare.html             # 저장 시나리오 나란히 비교
    ├── taxrates.js              # 연도별 보험료율·기준값 (2024~2027)
    ├── help.js                  # 입력 항목 도움말 문구
    ├── analysis.js              # 위험 경고·비교·스트레스·민감도 분석
    ├── compare.js               # 비교 페이지 로직
    ├── guide.html               # 사용 가이드 (빠른 시작)
    ├── manual.html              # 사용자 매뉴얼 (용어·입력 항목·결과 해석·활용)
    ├── assumptions.html         # 가정·세법 기준
    ├── links.html               # 참고 링크 (공식 사이트 모음)
    ├── learn.html               # 연금·투자 가이드 목록
    ├── learn-top3.html          # 2026 통장 TOP3 (ISA·연금저축·IRP)
    ├── learn-guide.html         # 연금 부자 길라잡이
    ├── learn-accounts.html      # 3개 계좌 활용 전략
    ├── learn.css                # 가이드 페이지 스타일
    ├── nav.js                   # 공통 상단 메뉴
    ├── app.js                   # UI 로직
    ├── engine.js                # 시뮬레이션 계산 엔진
    ├── styles.css               # 스타일
    ├── server.py                # 로컬 자동저장 서버 (선택)
    ├── data/                    # 마지막 설정 및 프리셋 3종
    ├── 웹_시뮬레이터_실행.bat
    └── 실행방법_안내.txt
```

> ⚠️ **면책 고지:** 결과는 입력 가정에 따른 참고용 추정치이며 세무·재무 자문이 아닙니다.
> 세법 기준은 2024~2026년 현행 규정이고 매년 개정될 수 있으니 공식 자료로 확인하세요.

## 실행 방법

- **간단 실행:** `docs/index.html`을 크롬/엣지 등 브라우저에서 엽니다.
  Python 없이 단독으로 동작하며, 브라우저 자동저장을 사용합니다.
- **로컬 서버 실행(Python):**
  ```bash
  cd docs
  python3 server.py
  ```
  Windows에서는 `웹_시뮬레이터_실행.bat`을 더블클릭해도 됩니다.

## 페이지 주소

각 메뉴는 고유한 `.html` 주소로 바로 접속할 수 있습니다.

| 메뉴 | 주소 |
|------|------|
| 시뮬레이터 | `docs/index.html` |
| 시나리오 | `docs/scenarios.html` |
| 시나리오 비교 | `docs/compare.html` |
| 사용 가이드 | `docs/guide.html` |
| 사용자 매뉴얼 | `docs/manual.html` |
| 가정·세법 기준 | `docs/assumptions.html` |
| 참고 링크 | `docs/links.html` |
| 연금·투자 가이드 | `docs/learn.html` (하위: `learn-top3.html`, `learn-guide.html`, `learn-accounts.html`) |

시뮬레이터 안의 영역은 `index.html#kpi-area`, `#cif-chart`, `#detail-table`, `#target-panel`, `#settings-panel`, `#scenario-panel`로,
시나리오는 `index.html?preset=1`~`3`으로 바로 열 수 있습니다.

## 프리셋

| # | 프리셋 |
|---|--------|
| 1 | 표준 균형 은퇴 플랜 (기본) |
| 2 | 배당·연금 조기은퇴 플랜 (56세) |
| 3 | 연기연금 + 주택연금 극대화 플랜 |

## 상태 저장/복원

상단의 **상태 파일 내보내기/불러오기(.json)** 버튼으로 현재 설정과 프리셋을 백업·복원할 수 있습니다.

## 테스트

계산 엔진(`docs/engine.js`)의 세금·공제 함수와 시뮬레이션 불변식을 검증합니다. (Node 18+)

```bash
node --test
```
