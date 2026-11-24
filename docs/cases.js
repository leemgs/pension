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

  const LIST = [
    {
      id: "pension-55",
      title: "연금저축 2억 · 55세부터 20년 수령",
      desc: "가이드 3-4: 2억원을 매년 1,000만원씩 55세부터 20년간 받는 경우. 수익률·물가 0%, 전액 세액공제 받은 원금으로 가정.",
      guide: "learn-guide.html#s3-4",
      expectTotalTax: 10.45, // 백만원 (가이드: 1,045만원)
      build: (E) => pensionStart(E, 55, "가이드 사례: 연금저축 2억 · 55세부터 수령"),
    },
    {
      id: "pension-65",
      title: "연금저축 2억 · 65세부터 20년 수령",
      desc: "가이드 3-4: 같은 2억원을 65세부터 받으면 낮은 세율(4.4%·3.3%) 구간을 더 많이 써서 세금이 줄어듭니다.",
      guide: "learn-guide.html#s3-4",
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
  ];

  global.SimulatorCases = {
    list: LIST,
    get: function (id) { return LIST.find((c) => c.id === id) || null; },
  };
})(typeof window !== "undefined" ? window : globalThis);
