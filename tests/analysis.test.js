// 실행: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sb = { console };
sb.globalThis = sb;
vm.createContext(sb);
for (const f of ["taxrates", "engine", "analysis"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "docs", f + ".js"), "utf-8"), sb);
}
const E = sb.SimulatorEngine, A = sb.SimulatorAnalysis;
const clone = (o) => JSON.parse(JSON.stringify(o));

test("기본 상태: 소득 공백(58~59세)을 경고로 알려 준다", () => {
  const st = E.createDefaultState();
  const sim = E.runSimulation(clone(st));
  const w = A.analyzeWarnings(sim, st);
  assert.ok(w.some((x) => x.level === "warn" && x.text.includes("소득 공백")));
});

test("합성 결과: 자산 소진·목표 미달 경고", () => {
  const rec = [];
  for (let age = 60; age <= 70; age++) {
    rec.push({ age, grossCif: 3, netCif: 2.8, balances: { financialTotal: age < 65 ? 100 : 0 } });
  }
  const sim = { yearlyRecords: rec, summary: { targetEnabled: true, shortfallYears: 3, firstShortfallAge: 66, effectiveDeductionRate: 10 } };
  const w = A.analyzeWarnings(sim, { meta: { endAge: 70 } });
  assert.ok(w.some((x) => x.level === "danger" && x.text.includes("65세에 소진")));
  assert.ok(w.some((x) => x.text.includes("목표 현금흐름 미달")));
});

test("스트레스: 낙관 > 기준 > 비관 (월평균 실수령), 입력 상태는 변경되지 않음", () => {
  const st = E.createDefaultState();
  const before = JSON.stringify(st);
  const [good, base, bad] = A.runStress(E, st);
  assert.ok(good.avgNet > base.avgNet && base.avgNet > bad.avgNet);
  assert.ok(good.finalNetWorth > base.finalNetWorth && base.finalNetWorth > bad.finalNetWorth);
  assert.strictEqual(JSON.stringify(st), before);
});

test("민감도: 수익률 상승은 종료 순자산을 늘리고 하락은 줄인다", () => {
  const { rows } = A.runSensitivity(E, E.createDefaultState());
  const up = rows.find((r) => r.label === "수익률 +1%p");
  const down = rows.find((r) => r.label === "수익률 −1%p");
  assert.ok(up.finalNetWorthDelta > 0 && down.finalNetWorthDelta < 0);
});

test("시나리오 요약은 현재가치 기준이며 원본 상태를 바꾸지 않는다", () => {
  const st = E.createDefaultState();
  const before = JSON.stringify(st);
  const s = A.summarizeScenario(E, st);
  assert.ok(Number.isFinite(s.avgNet) && Number.isFinite(s.finalNetWorth));
  assert.strictEqual(JSON.stringify(st), before);
});

test("입력 점검: 단위 실수·낙관적 수익률·범위 밖 개시 나이를 알려 준다", () => {
  const st = E.createDefaultState();
  assert.strictEqual(A.analyzeInputs(st).filter((x) => x.level === "warn").length, 0, "기본값은 경고 없음");
  st.assets.earnedIncome.monthlyGrossSalary = 500; // 원 단위로 잘못 입력
  st.assets.irp.returnRate = 12;
  st.assets.nationalPension.startAge = 72;
  st.taxConfig.nhisRate = 70;
  const txt = A.analyzeInputs(st).map((x) => x.text).join("\n");
  assert.ok(txt.includes("근로소득 월 급여"));
  assert.ok(txt.includes("IRP의 연 수익률"));
  assert.ok(txt.includes("수령 가능 범위"));
  assert.ok(txt.includes("건강보험료율"));
});

test("인출 방식 비교: 5개 행, 원본 상태 불변, 방식 변경이 결과에 영향", () => {
  const st = E.createDefaultState();
  const before = JSON.stringify(st);
  const res = A.runWithdrawalStrategies(E, st);
  assert.strictEqual(res.applicable, true);
  assert.strictEqual(res.rows.length, 5);
  assert.strictEqual(JSON.stringify(st), before);
  const uniq = new Set(res.rows.map((r) => r.avgNet.toFixed(6)));
  assert.ok(uniq.size > 1, "방식에 따라 결과가 달라져야 함");
  assert.ok(res.rows.every((r) => Number.isFinite(r.finalFinancial) && Number.isFinite(r.age85Net)));
  // 현재 설정 행은 기본 요약과 동일
  near0(res.rows[0].avgNet, A.summarizeScenario(E, st).avgNet);
});

test("인출 방식 비교: 목표 CIF 자동조절이 켜져 있으면 비교 불가", () => {
  const st = E.createDefaultState();
  st.target.enabled = true;
  assert.strictEqual(A.runWithdrawalStrategies(E, st).applicable, false);
});
function near0(a, b) { assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); }
