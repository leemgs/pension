// 실행: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sb = { console, setTimeout };
sb.globalThis = sb;
vm.createContext(sb);
for (const f of ["taxrates", "engine", "cases", "analysis"]) {
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

test("몬테카를로: 변동성 0이면 결정적, 변동성이 크면 분위가 벌어짐, 시드 재현", async () => {
  const st = E.createDefaultState();
  const base = A.summarizeScenario(E, st);
  const z = await A.runMonteCarlo(E, st, { n: 20, sigma: 0 });
  assert.ok(Math.abs(z.finalFinancial.p10 - base.finalFinancial) < 1e-6 && Math.abs(z.finalFinancial.p90 - base.finalFinancial) < 1e-6);
  assert.strictEqual(z.successRate, base.depletionAge ? 0 : 1);

  const a = await A.runMonteCarlo(E, st, { n: 60, sigma: 0.2, seed: 7 });
  const b = await A.runMonteCarlo(E, st, { n: 60, sigma: 0.2, seed: 7 });
  assert.deepStrictEqual(a.finalFinancial, b.finalFinancial, "같은 시드는 같은 결과");
  assert.ok(a.finalFinancial.p10 < a.finalFinancial.p50 && a.finalFinancial.p50 < a.finalFinancial.p90);
  assert.strictEqual(a.balanceBand.length, a.ages.length);
  assert.ok(a.successRate >= 0 && a.successRate <= 1);
});

test("몬테카를로: 자산을 줄이면 성공 확률이 떨어진다", async () => {
  const st = E.createDefaultState();
  const lean = clone(st);
  lean.target.enabled = false;
  ["dcPension", "irp", "pensionSavings", "stockPortfolio"].forEach((k) => { lean.assets[k].currentBalance *= 0.2; });
  lean.assets.stockPortfolio.sellMode = lean.assets.stockPortfolio.sellMode;
  lean.assets.privatePension.enabled = true;
  const rich = await A.runMonteCarlo(E, st, { n: 80, sigma: 0.15 });
  const poor = await A.runMonteCarlo(E, lean, { n: 80, sigma: 0.15 });
  assert.ok(poor.finalFinancial.p50 < rich.finalFinancial.p50);
  assert.ok(poor.successRate <= rich.successRate);
});

test("목표 역산: 최대 지속 가능 금액과 필요 자산이 서로 일관됨", async () => {
  const st = E.createDefaultState();
  const before = JSON.stringify(st);
  const r = await A.solveReverse(E, st, 5);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(JSON.stringify(st), before, "원본 불변");
  // 최대 지속 가능 금액 바로 아래는 가능, 위는 불가능 (엔진으로 직접 확인)
  const feasibleAt = (v, k = 1) => {
    const c = clone(st); c.meta.valueMode = "nominal"; c.target.enabled = true; c.target.netMonthly = v;
    ["dcPension", "irp", "pensionSavings", "stockPortfolio", "privatePension"].forEach((x) => { c.assets[x].cifMode = "auto"; if (c.assets[x].currentBalance !== undefined) c.assets[x].currentBalance *= k; });
    return E.runSimulation(c, { lite: true }).summary.shortfallYears === 0;
  };
  assert.ok(feasibleAt(r.maxSustainable * 0.99), "최대값의 99%는 가능");
  assert.ok(!feasibleAt(r.maxSustainable * 1.03 + 0.02), "최대값을 넘으면 불가능");
  // 목표 5가 최대값보다 크면 자산을 더 늘려야 하고, 필요 자산으로 실제 목표 달성
  if (r.maxSustainable < 5) assert.ok(r.requiredScale > 1);
  assert.ok(feasibleAt(5, r.requiredScale * 1.02 + 1e-6), "필요 자산(+2%)으로 목표 달성");
  assert.ok(!feasibleAt(5, r.requiredScale * 0.9 - 0.01) || r.requiredScale === 0, "필요 자산보다 10% 적으면 불가");
});

test("목표 역산: 목표가 낮을수록 필요 자산이 적다", async () => {
  const st = E.createDefaultState();
  const low = await A.solveReverse(E, st, 3), high = await A.solveReverse(E, st, 8);
  assert.ok(low.requiredFinancial < high.requiredFinancial);
  assert.ok(Math.abs(low.maxSustainable - high.maxSustainable) < 0.02, "최대 지속 금액은 목표와 무관");
});

test("목표 역산: 금융자산이 없으면 안내", async () => {
  const st = E.createDefaultState();
  ["dcPension", "irp", "pensionSavings", "stockPortfolio", "privatePension"].forEach((k) => { st.assets[k].enabled = false; });
  const r = await A.solveReverse(E, st, 5);
  assert.strictEqual(r.ok, false);
});

test("가이드 사례: 55세/65세 수령 총 세금이 가이드 숫자(1,045만원/880만원)와 일치", () => {
  const C = sb.SimulatorCases;
  assert.ok(C && C.list.length >= 2);
  for (const c of C.list.filter((x) => x.expectTotalTax !== undefined)) {
    const st = c.build(E);
    const sim = E.runSimulation(clone(st));
    const total = sim.yearlyRecords.reduce((a, r) => a + r.tax * 12, 0);
    assert.ok(Math.abs(total - c.expectTotalTax) < 1e-6, `${c.id}: ${total} != ${c.expectTotalTax}`);
    const gross = sim.yearlyRecords.reduce((a, r) => a + r.grossCif * 12, 0);
    assert.ok(Math.abs(gross - 200) < 1e-6, "수령 총액 2억원");
    assert.strictEqual(A.summarizeScenario(E, st).totalTax.toFixed(2), c.expectTotalTax.toFixed(2));
  }
  assert.ok(C.get("pension-65").expectTotalTax < C.get("pension-55").expectTotalTax);
});

test("세금 기준선: 배당 2,000만원 초과·근접, 사적연금 1,500만원 초과·근접", () => {
  const base = E.createDefaultState();
  // 배당이 매우 높음 → 2,000만원 초과 경고
  const hi = clone(base); hi.assets.stockPortfolio.currentBalance = 700;
  const w1 = A.analyzeThresholds(E, hi);
  assert.ok(w1.some((x) => x.level === "warn" && x.text.includes("연 2,000만원을 넘는 해")));
  // 주식 없음 → 배당 관련 경고 없음
  const none = clone(base); none.assets.stockPortfolio.enabled = false;
  assert.ok(!A.analyzeThresholds(E, none).some((x) => x.text.includes("배당소득")));

  // 퇴직연금 DC 10년 수령: 1.65억 → 연 1,650만원(초과), 1.45억 → 연 1,450만원(근접)
  const mk = (bal) => {
    const c = sb.SimulatorCases.get("pension-55").build(E);
    c.assets.pensionSavings.enabled = false;
    Object.assign(c.assets.dcPension, { enabled: true, currentBalance: bal, growthReturnRate: 0, dividendReturnRate: 0, returnRate: 0, dividendRate: 0, withdrawalMode: "period", payoutYears: 10, severancePrincipalRatio: 0 });
    return c;
  };
  const over = A.analyzeThresholds(E, mk(165));
  assert.ok(over.some((x) => x.level === "warn" && x.text.includes("연 1,500만원을 넘는 해") && x.text.includes("1,650만원")));
  const near = A.analyzeThresholds(E, mk(145));
  assert.ok(near.some((x) => x.level === "info" && x.text.includes("1,500만원 기준선에 근접")));
  assert.ok(!near.some((x) => x.level === "warn"));
  // 원본 불변
  const before = JSON.stringify(hi); A.analyzeThresholds(E, hi); assert.strictEqual(JSON.stringify(hi), before);
});

test("가이드 사례: ISA 3년 납입 후 연금저축 이전 → 6,000만원 이전, 세액공제 한도 300만원", () => {
  const c = sb.SimulatorCases.get("isa-transfer");
  const r = c.check(E.runSimulation(clone(c.build(E))));
  assert.strictEqual(r.ok, true, r.text);
});

test("입력 점검: ISA 설정 오류(이전 불가·한도 초과)를 알려 준다", () => {
  const st = E.createDefaultState();
  assert.ok(!A.analyzeInputs(st).some((x) => x.text.includes("ISA")), "ISA 꺼짐: 경고 없음");
  st.assets.isa.enabled = true;
  st.assets.isa.monthlyContrib = 3; // 연 36 > 20
  st.assets.pensionSavings.enabled = false;
  const txt = A.analyzeInputs(st).map((x) => x.text).join("\n");
  assert.ok(txt.includes("연 납입한도"));
  assert.ok(txt.includes("연금저축 자산이 꺼져"));
});
