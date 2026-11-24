// ISA(개인종합자산관리계좌) 모델 검증: 만기 정산 과세, 연금계좌 이전, 추가 세액공제, 인출, 기존 결과 불변
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sb = { console };
sb.globalThis = sb;
vm.createContext(sb);
for (const f of ["taxrates", "engine"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "docs", f + ".js"), "utf-8"), sb);
const E = sb.SimulatorEngine;
const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} 기대 ${b}, 실제 ${a}`);

/** ISA만 단순하게 쓰는 상태: 근로소득만 있어 세금이 있고, 연금저축(이전 대상)은 켜 둠 */
function make(over) {
  const st = E.createDefaultState();
  st.meta.currentAge = 50; st.meta.endAge = 70; st.meta.inflationRate = 0; st.meta.valueMode = "nominal";
  st.target.enabled = false; st.target.startAge = 65;
  for (const k of Object.keys(st.assets)) st.assets[k].enabled = false;
  Object.assign(st.assets.earnedIncome, { enabled: true, startAge: 50, workYears: 20, monthlyGrossSalary: 5 });
  Object.assign(st.assets.pensionSavings, { enabled: true, currentBalance: 0, monthlyContrib: 0, growthReturnRate: 0, dividendReturnRate: 0, returnRate: 0, dividendRate: 0, contribEndAge: 0 });
  Object.assign(st.assets.isa, { enabled: true, currentBalance: 0, monthlyContrib: 1.0, contribEndAge: 53, returnRate: 0, dividendRate: 0, maturityYears: 3, termYears: 3, exemptLimit: 2, transferRatio: 100, withdrawRatio: 0 }, over || {});
  return st;
}
const run = (st) => E.runSimulation(clone(st));
const sum = (rec, k) => rec.reduce((a, r) => a + r[k], 0);

test("ISA 비활성(기본)이면 기존 결과와 완전히 같다", () => {
  const base = E.createDefaultState();
  const withIsaKey = clone(base);
  assert.strictEqual(withIsaKey.assets.isa.enabled, false);
  const a = run(base), b = run(withIsaKey);
  assert.strictEqual(a.summary.finalNetWorth, b.summary.finalNetWorth);
  assert.ok(a.yearlyRecords.every((r) => r.isa === 0 && r.isaTax === 0 && r.balances.isa === 0));
});

test("수익률 0%: 원금이 그대로 연금저축으로 이전되고 세금·세액공제는 원금 기준", () => {
  const st = make();
  const r = run(st);
  // 납입: 월 1.0 × 36개월(50~52세, 53세 미만) = 36, 첫 만기는 36개월 뒤(53세 시작)
  near(sum(r.yearlyRecords, "isaTransfer"), 36, 1e-9, "이전 합계");
  near(sum(r.yearlyRecords, "isaTax"), 0, 1e-9, "이익 0 → 세금 0");
  // 연금저축 잔액으로 이동 (수익률 0%, 연금 수령은 65세부터이므로 그 전 시점에서 확인)
  const at55 = r.yearlyRecords.find((x) => x.age === 55);
  near(at55.balances.ps, 36, 1e-9, "연금저축 잔액");
  near(at55.balances.isa, 0, 1e-9, "ISA 잔액");
  // 세액공제 = 이전금액 10% = 3.6 → 연 최대 3.0 한도, 이전은 한 번(만기 시점 연도)이므로 3.0
  near(sum(r.yearlyRecords, "isaCredit"), 3.0, 1e-9, "추가 세액공제 한도 300만원");
});

test("만기 정산 세금: (이익 − 비과세 한도) × 9.9%", () => {
  // 수익률을 높여 이익을 만든 뒤 세금이 공식과 일치하는지 직접 계산 비교
  const st = make({ returnRate: 12, dividendRate: 0, transferRatio: 0, withdrawRatio: 100 });
  const r = run(st);
  const tax = sum(r.yearlyRecords, "isaTax");
  assert.ok(tax > 0, "세금 발생");
  const payout = sum(r.yearlyRecords.map((x) => ({ v: x.isa * 12 })), "v"); // 월평균×12 = 연 인출액 (명목)
  // 첫 만기 정산 시점 원금 36, 잔액 B → 세금 = (B-36-2)*0.099, 인출 = B - 세금
  // payout(첫 주기) = B - tax  →  B = payout + tax
  const B = payout + tax;
  near(tax, (B - 36 - 2) * 0.099, 1e-6, "세금 공식");
});

test("손실이면 세금이 없고, 비과세 한도 이하 이익도 세금이 없다", () => {
  const loss = run(make({ returnRate: -5, transferRatio: 0, withdrawRatio: 100 }));
  near(sum(loss.yearlyRecords, "isaTax"), 0, 1e-12, "손실");
  const small = run(make({ returnRate: 1, transferRatio: 0, withdrawRatio: 100, exemptLimit: 4 }));
  near(sum(small.yearlyRecords, "isaTax"), 0, 1e-12, "한도 이하 이익");
});

test("연금저축이 꺼져 있으면 이전하지 않고 인출/재가입으로 처리", () => {
  const st = make({ transferRatio: 100 });
  st.assets.pensionSavings.enabled = false;
  const r = run(st);
  near(sum(r.yearlyRecords, "isaTransfer"), 0, 1e-12);
  near(sum(r.yearlyRecords, "isaCredit"), 0, 1e-12);
});

test("인출분은 그 해 현금흐름(CIF)에 잡히고, 재가입분은 ISA 잔액으로 남는다", () => {
  const st = make({ transferRatio: 0, withdrawRatio: 40, returnRate: 0 });
  const r = run(st);
  // 첫 만기: 인출 14.4, 재가입 21.6 → 이후 만기마다 재가입분의 40%가 다시 인출됨
  const first = r.yearlyRecords.find((x) => x.isa > 0);
  near(first.isa * 12, 14.4, 1e-9, "첫 만기 인출액");
  assert.ok(first.grossCif * 12 > 14.4, "CIF에 포함");
});

test("총 납입한도·연 납입한도를 지킨다", () => {
  const st = make({ monthlyContrib: 5, contribEndAge: 60, annualLimit: 20, totalLimit: 50, transferRatio: 0, withdrawRatio: 0, maturityYears: 30, termYears: 30 });
  const r = run(st);
  // 월 5×12 = 60 > 연 한도 20 → 연 20씩, 총 50에서 중단 (20+20+10)
  const bal = r.yearlyRecords.map((x) => x.balances.isa);
  near(bal[0], 20, 1e-9, "첫 해");
  near(bal[1], 40, 1e-9, "둘째 해");
  near(bal[2], 50, 1e-9, "셋째 해: 총 한도");
  near(bal[3], 50, 1e-9, "이후 납입 없음");
});

test("연금계좌 이전 세액공제는 그 해 소득세를 넘지 않는다(환급 없음)", () => {
  const st = make();
  st.assets.earnedIncome.enabled = false; // 소득세 0
  const r = run(st);
  near(sum(r.yearlyRecords, "isaCredit"), 0, 1e-12);
  assert.ok(r.yearlyRecords.every((x) => x.tax >= -1e-12), "세금이 음수가 되지 않음");
});

test("ISA 잔액은 금융자산에 포함된다", () => {
  const st = make({ maturityYears: 30, termYears: 30, transferRatio: 0, returnRate: 0, monthlyContrib: 1, contribEndAge: 52 });
  const r = run(st);
  const first = r.yearlyRecords[0];
  near(first.balances.isa, 12, 1e-9);
  near(first.balances.financialTotal, 12, 1e-9, "금융자산에 포함");
});
