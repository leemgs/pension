// 실행: node --test tests/   (Node 18+)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const src = fs.readFileSync(path.join(__dirname, "..", "docs", "engine.js"), "utf-8");
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
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
