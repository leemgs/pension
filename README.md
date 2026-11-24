# pension

노후 현금흐름(CIF) 시뮬레이터 (FI · CIF Simulator): 연금·세금·건보료를 반영한 월 실수령액 계산 도구입니다.

근로소득, 국민연금, 퇴직연금 DC, IRP, 연금저축, 개인연금, 주식투자, 주택연금과
현행 세법·지역건보료를 통합 반영하여 은퇴 후 현금흐름을 시뮬레이션합니다.

## 구조

```
.
├── FI_CIF_Web_Package_.zip      # 배포용 원본 압축 파일
├── .github/workflows/test.yml   # 푸시·PR마다 테스트 실행(GitHub Actions)
├── tests/
│   ├── engine.test.js           # 계산 엔진 단위 테스트
│   ├── analysis.test.js         # 경고·스트레스·비교·인출방식·몬테카를로 테스트
│   ├── access.test.js           # 접속 코드 게이트 검증
│   ├── isa.test.js              # ISA 계좌 모델 검증
│   ├── verification.test.js     # 세금·건보료 손계산/공표값 검증
│   └── site.test.js             # 내부 링크·앵커·메타 무결성
└── docs/
    ├── assets/site.js           # 접속 코드 게이트 (initAuth / unlock)
    ├── config/access.json       # 접속 코드의 SHA-256 해시 (평문 저장 안 함)
    ├── index.html               # 시뮬레이터 (진입점)
    ├── scenarios.html           # 시나리오 소개 (?preset=1~3 딥링크)
    ├── compare.html             # 저장 시나리오 나란히 비교
    ├── taxrates.js              # 연도별 보험료율·기준값 (2024~2027)
    ├── help.js                  # 입력 항목 도움말 문구
    ├── cases.js                 # 가이드 사례(연금저축 55세/65세 수령) 재현용 상태
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

## 접속 코드 (접근 제한)

사이트는 초대받은 사용자를 위한 정보 공간이라 모든 페이지가 **접속 코드 입력 화면**으로 시작합니다.
기본으로 2개의 코드(`primary`, `guest`)가 설정되어 있고, 코드 자체(평문)는 저장소 어디에도 없습니다.

- **구현:** `docs/assets/site.js`의 `initAuth()` / `unlock()`
- **설정:** `docs/config/access.json`에 접속 코드의 **SHA-256 해시(digest)만** 저장
- **동작:** 입력한 코드를 브라우저에서 SHA-256으로 해시해 `access.json`의 digest와 비교하고, 일치하면 `sessionStorage`에 접근 허용 상태를 기록합니다. 허용 상태는 같은 탭에서만 유지되고(탭을 닫으면 다시 입력), 상단 메뉴의 "🔒 잠금" 버튼으로 바로 다시 잠글 수 있습니다.

> ⚠️ **정적 사이트의 간단한 접근 제한이며, 민감정보 보호 목적이 아닙니다.** 해시가 클라이언트에 노출되므로(짧은 코드는 해시만으로 역추적할 수 있습니다) 진짜 보안 경계로 사용하지 마세요.
> 자바스크립트를 끈 경우, 그리고 `docs/` 폴더를 `file://`로 직접 열어 쓰는 경우(이미 파일을 가진 경우)에는 적용되지 않습니다. 저장소가 공개라면 페이지 소스도 누구나 볼 수 있습니다.

### 접속 코드 변경 방법

1. 새 코드를 정합니다.
2. SHA-256 해시를 계산합니다.
   ```bash
   node -e "const c=require('crypto');console.log(c.createHash('sha256').update('새코드').digest('hex'))"
   ```
3. `docs/config/access.json`의 `digest` 값을 교체하고 `version`을 올립니다.

보충 설명:
- `codes` 배열의 항목 하나가 코드 하나입니다. 코드를 추가하려면 `{ "label": "이름", "digest": "해시" }` 항목을 더하고, 폐기하려면 해당 항목을 지웁니다.
- `version`을 올리면 이미 허용된 세션도 무효가 되어 모두 새 코드로 다시 입력해야 합니다. 코드를 바꾸면 **반드시** 올리세요.
- 코드 앞뒤 공백은 무시되고 대소문자는 구분됩니다. 길고 추측하기 어려운 코드를 쓰세요.
- 코드를 바꾼 뒤 `main`에 반영되면(GitHub Pages 배포 후) 새 설정이 적용됩니다. 브라우저는 설정 파일을 캐시 없이 읽습니다.

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
시나리오는 `index.html?preset=1`~`3`, 가이드 사례는 `index.html?case=pension-55` / `?case=pension-65`, 사례 비교는 `compare.html?cases=pension-55,pension-65`로 바로 열 수 있습니다.

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

GitHub Actions(`.github/workflows/test.yml`)가 `main` 푸시와 모든 PR에서 같은 테스트를 자동 실행합니다.
