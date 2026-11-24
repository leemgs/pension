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
  ];

  global.SimulatorCases = {
    list: LIST,
    get: function (id) { return LIST.find((c) => c.id === id) || null; },
  };
})(typeof window !== "undefined" ? window : globalThis);
