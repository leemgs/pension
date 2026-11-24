/* 연도별 보험료율·기준값 (단위: %, 원, 백만원).
 * 확인 방법: 국민건강보험공단·보건복지부·국민연금공단 발표를 보도자료와 검색으로 대조했습니다.
 * 소득세 세율·공제 구간(2023년 이후 동일)은 engine.js에 있고, 여기에는 매년 바뀌는 값만 둡니다.
 * 확정 고시는 반드시 공식 사이트에서 다시 확인하세요. checked는 마지막 대조 시점입니다. */
(function (global) {
  "use strict";
  var YEARS = {
    2024: { nhisRate: 7.09, ltciRateOfNhis: 12.95, nhisPointValue: 208.4, npEmployeeRate: 4.5, npMonthlyCap: 6.17,
      note: "건보료율 7.09%, 장기요양 12.95%, 재산 점수당 208.4원, 국민연금 근로자 4.5%(기준소득월액 상한 617만원)" },
    2025: { nhisRate: 7.09, ltciRateOfNhis: 12.95, nhisPointValue: 208.4, npEmployeeRate: 4.5, npMonthlyCap: 6.37,
      note: "건보료율 7.09%, 장기요양 12.95%, 재산 점수당 208.4원, 국민연금 근로자 4.5%(상한 637만원, 2025.7~)" },
    2026: { nhisRate: 7.19, ltciRateOfNhis: 13.14, nhisPointValue: 211.5, npEmployeeRate: 4.75, npMonthlyCap: 6.59,
      note: "건보료율 7.19%, 장기요양 13.14%(소득 대비 0.9448%), 재산 점수당 211.5원, 국민연금 근로자 4.75%(보험료율 9.5%, 상한 659만원, 2026.7~)" },
    2027: { nhisRate: 7.19, ltciRateOfNhis: 13.14, nhisPointValue: 211.5, npEmployeeRate: 5.0, npMonthlyCap: 6.59, partial: true,
      note: "건보료율 7.19%·점수당 211.5원 동결 보도, 국민연금 보험료율 10%(근로자 5.0%)는 법정 인상 일정. 장기요양률·연금 상한은 2026년 값을 가정(미확정)" },
  };
  var LATEST = 2026; // 기본 적용 연도
  global.SimulatorTaxRates = {
    years: YEARS,
    latest: LATEST,
    list: function () { return Object.keys(YEARS).map(Number).sort(function (a, b) { return b - a; }); },
    /** 해당 연도의 값(복사본). 없으면 null. */
    get: function (y) {
      var r = YEARS[y];
      if (!r) return null;
      return { nhisRate: r.nhisRate, ltciRateOfNhis: r.ltciRateOfNhis, nhisPointValue: r.nhisPointValue, npEmployeeRate: r.npEmployeeRate, npMonthlyCap: r.npMonthlyCap };
    },
    note: function (y) { return YEARS[y] ? YEARS[y].note : ""; },
    isPartial: function (y) { return !!(YEARS[y] && YEARS[y].partial); },
    /** 과거(2024·2025) 저장본의 기본 요율. rateYear가 없던 상태를 그대로 재현하는 데 사용합니다. */
    legacy: { nhisRate: 7.09, ltciRateOfNhis: 12.95, nhisPointValue: 208.4, npEmployeeRate: 4.5, npMonthlyCap: 6.17 },
  };
})(typeof window !== "undefined" ? window : globalThis);
