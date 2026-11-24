/* 분석 보조 모듈: 경고 진단, 시나리오 비교, 가정 흔들어 보기(스트레스·민감도).
 * 계산 엔진(engine.js)의 runSimulation 결과만 사용하며 화면(DOM)에 의존하지 않습니다. */
(function (global) {
  "use strict";

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmtAges = (ages) => {
    // [58,59,60,62] -> "58~60세, 62세"
    const out = [];
    let s = ages[0], prev = ages[0];
    for (let i = 1; i <= ages.length; i++) {
      if (ages[i] === prev + 1) { prev = ages[i]; continue; }
      out.push(s === prev ? `${s}세` : `${s}~${prev}세`);
      s = ages[i]; prev = ages[i];
    }
    return out.join(", ");
  };

  /** 결과에서 사용자가 놓치기 쉬운 위험 신호를 뽑습니다. */
  function analyzeWarnings(sim, state) {
    const rec = sim.yearlyRecords || [];
    const list = [];
    if (!rec.length) return list;
    const endAge = rec[rec.length - 1].age;

    // 1) 소득 공백: 세전 현금흐름이 거의 0인 연령
    const gapAges = rec.filter((r) => r.grossCif < 0.05).map((r) => r.age);
    if (gapAges.length) {
      list.push({
        level: "warn",
        text: `소득 공백: ${fmtAges(gapAges)}에는 현금흐름이 거의 없습니다. 연금·배당 개시 나이나 근로 기간을 조정하거나 이 기간의 생활비 재원을 따로 확인하세요.`,
      });
    }

    // 2) 금융자산 고갈 (현금흐름이 이어지는 중 잔액 0)
    const dep = rec.find((r, i) => i > 0 && r.balances.financialTotal < 0.05 && rec[i - 1].balances.financialTotal >= 0.05);
    if (dep && dep.age < endAge) {
      list.push({
        level: "danger",
        text: `금융자산이 ${dep.age}세에 소진됩니다(종료 나이 ${endAge}세 이전). 이후에는 국민연금·주택연금 등 남은 소득에만 의존합니다.`,
      });
    }

    // 3) 목표 CIF 미달
    const s = sim.summary;
    if (s.targetEnabled && s.shortfallYears > 0) {
      list.push({
        level: "danger",
        text: `목표 현금흐름 미달: ${s.firstShortfallAge}세부터 총 ${s.shortfallYears}년 부족합니다. 목표 금액을 낮추거나 개시 나이·자산 우선순위를 조정해 보세요.`,
      });
    }

    // 4) 실수령액 급감 (직전 해 대비 25% 이상 감소, 공백 제외)
    for (let i = 1; i < rec.length; i++) {
      const a = rec[i - 1].netCif, b = rec[i].netCif;
      if (a > 0.5 && b > 0.05 && b < a * 0.75) {
        list.push({
          level: "info",
          text: `${rec[i].age}세에 월 실수령액이 ${a.toFixed(2)} → ${b.toFixed(2)}백만원으로 25% 이상 줄어듭니다(근로 종료·연금 소진 등).`,
        });
        break;
      }
    }

    // 5) 가정 점검
    const m = state.meta || {};
    if (m.endAge < 85) {
      list.push({ level: "info", text: `종료 나이가 ${m.endAge}세입니다. 장수 위험을 고려해 90세 이상으로도 확인해 보세요.` });
    }
    if (s.effectiveDeductionRate > 25) {
      list.push({ level: "info", text: `실효 차감률이 ${s.effectiveDeductionRate.toFixed(1)}%로 높습니다. 세금·건보료 구성(상세 표)을 확인하세요.` });
    }
    return list;
  }

  /** 비교용 핵심 지표(현재가치 기준). 입력 state는 변경하지 않습니다. */
  function summarizeScenario(E, state) {
    const st = clone(state);
    st.meta.valueMode = "real";
    const sim = E.runSimulation(st);
    const rec = sim.yearlyRecords;
    const s = sim.summary;
    const dep = rec.find((r, i) => i > 0 && r.balances.financialTotal < 0.05 && rec[i - 1].balances.financialTotal >= 0.05);
    const gapYears = rec.filter((r) => r.grossCif < 0.05).length;
    return {
      sim,
      avgNet: s.avgNetCif,
      avgGross: s.avgGrossCif,
      avgCost: s.avgMonthlyCost,
      effRate: s.effectiveDeductionRate,
      age65Net: s.age65NetCif,
      age75Net: s.age75NetCif,
      finalFinancial: s.finalFinancialBalance,
      finalNetWorth: s.finalNetWorth,
      depletionAge: dep && dep.age < rec[rec.length - 1].age ? dep.age : null,
      gapYears,
      shortfallYears: s.targetEnabled ? s.shortfallYears : null,
    };
  }

  /** 수익률(자본수익률 성격)을 d%p 만큼 이동한 복제 상태. */
  function shiftReturns(state, d) {
    const st = clone(state);
    for (const k of ["dcPension", "irp", "pensionSavings"]) {
      const a = st.assets[k];
      if (!a) continue;
      if (a.growthReturnRate !== undefined) a.growthReturnRate += d;
      if (a.returnRate !== undefined && a.growthReturnRate === undefined) a.returnRate += d;
    }
    if (st.assets.privatePension && st.assets.privatePension.returnRate !== undefined) st.assets.privatePension.returnRate += d;
    if (st.assets.stockPortfolio) st.assets.stockPortfolio.priceReturnRate += d;
    return st;
  }

  const shiftInflation = (st, d) => { st.meta.inflationRate = Math.max(0, st.meta.inflationRate + d); return st; };

  /** 낙관/기준/비관 3개 시나리오 (수익률 ±2%p, 물가 ∓0.5%p). */
  function runStress(E, state) {
    const defs = [
      { key: "good", label: "낙관", note: "수익률 +2%p · 물가 −0.5%p", st: shiftInflation(shiftReturns(state, 2), -0.5) },
      { key: "base", label: "기준", note: "입력값 그대로", st: clone(state) },
      { key: "bad", label: "비관", note: "수익률 −2%p · 물가 +0.5%p", st: shiftInflation(shiftReturns(state, -2), 0.5) },
    ];
    return defs.map((d) => Object.assign({ key: d.key, label: d.label, note: d.note }, summarizeScenario(E, d.st)));
  }

  /** 한 가지씩만 바꿨을 때 기준 대비 변화(민감도). */
  function runSensitivity(E, state) {
    const base = summarizeScenario(E, state);
    const items = [
      { label: "수익률 −1%p", st: shiftReturns(state, -1) },
      { label: "수익률 +1%p", st: shiftReturns(state, 1) },
      { label: "물가상승률 +1%p", st: shiftInflation(clone(state), 1) },
      { label: "물가상승률 −1%p", st: shiftInflation(clone(state), -1) },
    ];
    const np = state.assets.nationalPension;
    if (np && np.enabled) {
      for (const dy of [-1, 1]) {
        const st = clone(state);
        st.assets.nationalPension.startAge = Math.min(70, Math.max(60, np.startAge + dy));
        if (st.assets.nationalPension.startAge !== np.startAge) items.push({ label: `국민연금 개시 ${dy > 0 ? "+" : ""}${dy}년`, st });
      }
    }
    const t = clone(state);
    t.meta.endAge = Math.min(110, state.meta.endAge + 5);
    items.push({ label: "종료 나이 +5년", st: t });
    return {
      base,
      rows: items.map((it) => {
        const r = summarizeScenario(E, it.st);
        return { label: it.label, avgNetDelta: r.avgNet - base.avgNet, finalNetWorthDelta: r.finalNetWorth - base.finalNetWorth, depletionAge: r.depletionAge };
      }),
    };
  }

  global.SimulatorAnalysis = { analyzeWarnings, summarizeScenario, runStress, runSensitivity };
})(typeof window !== "undefined" ? window : globalThis);
