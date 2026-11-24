// 세금·보험료 계산 검증 (독립 손계산 + 공개된 기준값).
// 주의: 국세청·공단 계산기 출력을 직접 대조한 것이 아니라, 법령 산식을 별도로 손계산한 값과
// 널리 알려진 공표 수치(예: 월 300만원 직장인 4대보험)와 맞는지 확인합니다. 단위: 백만원.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sb = { console };
sb.globalThis = sb;
vm.createContext(sb);
for (const f of ["taxrates", "engine"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "docs", f + ".js"), "utf-8"), sb);
const E = sb.SimulatorEngine, I = E._internal, TR = sb.SimulatorTaxRates;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} 기대 ${b}, 실제 ${a}`);
const won = (v) => v * 1_000_000;

test("종합소득세 기본세율: 널리 알려진 과세표준별 산출세액", () => {
  near(I.calcProgressiveNationalIncomeTax(14), 0.84, 1e-9, "1,400만원");
  near(I.calcProgressiveNationalIncomeTax(30), 3.24, 1e-9, "3,000만원 → 324만원");
  near(I.calcProgressiveNationalIncomeTax(50), 6.24, 1e-9, "5,000만원 → 624만원");
  near(I.calcProgressiveNationalIncomeTax(88), 15.36, 1e-9, "8,800만원 → 1,536만원");
  near(I.calcProgressiveNationalIncomeTax(150), 37.06, 1e-9, "1.5억원 → 3,706만원");
  near(I.calcProgressiveNationalIncomeTax(300), 94.06, 1e-9, "3억원 → 9,406만원");
});

test("연금소득공제: 구간별 손계산", () => {
  near(I.calcPensionIncomeDeduction(10), 5.5, 1e-9, "연금 1,000만원 → 공제 550만원");
  near(I.calcPensionIncomeDeduction(20), 6.9, 1e-9, "연금 2,000만원 → 630+60=690만원");
  near(I.calcPensionIncomeDeduction(1000), 9.0, 1e-9, "한도 900만원");
});

test("직장인 월 300만원 4대보험(2025 요율)은 공표 수치와 일치", () => {
  const r = I.calcEarnedIncomeMonthly(3, 1.5, TR.get(2025));
  near(won(r.pensionPart), 135000, 1, "국민연금 135,000원");
  near(won(r.healthPart), 106350, 1, "건강보험 106,350원");
  near(won(r.ltciPart), 13770, 5, "장기요양 약 13,770원");
  near(won(r.employPart), 27000, 1, "고용보험 27,000원");
});

test("직장인 월 300만원 4대보험(2026 요율)", () => {
  const r = I.calcEarnedIncomeMonthly(3, 1.5, TR.get(2026));
  near(won(r.pensionPart), 142500, 1, "국민연금 4.75%");
  near(won(r.healthPart), 107850, 1, "건강보험 7.19%의 절반");
  near(won(r.ltciPart), 14172, 5, "장기요양 13.14%");
});

test("국민연금 기준소득월액 상한 적용 (월 1,000만원 급여)", () => {
  const r = I.calcEarnedIncomeMonthly(10, 1.5, TR.get(2026));
  near(r.pensionPart, 6.59 * 0.0475, 1e-9);
});

test("근로소득세 손계산: 연봉 3,600만원 (본인 공제만)", () => {
  // 근로소득공제 750+(3600-1500)*15%=1,065만 → 소득금액 2,535만 → 인적공제 150만 → 과표 2,385만
  // 산출 2,385만*15%-126만=231.75만, 세액공제 71.5+(231.75-130)*30%=102.025만 → 한도 74-(3600-3300)*0.8%=71.6만
  // 결정세액 231.75-71.6=160.15만원
  const r = I.calcEarnedIncomeMonthly(3, 1.5, TR.get(2026));
  near(r.incomeTax * 12, 1.6015, 1e-6, "국세");
  near(r.localTax * 12, 0.16015, 1e-6, "지방소득세 10%");
});

test("근로소득세액공제 한도: 연봉 1억원이면 50만원", () => {
  // 연봉 1억: 공제 14.75 → 85.25 → 인적공제 1.5 → 과표 83.75 → 산출 83.75*24%-5.76=14.34
  // 세액공제 계산값 4.627이지만 한도 0.5 → 결정세액 13.84
  const r = I.calcEarnedIncomeMonthly(100 / 12, 1.5, TR.get(2026));
  near(r.incomeTax * 12, 13.84, 1e-6);
});

test("건보 재산 점수표: 60등급, 공표 점수와 일치", () => {
  // 시세 850, 공시비율 69% → 공시 586.5 → ×60% = 351.9 → 기본공제 100 → 251.9(2억5,190만원) → 26등급(25,300만 이하) 637점
  near(I.calcNhisPropertyMonthly(850, 69, 211.5), 637 * 211.5 / 1e6, 1e-9, "26등급 637점");
  // 3등급(900~1,350만원)은 66점 (이전 표의 64점이 아님): 과표-1억 = 1,200만원이 되도록 시세 역산
  const price = (100 + 12) / 0.6 / 0.7; // 공시비율 70% → 과표 합 112 → 공제 후 12
  near(I.calcNhisPropertyMonthly(price, 70, 100), 66 * 100 / 1e6, 1e-9, "3등급 66점");
  // 1억 이하 과표는 0
  assert.strictEqual(I.calcNhisPropertyMonthly(100, 70, 211.5), 0);
});

test("1세대 1주택 재산세 손계산 (공시가 6억 → 과표 2.7억)", () => {
  // 공시 600 × 45% = 과표 270 → 12만+(270-150)*0.2%=36만, 지방교육세 20%=7.2만, 도시지역분 270*0.14%=37.8만 → 연 81만원
  near(I.calcMonthlyHousingPropertyTax(600 / 0.7, 70), 0.81 / 12, 1e-6);
});

test("정책 일관성: 지역가입자 건보료 기준 연도별 비용 증가", () => {
  const a = E.createDefaultState(); E.applyRateYear(a.taxConfig, 2025);
  const b = E.createDefaultState(); E.applyRateYear(b.taxConfig, 2026);
  const ra = E.runSimulation(JSON.parse(JSON.stringify(a)));
  const rb = E.runSimulation(JSON.parse(JSON.stringify(b)));
  assert.ok(rb.summary.avgMonthlyCost > ra.summary.avgMonthlyCost);
});
