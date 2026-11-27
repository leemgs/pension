/* 가이드 사례: 학습 자료(연금·투자 가이드)의 예시를 시뮬레이터 상태로 재현합니다.
 * ?case=ID 로 시뮬레이터를, compare.html?cases=ID1,ID2 로 비교 화면을 바로 열 수 있습니다. */
(function (global) {
  "use strict";

  /** 연금저축 2억원을 매년 1,000만원씩 20년 수령 (가이드 3-4). 다른 소득·자산은 모두 끄고 수익률 0%, 물가 0%로 둡니다. */
  function pensionStart(E, startAge, title) {
    const st = E.createDefaultState();
    st.meta.title = title;
    st.meta.currentAge = 55;
    st.meta.endAge = 90;
    st.meta.inflationRate = 0;
    st.meta.valueMode = "nominal";
    st.target.enabled = false;
    st.target.startAge = startAge;
    Object.keys(st.assets).forEach((k) => { st.assets[k].enabled = false; });
    const ps = st.assets.pensionSavings;
    Object.assign(ps, {
      enabled: true, currentBalance: 200, growthReturnRate: 0, dividendReturnRate: 0, returnRate: 0, dividendRate: 0,
      monthlyContrib: 0, contribEndAge: 0, withdrawalMode: "period", payoutYears: 20, nonTaxablePrincipalRatio: 0, capAnnualLimit: true,
    });
    return st;
  }

  /** ISA에 매년 2,000만원씩 3년 납입 → 만기 6,000만원을 연금저축으로 이전 (가이드: 이전액의 10%, 최대 300만원 추가 세액공제) */
  function isaTransfer(E) {
    const st = E.createDefaultState();
    st.meta.title = "가이드 사례: ISA 3년 납입 후 연금저축으로 이전";
    st.meta.currentAge = 50;
    st.meta.endAge = 60;
    st.meta.inflationRate = 0;
    st.meta.valueMode = "nominal";
    st.target.enabled = false;
    st.target.startAge = 65;
    Object.keys(st.assets).forEach((k) => { st.assets[k].enabled = false; });
    Object.assign(st.assets.earnedIncome, { enabled: true, startAge: 50, workYears: 10, monthlyGrossSalary: 5 });
    Object.assign(st.assets.pensionSavings, { enabled: true, currentBalance: 0, monthlyContrib: 0, growthReturnRate: 0, dividendReturnRate: 0, returnRate: 0, dividendRate: 0, contribEndAge: 0 });
    Object.assign(st.assets.isa, {
      enabled: true, currentBalance: 0, monthlyContrib: 1.667, contribEndAge: 53, annualLimit: 20, totalLimit: 100,
      returnRate: 0, dividendRate: 0, maturityYears: 3, termYears: 3, exemptLimit: 2, transferRatio: 100, withdrawRatio: 0,
    });
    return st;
  }

  /** 국민연금만 있는 상태: 개시 나이별 월 수령액 비교 (가이드 3-5: 조기 −6%/년(최대 −30%), 연기 +7.2%/년(최대 +36%)) */
  function npStart(E, startAge, title) {
    const st = E.createDefaultState();
    st.meta.title = title;
    st.meta.currentAge = 60;
    st.meta.endAge = 90;
    st.meta.inflationRate = 0;
    st.meta.valueMode = "nominal";
    st.target.enabled = false;
    Object.keys(st.assets).forEach((k) => { st.assets[k].enabled = false; });
    Object.assign(st.assets.nationalPension, {
      enabled: true, startAge, baseAge: 65, applyDeferralRule: true, monthlyAmountAtStart: 1.65,
      linkToInflation: false, customGrowthRate: 0, taxableRatio: 90,
    });
    return st;
  }

  /** 연금저축 3억원의 운용·배당수익만 인출(원금 보존) — 가이드 3-6 월배당 포트폴리오 */
  function incomeOnly(E, yieldPct, capLimit, title) {
    const st = E.createDefaultState();
    st.meta.title = title;
    st.meta.currentAge = 60;
    st.meta.endAge = 90;
    st.meta.inflationRate = 0;
    st.meta.valueMode = "nominal";
    st.target.enabled = false;
    st.target.startAge = 60;
    Object.keys(st.assets).forEach((k) => { st.assets[k].enabled = false; });
    Object.assign(st.assets.pensionSavings, {
      enabled: true, currentBalance: 300, growthRatio: 0, dividendRatio: 100, growthReturnRate: 0, dividendReturnRate: yieldPct,
      returnRate: 0, dividendRate: yieldPct, monthlyContrib: 0, contribEndAge: 0, withdrawalMode: "income_only",
      nonTaxablePrincipalRatio: 0, capAnnualLimit: capLimit,
    });
    st.assets.irp.capAnnualLimit = capLimit; // 연금저축·IRP 합산 한도 플래그가 하나라도 켜져 있으면 합산 한도가 적용됨
    return st;
  }

  const firstActive = (sim, key) => (sim.yearlyRecords.find((r) => r[key] > 1e-9) || {})[key] || 0;
  const npCheck = (ratio, label) => (sim) => {
    const m = firstActive(sim, "np");
    return { text: `월 ${Math.round(m * 100)}만원 (65세 기준 165만원 대비 ${label})`, ok: Math.abs(m - 1.65 * ratio) < 0.0005 };
  };
  const incomeCheck = (monthly, note) => (sim) => {
    const m = firstActive(sim, "ps");
    const annual = m * 12;
    return { text: `월 분배금 ${Math.round(m * 100)}만원 (연 ${Math.round(annual * 100).toLocaleString("ko-KR")}만원${note ? ", " + note : ""})`, ok: Math.abs(m - monthly) / monthly < 0.05 }; // 가이드의 '약' 금액: 월복리 계산과의 차이 5% 이내
  };

  const LIST = [
    {
      id: "pension-55",
      title: "연금저축 2억 · 55세부터 20년 수령",
      desc: "가이드 3-4: 2억원을 매년 1,000만원씩 55세부터 20년간 받는 경우. 수익률·물가 0%, 전액 세액공제 받은 원금으로 가정.",
      guide: "learn-guide.html#s3-4",
      compare: "pension-55,pension-65",
      expectTotalTax: 10.45, // 백만원 (가이드: 1,045만원)
      build: (E) => pensionStart(E, 55, "가이드 사례: 연금저축 2억 · 55세부터 수령"),
    },
    {
      id: "pension-65",
      title: "연금저축 2억 · 65세부터 20년 수령",
      desc: "가이드 3-4: 같은 2억원을 65세부터 받으면 낮은 세율(4.4%·3.3%) 구간을 더 많이 써서 세금이 줄어듭니다.",
      guide: "learn-guide.html#s3-4",
      compare: "pension-55,pension-65",
      expectTotalTax: 8.8, // 백만원 (가이드: 880만원)
      build: (E) => pensionStart(E, 65, "가이드 사례: 연금저축 2억 · 65세부터 수령"),
    },
    {
      id: "isa-transfer",
      title: "ISA 3년 납입 후 연금저축으로 이전",
      desc: "가이드 1-4: ISA에 매년 2,000만원씩 3년 납입해 만기 6,000만원을 60일 내 연금계좌로 이전하면 이전액의 10%인 600만원이지만 최대 300만원까지 추가 세액공제됩니다. 수익률 0%로 가정.",
      guide: "learn-guide.html#s1-4",
      build: (E) => isaTransfer(E),
      /** 시뮬레이션 결과가 가이드 설명과 맞는지 확인해 배너에 표시 */
      check: (sim) => {
        const tr = sim.yearlyRecords.reduce((a, r) => a + r.isaTransfer, 0);
        const cr = sim.yearlyRecords.reduce((a, r) => a + r.isaCredit, 0);
        return {
          text: `연금저축 이전 ${Math.round(tr * 100)}만원 → 추가 세액공제 ${Math.round(cr * 100)}만원 (가이드: 이전액 6,000만원, 공제 한도 300만원)`,
          ok: Math.abs(tr - 60) < 0.005 && Math.abs(cr - 3) < 0.005,
        };
      },
    },
    {
      id: "np-early",
      title: "국민연금 60세 조기수령 (−30%)",
      desc: "가이드 3-5: 기준 65세보다 5년 앞당겨 받으면 매년 6%씩 감액되어 최대 30% 줄어듭니다(기준 월 165만원 가정).",
      guide: "learn-guide.html#s3-5",
      compare: "np-early,np-normal,np-late",
      build: (E) => npStart(E, 60, "가이드 사례: 국민연금 60세 조기수령"),
      check: npCheck(0.7, "−30%"),
    },
    {
      id: "np-normal",
      title: "국민연금 65세 정상수령",
      desc: "가이드 3-5: 기준 개시 나이(65세)에 받는 경우. 기준 월 165만원 가정.",
      guide: "learn-guide.html#s3-5",
      compare: "np-early,np-normal,np-late",
      build: (E) => npStart(E, 65, "가이드 사례: 국민연금 65세 정상수령"),
      check: npCheck(1, "±0%"),
    },
    {
      id: "np-late",
      title: "국민연금 70세 연기수령 (+36%)",
      desc: "가이드 3-5: 5년 늦추면 매년 7.2%씩 늘어 최대 36% 증액됩니다. 연기 기간(65~69세)에는 소득이 필요합니다.",
      guide: "learn-guide.html#s3-5",
      compare: "np-early,np-normal,np-late",
      build: (E) => npStart(E, 70, "가이드 사례: 국민연금 70세 연기수령"),
      check: npCheck(1.36, "+36%"),
    },
    {
      id: "income-4",
      title: "월배당 포트폴리오 · 3억 × 4% (안정형)",
      desc: "가이드 3-6: 연금자산 3억원에서 원금은 지키고 배당수익만 인출(수익률 4%) → 월 약 100만원.",
      guide: "learn-guide.html#s3-6",
      compare: "income-4,income-8",
      build: (E) => incomeOnly(E, 4, true, "가이드 사례: 월배당 3억 × 4%"),
      check: incomeCheck(1.0, "연 1,500만원 이하"),
    },
    {
      id: "income-8",
      title: "월배당 포트폴리오 · 3억 × 8% (균형형)",
      desc: "가이드 3-6: 수익률 8%면 월 약 200만원이지만 연 2,400만원이라 연 1,500만원 한도를 넘어 종합과세·16.5% 분리과세를 택해야 합니다(위험 신호 참고).",
      guide: "learn-guide.html#s3-6",
      compare: "income-4,income-8",
      build: (E) => incomeOnly(E, 8, false, "가이드 사례: 월배당 3억 × 8%"),
      check: incomeCheck(2.0, "연 1,500만원 초과"),
    },
  ];

  global.SimulatorCases = {
    list: LIST,
    get: function (id) { return LIST.find((c) => c.id === id) || null; },
  };
})(typeof window !== "undefined" ? window : globalThis);
