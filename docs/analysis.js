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
      totalTax: rec.reduce((a, r) => a + r.tax * 12, 0),
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
    if (st.assets.isa && st.assets.isa.returnRate !== undefined) st.assets.isa.returnRate += d;
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

  /** 입력값의 단위 실수·비현실적 가정을 점검합니다. (계산은 하지 않음) */
  function analyzeInputs(state) {
    const out = [];
    const a = state.assets || {}, m = state.meta || {}, t = state.target || {}, tx = state.taxConfig || {};
    const on = (x) => x && x.enabled !== false;
    const add = (level, text) => out.push({ level, text });

    // 단위(백만원) 실수 가능성: 월 금액이 3,000만원 이상
    const monthly = [
      [a.earnedIncome, "monthlyGrossSalary", "근로소득 월 급여"],
      [a.nationalPension, "monthlyAmountAtStart", "국민연금 월 수령액"],
      [a.privatePension, "monthlyPayout", "개인연금 월 수령액"],
      [a.housing, "rmManualMonthly", "주택연금 월 수령액"],
    ];
    monthly.forEach(([o, k, name]) => {
      if (on(o) && o[k] >= 30) add("warn", `${name}이(가) ${o[k]}백만원(${o[k] * 100}만원)입니다. 단위가 백만원임을 확인하세요(예: 150만원 = 1.5).`);
    });
    if (t.enabled && t.netMonthly >= 30) add("warn", `목표 월 현금흐름이 ${t.netMonthly}백만원입니다. 단위(백만원)를 확인하세요.`);

    // 평가액이 지나치게 큼 (50억원 이상)
    [[a.dcPension, "currentBalance", "퇴직연금 DC"], [a.irp, "currentBalance", "IRP"], [a.pensionSavings, "currentBalance", "연금저축"],
     [a.stockPortfolio, "currentBalance", "주식 평가액"], [a.housing, "currentMarketPrice", "거주주택 시세"]].forEach(([o, k, name]) => {
      if (on(o) && o[k] >= 5000) add("warn", `${name}이(가) ${o[k]}백만원(${(o[k] / 100).toFixed(0)}억원)입니다. 단위(백만원)가 맞는지 확인하세요.`);
    });

    // ISA 설정 점검
    const ia = a.isa;
    if (on(ia) && ia.enabled) {
      if (ia.monthlyContrib * 12 > ia.annualLimit + 1e-9 && ia.monthlyContrib > 0) {
        add("info", `ISA 월 납입액(${ia.monthlyContrib}백만원)의 연 합계가 연 납입한도(${ia.annualLimit}백만원)를 넘어 초과분은 납입되지 않습니다.`);
      }
      if ((ia.transferRatio || 0) + (ia.withdrawRatio || 0) > 100) {
        add("info", "ISA 만기 자금의 연금저축 이전 비율과 현금 인출 비율의 합이 100%를 넘어 인출 비율이 줄어듭니다.");
      }
      if ((ia.transferRatio || 0) > 0 && !(a.pensionSavings && a.pensionSavings.enabled)) {
        add("warn", "ISA 만기 자금을 연금저축으로 이전하도록 설정했지만 연금저축 자산이 꺼져 있어 이전되지 않습니다. 연금저축을 켜세요.");
      }
      if (ia.currentBalance + ia.monthlyContrib > 0 && (ia.returnRate || 0) + (ia.dividendRate || 0) > 8) {
        add("warn", `ISA의 연 수익률 가정이 ${((ia.returnRate || 0) + (ia.dividendRate || 0)).toFixed(1)}%로 높습니다. 장기 평균으로는 낙관적일 수 있습니다.`);
      }
    }

    // 낙관적 수익률
    [[a.dcPension, "퇴직연금 DC"], [a.irp, "IRP"], [a.pensionSavings, "연금저축"], [a.privatePension, "개인연금"]].forEach(([o, name]) => {
      if (on(o) && o.currentBalance > 0 && (o.returnRate || 0) + (o.dividendRate || 0) > 8) {
        add("warn", `${name}의 연 수익률 가정이 ${((o.returnRate || 0) + (o.dividendRate || 0)).toFixed(1)}%로 높습니다. 장기 평균으로는 낙관적일 수 있습니다.`);
      }
    });
    const sp = a.stockPortfolio;
    if (on(sp) && sp.currentBalance > 0) {
      const tot = (sp.priceReturnRate || 0) + (sp.dividendRate || 0);
      if (tot > 10) add("warn", `주식의 연 총수익률 가정이 ${tot.toFixed(1)}%(주가 ${sp.priceReturnRate}% + 배당 ${sp.dividendRate}%)로 높습니다.`);
      if (sp.dividendRate > 7) add("info", `배당수익률 ${sp.dividendRate}%는 매우 높은 편입니다. 배당 삭감 위험을 고려하세요.`);
    }
    if (on(a.housing) && a.housing.priceGrowthRate > (m.inflationRate || 0) + 3) {
      add("info", `주택가격 상승률(${a.housing.priceGrowthRate}%)이 물가상승률보다 3%p 넘게 높습니다. 보수적으로 가정했는지 확인하세요.`);
    }

    // 물가·보험료율
    if (m.inflationRate === 0) add("info", "물가상승률이 0%입니다. 장기 계산에서는 구매력이 과대평가됩니다.");
    if (m.inflationRate > 5) add("info", `물가상승률이 ${m.inflationRate}%로 높습니다. 의도한 값인지 확인하세요.`);
    const TRr = global.SimulatorTaxRates;
    if (TRr && tx.nhisRate !== undefined) {
      const L = TRr.get(TRr.latest);
      if (tx.rateYear !== TRr.latest && (tx.nhisRate !== L.nhisRate || tx.nhisPointValue !== L.nhisPointValue || tx.ltciRateOfNhis !== L.ltciRateOfNhis)) {
        add("info", `보험료율이 ${TRr.latest}년 값(건보 ${L.nhisRate}%, 장기요양 ${L.ltciRateOfNhis}%)과 다릅니다. 저장 당시 요율을 쓰는 중이면 설정에서 '보험료율 기준 연도'를 ${TRr.latest}년으로 바꿔 최신 요율을 적용하세요.`);
      }
    }
    if (tx.nhisRate && (tx.nhisRate < 5 || tx.nhisRate > 9.5)) add("warn", `건강보험료율이 ${tx.nhisRate}%입니다. 최근 법정 요율(약 7%대)과 크게 다릅니다.`);

    // 개시 나이가 현재 나이보다 이전
    const cur = m.currentAge;
    [[a.nationalPension, "국민연금"], [a.privatePension, "개인연금"], [a.stockPortfolio, "주식 배당"]].forEach(([o, name]) => {
      if (on(o) && o.startAge < cur) add("info", `${name} 개시 나이(${o.startAge}세)가 현재 나이(${cur}세)보다 이릅니다. 이미 받고 있는 경우가 아니라면 확인하세요.`);
    });
    if (on(a.nationalPension) && (a.nationalPension.startAge < 60 || a.nationalPension.startAge > 70)) {
      add("warn", `국민연금 개시 나이 ${a.nationalPension.startAge}세는 수령 가능 범위(60~70세) 밖입니다.`);
    }
    if (on(a.housing) && a.housing.useReverseMortgage && a.housing.rmStartAge < 55) {
      add("warn", "주택연금은 만 55세부터 가입할 수 있습니다.");
    }
    if (m.endAge <= m.currentAge) add("warn", "종료 나이가 현재 나이보다 크지 않습니다.");
    return out;
  }

  /** 계좌형 연금(DC·IRP·연금저축)의 인출 방식만 바꿔 같은 조건에서 비교합니다. 세부 값(수령 기간·금액·비율)은 입력값을 그대로 씁니다. */
  function runWithdrawalStrategies(E, state) {
    const keys = ["dcPension", "irp", "pensionSavings"].filter((k) => state.assets[k] && state.assets[k].enabled !== false && state.assets[k].currentBalance > 0);
    const defs = [
      { mode: null, label: "현재 설정", note: "입력한 인출 방식 그대로" },
      { mode: "period", label: "기간 분할", note: "입력한 수령 기간 동안 균등 인출" },
      { mode: "fixed", label: "월 정액", note: "입력한 월 인출액을 소진 시까지" },
      { mode: "rate", label: "연 정률", note: "입력한 비율을 매년 잔액에서 인출" },
      { mode: "income_only", label: "수익만 인출", note: "원금 보존, 운용·배당수익만" },
    ];
    return {
      applicable: keys.length > 0 && !(state.target && state.target.enabled),
      accounts: keys,
      rows: defs.map((d) => {
        const st = clone(state);
        if (d.mode) keys.forEach((k) => { st.assets[k].withdrawalMode = d.mode; });
        const r = summarizeScenario(E, st);
        const rec = r.sim.yearlyRecords;
        const a85 = rec.find((x) => x.age === 85) || rec[rec.length - 1];
        return Object.assign({ label: d.label, note: d.note, mode: d.mode, age85Net: a85 ? a85.netCif : 0 }, r);
      }),
    };
  }

  // ---- 몬테카를로 ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNormal(rng) {
    return function () {
      let u = 0, v = 0;
      while (u === 0) u = rng();
      v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
  }
  function pct(sorted, q) {
    if (!sorted.length) return 0;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  /**
   * 연도별 수익률을 무작위로 흔들어 N번 돌립니다(주식형 자산에 연 변동성 sigma 적용, 평균은 입력 수익률 유지).
   * 성공 = 종료 나이 전에 금융자산이 소진되지 않고, 목표 CIF를 켰다면 미달 연도가 없음.
   * opts: { n=500, sigma=0.15, seed=20260101, chunk=20, onProgress(done,n) } — 비동기로 UI를 양보하며 실행.
   */
  async function runMonteCarlo(E, state, opts) {
    opts = opts || {};
    const n = opts.n || 500, sigma = opts.sigma === undefined ? 0.15 : opts.sigma, chunk = opts.chunk || 20;
    const rng = makeNormal(mulberry32(opts.seed === undefined ? 20260101 : opts.seed));
    const base0 = clone(state);
    base0.meta.valueMode = "real";
    const years = Math.max(1, (base0.meta.endAge || 95) - (base0.meta.currentAge || 52) + 1);
    const finals = [], depAges = [];
    let success = 0;
    let ages = null;
    const balByYear = [], netByYear = [];
    for (let i = 0; i < n; i++) {
      const shocks = [];
      for (let y = 0; y < years; y++) shocks.push(Math.max(-0.6, sigma * rng()));
      const st = clone(base0);
      const sim = E.runSimulation(st, { lite: true, shocks });
      const rec = sim.yearlyRecords;
      if (!ages) { ages = rec.map((r) => r.age); rec.forEach(() => { balByYear.push([]); netByYear.push([]); }); }
      const endAge = rec[rec.length - 1].age;
      const dep = rec.find((r, k) => k > 0 && r.balances.financialTotal < 0.05 && rec[k - 1].balances.financialTotal >= 0.05);
      const depleted = !!(dep && dep.age < endAge);
      const shortfall = sim.summary.targetEnabled && sim.summary.shortfallYears > 0;
      if (!depleted && !shortfall) success++;
      if (depleted) depAges.push(dep.age);
      finals.push(sim.summary.finalFinancialBalance);
      rec.forEach((r, k) => { balByYear[k].push(r.balances.financialTotal); netByYear[k].push(r.netCif); });
      if ((i + 1) % chunk === 0 && opts.onProgress) {
        opts.onProgress(i + 1, n);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    finals.sort((a, b) => a - b);
    depAges.sort((a, b) => a - b);
    const band = (arr) => arr.map((v) => { const s = v.slice().sort((a, b) => a - b); return { p10: pct(s, 0.1), p50: pct(s, 0.5), p90: pct(s, 0.9) }; });
    return {
      n, sigma,
      successRate: success / n,
      finalFinancial: { p10: pct(finals, 0.1), p50: pct(finals, 0.5), p90: pct(finals, 0.9) },
      depletionCount: depAges.length,
      medianDepletionAge: depAges.length ? pct(depAges, 0.5) : null,
      ages,
      balanceBand: band(balByYear),
      netBand: band(netByYear),
    };
  }

  // ---- 목표 역산 ----
  /** 목표 CIF를 켜고 금융자산을 '자동조절'로 돌려 목표를 지킬 수 있는지 시험할 상태를 만듭니다. */
  function prepReverse(E, state, targetMonthly, assetScale) {
    const st = clone(state);
    st.meta.valueMode = "nominal"; // 목표 달성 판정은 엔진 내부 기준(명목)에서 하고, 금액 표시는 목표 기준(현재가치/명목)을 따름
    st.target.enabled = true;
    if (targetMonthly !== undefined) st.target.netMonthly = targetMonthly;
    st.target.priorityOrder = E.normalizeOrder(st.target.priorityOrder);
    const keys = E.AUTO_CAPABLE.filter((k) => st.assets[k] && st.assets[k].enabled);
    keys.forEach((k) => {
      st.assets[k].cifMode = "auto";
      if (assetScale !== undefined && st.assets[k].currentBalance !== undefined) st.assets[k].currentBalance *= assetScale;
    });
    return { st, keys };
  }

  function feasible(E, state, targetMonthly, assetScale) {
    const { st } = prepReverse(E, state, targetMonthly, assetScale);
    const sm = E.runSimulation(st, { lite: true }).summary;
    return sm.shortfallYears === 0;
  }

  /**
   * 목표 역산: ① 지금 자산으로 지속 가능한 최대 월 현금흐름, ② 입력한 목표를 지키는 데 필요한 금융자산.
   * 목표 기준(세후/세전, 현재가치/명목)·시작 나이·우선순위는 state.target을 따릅니다.
   * 목표 달성 = 목표 시작 나이부터 종료 나이까지 매년 목표 현금흐름을 채움(미달 연도 0).
   */
  async function solveReverse(E, state, targetMonthly, onProgress) {
    const tick = async (p) => { if (onProgress) onProgress(p); await new Promise((r) => setTimeout(r, 0)); };
    const tgt = targetMonthly === undefined ? state.target.netMonthly : targetMonthly;
    const { keys } = prepReverse(E, state, tgt);
    if (!keys.length) return { ok: false, reason: "자동조절에 쓸 금융자산(DC·IRP·연금저축·개인연금·주식)이 켜져 있지 않습니다." };

    // ① 최대 지속 가능 월 현금흐름
    let lo = 0, hi = Math.max(5, tgt * 2, 10);
    while (feasible(E, state, hi) && hi < 400) { lo = hi; hi *= 2; }
    let maxSustainable;
    if (feasible(E, state, hi)) maxSustainable = hi; // 탐색 상한 초과
    else {
      for (let i = 0; i < 13; i++) {
        const mid = (lo + hi) / 2;
        if (feasible(E, state, mid)) lo = mid; else hi = mid;
        if (i % 3 === 2) await tick(0.05 + (i / 13) * 0.45);
      }
      maxSustainable = lo;
    }

    await tick(0.5);
    // ② 필요한 금융자산 배율
    const scaled = keys.filter((k) => state.assets[k].currentBalance !== undefined);
    const currentFinancial = scaled.reduce((a, k) => a + (state.assets[k].currentBalance || 0), 0);
    let requiredScale = null, note = "";
    if (feasible(E, state, tgt, 0)) { requiredScale = 0; note = "국민연금·근로소득 등 다른 소득만으로 목표가 충족됩니다."; }
    else if (!currentFinancial) { note = "스케일할 금융자산 평가액이 없습니다."; }
    else {
      let a = 0, b = 1, found = feasible(E, state, tgt, b);
      while (!found && b < 64) { a = b; b *= 2; found = feasible(E, state, tgt, b); }
      if (found) {
        for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (feasible(E, state, tgt, m)) b = m; else a = m; if (i % 3 === 2) await tick(0.5 + (i / 12) * 0.5); }
        requiredScale = b;
      } else note = "금융자산을 64배로 늘려도 목표를 채우지 못합니다(목표 시작 나이 전 소득 공백 등).";
    }
    return {
      ok: true, target: tgt, startAge: state.target.startAge, endAge: state.meta.endAge,
      measure: state.target.measure, basis: state.target.basis,
      maxSustainable, currentFinancial, requiredScale,
      requiredFinancial: requiredScale === null ? null : requiredScale * currentFinancial,
      gap: requiredScale === null ? null : requiredScale * currentFinancial - currentFinancial,
      accounts: keys, note,
    };
  }

  // ---- 세금 기준선 점검 (금융소득 2,000만원 · 배당 1,000만원 · 사적연금 1,500만원) ----
  /** 연령별 값 배열에서 기준선을 넘는/근접한 구간을 찾아 문장 조각으로 만듭니다. */
  function lineHits(rec, valueOf, limit, nearRatio) {
    const over = rec.filter((r) => valueOf(r) > limit + 1e-9);
    const near = nearRatio ? rec.filter((r) => valueOf(r) > limit * nearRatio && valueOf(r) <= limit + 1e-9) : [];
    const peak = (arr) => Math.max(0, ...arr.map(valueOf));
    return { over, near, overPeak: peak(over), nearPeak: peak(near) };
  }
  const manwon = (v) => Math.round(v * 100).toLocaleString("ko-KR") + "만원";

  /**
   * 법정 기준선을 넘거나 근접하는 해를 찾습니다. 기준선은 물가에 연동되지 않는 명목 금액이므로 명목 기준으로 계산합니다.
   * - 배당소득(금융소득) 연 2,000만원: 초과 시 종합과세 대상
   * - 배당소득 연 1,000만원: 초과 시 지역건보료 소득에 전액 반영
   * - 사적연금 과세 대상 수령액 연 1,500만원: 초과 시 저율 분리과세 불가(종합과세 또는 16.5% 분리과세)
   */
  function analyzeThresholds(E, state) {
    const st = clone(state);
    st.meta.valueMode = "nominal";
    const rec = E.runSimulation(st).yearlyRecords;
    const out = [];
    const div = (r) => r.stockDiv * 12;
    const pen = (r) => r.privateTaxableAnnual || 0;

    const f2 = lineHits(rec, div, 20, 0.9);
    if (f2.over.length) {
      out.push({ level: "warn", text: `배당소득이 연 2,000만원을 넘는 해: ${fmtAges(f2.over.map((r) => r.age))}(최대 약 ${manwon(f2.overPeak)}). 금융소득 종합과세 대상이 되면 세율이 높아지고, ISA 등 세제혜택 상품 신규 가입이 3년간 제한되며 건강보험 피부양자 자격을 잃을 수 있습니다. 배당 규모나 개시 시점을 조절하거나 ISA·연금계좌로 나누는 방법을 검토하세요(기준은 명목 금액).` });
    } else if (f2.near.length) {
      out.push({ level: "info", text: `배당소득이 연 2,000만원 기준선에 근접합니다: ${fmtAges(f2.near.map((r) => r.age))}(최대 약 ${manwon(f2.nearPeak)}). 조금만 늘어도 종합과세 대상이 될 수 있습니다.` });
    }
    const f1 = lineHits(rec, div, 10, 0);
    const f1only = f1.over.filter((r) => div(r) <= 20 + 1e-9);
    if (f1only.length) {
      out.push({ level: "info", text: `배당소득이 연 1,000만원을 넘는 해: ${fmtAges(f1only.map((r) => r.age))}. 지역가입자라면 이 경우 배당 전액이 건강보험료 소득에 반영됩니다.` });
    }
    const p15 = lineHits(rec, pen, 15, 0.9);
    if (p15.over.length) {
      const rules = Array.from(new Set(p15.over.map((r) => r.chosenTaxRule).filter(Boolean)));
      out.push({ level: "warn", text: `사적연금 과세 대상 수령액이 연 1,500만원을 넘는 해: ${fmtAges(p15.over.map((r) => r.age))}(최대 약 ${manwon(p15.overPeak)}). 저율(3.3~5.5%) 분리과세 한도를 넘으면 종합과세 또는 16.5% 분리과세 중 하나를 택해야 합니다${rules.length ? ` (시뮬레이션 선택: ${rules.join(" / ")})` : ""}. 수령 기간을 늘리거나 세액공제를 받지 않은 원금부터 인출하는 방법을 검토하세요.` });
    } else if (p15.near.length) {
      out.push({ level: "info", text: `사적연금 과세 대상 수령액이 연 1,500만원 기준선에 근접합니다: ${fmtAges(p15.near.map((r) => r.age))}(최대 약 ${manwon(p15.nearPeak)}). 넘으면 저율 분리과세가 적용되지 않습니다.` });
    }
    return out;
  }

  global.SimulatorAnalysis = { analyzeThresholds, solveReverse, runMonteCarlo, runWithdrawalStrategies, analyzeInputs, analyzeWarnings, summarizeScenario, runStress, runSensitivity };
})(typeof window !== "undefined" ? window : globalThis);
