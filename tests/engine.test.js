// 실행: node --test   (Node 18+)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "docs", "engine.js"), "utf-8");
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "docs", "taxrates.js"), "utf-8"), sandbox);
vm.runInContext(src, sandbox);
const E = sandbox.SimulatorEngine;
const I = E._internal;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("연금소득공제 구간 경계", () => {
  near(I.calcPensionIncomeDeduction(0), 0);
  near(I.calcPensionIncomeDeduction(3.5), 3.5);
  near(I.calcPensionIncomeDeduction(7), 4.9);
  near(I.calcPensionIncomeDeduction(14), 6.3);
  near(I.calcPensionIncomeDeduction(100), 9.0); // 한도 900만원
});

test("종합소득세 기본세율 (누진공제 방식, 구간 경계 연속)", () => {
  near(I.calcProgressiveNationalIncomeTax(0), 0);
  near(I.calcProgressiveNationalIncomeTax(14), 0.84);
  for (const b of [14, 50, 88, 150, 300, 500, 1000]) {
    const lo = I.calcProgressiveNationalIncomeTax(b - 1e-9);
    const hi = I.calcProgressiveNationalIncomeTax(b + 1e-9);
    assert.ok(Math.abs(hi - lo) < 1e-6, `경계 ${b}에서 불연속`);
  }
  near(I.calcProgressiveNationalIncomeTax(2000), 2000 * 0.45 - 65.94);
});

test("근로소득공제 구간 경계 연속", () => {
  near(I.calcEarnedIncomeDeduction(5), 3.5);
  near(I.calcEarnedIncomeDeduction(15), 7.5);
  near(I.calcEarnedIncomeDeduction(45), 12.0);
  near(I.calcEarnedIncomeDeduction(100), 14.75);
  near(I.calcEarnedIncomeDeduction(1000), 20.0); // 법정 한도 2,000만원
});

test("건보 재산 점수·재산세: 0 이하 입력, 단조 증가", () => {
  assert.strictEqual(I.calcNhisPropertyMonthly(0, 70), 0);
  assert.strictEqual(I.calcMonthlyHousingPropertyTax(0, 70), 0);
  let prevN = 0, prevP = 0;
  for (const price of [100, 300, 500, 800, 1200, 2000, 4000]) {
    const n = I.calcNhisPropertyMonthly(price, 70);
    const t = I.calcMonthlyHousingPropertyTax(price, 70);
    assert.ok(n >= prevN && t >= prevP, `${price}에서 감소`);
    prevN = n; prevP = t;
  }
});

test("기본 상태 시뮬레이션: 구조와 불변식", () => {
  const st = E.createDefaultState();
  const r = E.runSimulation(st);
  const years = st.meta.endAge - st.meta.currentAge + 1;
  assert.ok(r.yearlyRecords.length >= years - 1);
  for (const y of r.yearlyRecords) {
    assert.ok(Number.isFinite(y.grossCif) && Number.isFinite(y.netCif), `${y.age}세 NaN`);
    assert.ok(y.netCif <= y.grossCif + 1e-9, `${y.age}세 실수령이 세전보다 큼`);
    assert.ok(y.totalCost >= -1e-9, `${y.age}세 비용 음수`);
  }
});

test("샘플 프리셋 모두 실행되고 유한한 결과", () => {
  for (const p of E.getSamplePresets()) {
    const r = E.runSimulation(p.state || p);
    assert.ok(Number.isFinite(r.summary.avgNetCif), "avgNetCif");
    assert.ok(Number.isFinite(r.summary.finalNetWorth), "finalNetWorth");
  }
});

test("요율표: 장기요양 비율이 공표 요율과 일치하고 연도 전환이 결과에 반영된다", () => {
  const TR = sandbox.SimulatorTaxRates;
  // 장기요양(소득 대비 %) = 건보료율 × 비율: 2025 0.9182%, 2026 0.9448%
  near(TR.get(2025).nhisRate * TR.get(2025).ltciRateOfNhis / 100, 0.9182, 0.0005);
  near(TR.get(2026).nhisRate * TR.get(2026).ltciRateOfNhis / 100, 0.9448, 0.0005);
  assert.strictEqual(E.createDefaultState().taxConfig.rateYear, TR.latest);

  const st25 = E.createDefaultState();
  E.applyRateYear(st25.taxConfig, 2025);
  const st26 = E.createDefaultState();
  const a = E.runSimulation(JSON.parse(JSON.stringify(st25)));
  const b = E.runSimulation(JSON.parse(JSON.stringify(st26)));
  assert.ok(b.summary.avgMonthlyCost > a.summary.avgMonthlyCost, "2026 요율이 더 높은 비용");
});

test("예전 저장본(rateYear 없음)은 당시 요율로 고정된다", () => {
  const legacy = E.createDefaultState();
  delete legacy.taxConfig.rateYear;
  legacy.taxConfig.nhisRate = 7.09; legacy.taxConfig.ltciRateOfNhis = 12.95;
  delete legacy.taxConfig.nhisPointValue; delete legacy.taxConfig.npEmployeeRate; delete legacy.taxConfig.npMonthlyCap;
  E.migrateTaxConfig(legacy.taxConfig);
  assert.strictEqual(legacy.taxConfig.rateYear, "custom");
  assert.strictEqual(legacy.taxConfig.nhisPointValue, 208.4);
  assert.strictEqual(legacy.taxConfig.npEmployeeRate, 4.5);
});

test("근로자 4대보험: 국민연금 상한과 건보료 절반 부담", () => {
  const r = I.calcEarnedIncomeMonthly(10, 1.5, { nhisRate: 7.19, ltciRateOfNhis: 13.14, npEmployeeRate: 4.75, npMonthlyCap: 6.59 });
  near(r.pensionPart, 6.59 * 0.0475);
  near(r.healthPart, 10 * 0.0719 / 2);
  near(r.ltciPart, r.healthPart * 0.1314);
});
