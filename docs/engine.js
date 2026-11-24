// -*- coding: utf-8 -*-
/**
 * 노후 현금흐름(CIF) 및 한국 세법·지역건보료 정밀 시뮬레이션 엔진
 * 모든 금액 단위는 '백만원(1,000,000 원)' 기준입니다. (예: 1.5 = 150만원, 15.0 = 1,500만원, 100 = 1억원)
 */

(function (global) {
  "use strict";

  // 기본 초기 상태
  function createDefaultState() {
    return {
      meta: {
        title: "나의 기본 은퇴 현금흐름 플랜",
        currentAge: 52,
        endAge: 95,
        baseYear: 2026,
        inflationRate: 2.2, // 연 물가상승률 (%)
        valueMode: "nominal", // 'nominal'(명목가치) | 'real'(현재가치/실질구매력)
        chartInterval: "yearly", // 'yearly'(연단위 보기 - 월평균 CIF) | 'monthly'(월단위 상세 보기)
      },
      target: {
        enabled: false, // 목표 CIF 자동조절 모드
        netMonthly: 5.0, // 목표 월 현금흐름 (백만원)
        measure: "net", // 'net'(세후 실수령 기준) | 'gross'(세전 기준)
        basis: "real", // 'real'(현재가치 기준, 매년 물가만큼 증액) | 'nominal'(명목 고정)
        startAge: 60, // 목표 CIF 적용 시작 나이
        priorityOrder: ["stockPortfolio", "pensionSavings", "irp", "dcPension", "privatePension"],
        objective: "netWorth", // 최적화 목적: 'netWorth'(금융자산+주택순자산) | 'financial'(금융자산만)
      },
      taxConfig: {
        // 사적연금 1,500만원 초과 시 과세 방식: 'auto'(유리한 쪽 자동선택) | 'separate_165'(16.5% 분리과세 고정) | 'comprehensive'(종합과세 고정)
        privatePensionOver15MMode: "auto",
        hasSpouseDeduction: true, // 배우자 인적공제(150만원) 여부
        extraDependents: 0, // 추가 부양가족 수 (1인당 150만원)
        includePrivatePensionInNHIS: false, // 지역건보료 소득 산정 시 사적연금 포함 여부 (현행 실무는 공적연금 50%만 반영)
        includePropertyTaxInCost: true, // 거주주택 보유 재산세를 월간 발생비용에 포함할지 여부
        nhisRate: 7.09, // 건강보험료율 (%)
        ltciRateOfNhis: 12.95, // 노인장기요양보험료율 (건보료 대비 %)
      },
      assets: {
        // 0. 근로소득 (은퇴 전 또는 재취업 기간 급여 - 몇 년 동안 월 얼마)
        earnedIncome: {
          enabled: true,
          startAge: 52, // 근로 시작 나이
          workYears: 6, // 근로 기간 (몇 년 동안, 52~57세)
          monthlyGrossSalary: 5.0, // 세전 월 급여 (백만원, 500만원)
        },
        // 1. 국민연금
        nationalPension: {
          enabled: true,
          startAge: 65,
          baseAge: 65, // 기준 개시연령 (조기/연기 증감율 자동반영 기준)
          applyDeferralRule: true, // 기준연령 대비 조기(-6%/년) / 연기(+7.2%/년) 자동 반영 여부
          monthlyAmountAtStart: 1.65, // 개시 시점 예상 월 수령액 (현재가치 기준 백만원 = 165만원)
          linkToInflation: true, // 물가상승률 연동 여부
          customGrowthRate: 2.2, // 직접 지정 시 연 상승률 (%)
          taxableRatio: 90, // 과세대상 연금소득 비중 (%, 2002년 이후 납입분 비율)
        },
        // 2. 퇴직연금 DC
        dcPension: {
          enabled: true,
          currentBalance: 180.0, // 현재 평가액 (1억 8,000만원)
          contribEndAge: 58, // 은퇴(적립 종료) 나이
          monthlyContrib: 0.0, // 은퇴 전 월 납입액 (120만원)
          growthRatio: 60, // 성장형 자산 비중 (%)
          growthReturnRate: 5.0, // 성장형 자본수익률 (%)
          dividendRatio: 40, // 배당형 자산 비중 (%)
          dividendReturnRate: 3.5, // 배당형 배당수익률 (%)
          returnRate: 4.4, // 연평균 자본운용수익률 (%) (성장/배당 가중평균)
          dividendRate: 1.4, // 연평균 배당/이자수익률 (%)
          startAge: 60, // 연금 개시 나이
          withdrawalMode: "period", // 'period'(기간분할) | 'fixed'(월정액) | 'rate'(연정률) | 'income_only'(수익/배당만)
          payoutYears: 20, // 기간분할 수령 연수
          fixedMonthly: 1.2, // 월정액 인출 시 금액 (백만원)
          inflateFixed: false, // 월정액 물가연동 여부
          withdrawalRate: 5.0, // 연정률 인출 시 비율 (%)
          severancePrincipalRatio: 65,
          cifMode: "manual", // "manual"(직접 설정) | "auto"(목표 CIF 자동조절)
          effectiveSeveranceTaxRate: 5.5, // 원 퇴직소득세 실효세율 (%)
        },
        // 3. IRP (개인형 퇴직연금)
        irp: {
          enabled: true,
          currentBalance: 65.0, // 현재 평가액 (6,500만원)
          contribEndAge: 58,
          monthlyContrib: 0.0, // 월 추가납입
          returnRate: 4.2,
          dividendRate: 1.8,
          startAge: 60,
          withdrawalMode: "period",
          payoutYears: 20,
          fixedMonthly: 0.6,
          inflateFixed: false,
          withdrawalRate: 5.0,
          capAnnualLimit: true, // 연 1,500만원 절세 한도 적용 여부
          maxAnnualPayout: 15.0, // 연간 최대 수령 한도 (백만원, 1,500만원)
          severancePrincipalRatio: 40,
          cifMode: "manual",
          effectiveSeveranceTaxRate: 5.5,
        },
        // 4. 연금저축 (연금저축펀드/신탁/보험)
        pensionSavings: {
          enabled: true,
          currentBalance: 85.0, // 현재 평가액 (8,500만원)
          contribEndAge: 58,
          monthlyContrib: 0.0, // 월 납입
          growthRatio: 60, // 성장형 자산 비중 (%)
          growthReturnRate: 5.0, // 성장형 자본수익률 (%)
          dividendRatio: 40, // 배당형 자산 비중 (%)
          dividendReturnRate: 3.5, // 배당형 배당수익률 (%)
          returnRate: 4.4, // 성장/배당 가중평균
          dividendRate: 1.4,
          startAge: 60,
          withdrawalMode: "period",
          payoutYears: 25,
          fixedMonthly: 0.7,
          inflateFixed: false,
          withdrawalRate: 5.0,
          capAnnualLimit: true, // 연 1,500만원 절세 한도 적용 여부
          maxAnnualPayout: 15.0, // 연간 최대 수령 한도 (백만원, 1,500만원)
          nonTaxablePrincipalRatio: 10,
          cifMode: "manual",
        },
        // 5. 개인연금 (비과세 연금보험 등 - 몇 년 동안 월 얼마)
        privatePension: {
          enabled: true,
          startAge: 56, // 수령 개시 나이
          payoutYears: 10, // 몇 년 동안 (수령 기간)
          monthlyPayout: 1.0, // 월 얼마 (월 수령액, 백만원)
          currentBalance: 0.0,
          contribEndAge: 56,
          monthlyContrib: 0.0,
          returnRate: 3.5,
          dividendRate: 0.0,
          withdrawalMode: "period",
          fixedMonthly: 1.0,
          inflateFixed: false,
          withdrawalRate: 4.5,
          isTaxFree: true,
          cifMode: "manual",
        },
        // 6. 주식투자액 (국내/해외 주식 및 배당 ETF)
        stockPortfolio: {
          enabled: true,
          currentBalance: 250.0, // 현재 주식 평가액 (2억 5,000만원)
          currentPrincipalRatio: 75, // 현재 평가액 중 투자원금 비중 (%)
          contribEndAge: 58,
          monthlyContrib: 0.0, // 은퇴 전 월 추가 투자액 (150만원)
          priceReturnRate: 4.0, // 연평균 주가상승률(자본수익률, %)
          dividendRate: 3.8, // 연평균 세전 배당수익률 (%)
          startAge: 60, // 현금흐름(배당 수령 및 인출) 개시 나이 (개시 전에는 세후 배당금 재투자)
          principalWithdrawalMode: "none", // 'none'(배당만 수령) | 'fixed'(매월 정액 지분 매도) | 'rate'(매년 잔액 일정비율 매도)
          fixedMonthlySell: 0.5, // 월 정액 지분 매도액 (백만원)
          sellRate: 3.0, // 연 정률 지분 매도 비율 (%)
          foreignStockRatio: 40,
          cifMode: "manual", // "manual"(직접 설정) | "auto"(목표 CIF 자동조절) // 해외주식 비중 (%, 매도차익 250만원 공제 후 22% 양도세 반영용)
        },
        // 7. 거주주택 (주택연금화 옵션)
        housing: {
          enabled: true,
          currentMarketPrice: 850.0, // 현재 주택 시세 (8억 5,000만원)
          officialPriceRatio: 69.0, // 시세 대비 공시가격 비율 (%)
          priceGrowthRate: 2.0, // 주택가격 연평균 상승률 (%)
          useReverseMortgage: true, // 주택연금(역모기지) 가입 여부
          rmStartAge: 70, // 주택연금 개시 나이 (55세 이상)
          rmCalcMode: "auto", // 'auto'(주금공 연령·주택가격 지급률표 자동계산) | 'manual'(직접 입력)
          rmManualMonthly: 1.8, // 직접 입력 시 월 수령액 (백만원)
          rmLoanRate: 4.5, // 주택연금 대출잔액 누적 금리+연보증료 (%/년)
          rmInitialFeeRate: 1.5, // 가입 시 초기보증료 (주택가격 대비 %)
        },
      },
    };
  }

  // 기본 제공 추천 프리셋 샘플 (사용자가 바로 비교해볼 수 있는 시나리오)
  function getSamplePresets() {
    const standard = createDefaultState();

    const dividendFocus = createDefaultState();
    dividendFocus.meta.title = "배당·사적연금 중심 조기은퇴 플랜 (56세 은퇴)";
    dividendFocus.assets.dcPension.contribEndAge = 56;
    dividendFocus.assets.dcPension.startAge = 56;
    dividendFocus.assets.irp.contribEndAge = 56;
    dividendFocus.assets.irp.startAge = 56;
    dividendFocus.assets.pensionSavings.contribEndAge = 56;
    dividendFocus.assets.pensionSavings.startAge = 56;
    dividendFocus.assets.stockPortfolio.currentBalance = 400.0;
    dividendFocus.assets.stockPortfolio.dividendRate = 4.8;
    dividendFocus.assets.stockPortfolio.startAge = 56;
    dividendFocus.assets.housing.useReverseMortgage = false;

    const reverseMortgageFocus = createDefaultState();
    reverseMortgageFocus.meta.title = "국민연금 연기 + 주택연금 극대화 플랜";
    reverseMortgageFocus.assets.nationalPension.startAge = 68;
    reverseMortgageFocus.assets.housing.useReverseMortgage = true;
    reverseMortgageFocus.assets.housing.rmStartAge = 65;
    reverseMortgageFocus.assets.stockPortfolio.principalWithdrawalMode = "rate";
    reverseMortgageFocus.assets.stockPortfolio.sellRate = 2.5;

    return [
      {
        name: "1. 표준 균형 은퇴 플랜 (기본)",
        description: "60세 사적연금·주식배당 개시 → 65세 국민연금 → 70세 주택연금 단계별 파이프라인",
        updatedAt: "2026-11-13T20:00:00",
        state: standard,
      },
      {
        name: "2. 배당·연금 조기은퇴 플랜 (56세)",
        description: "56세 조기은퇴 후 고배당 포트폴리오와 연금저축/IRP를 즉시 개시하는 시나리오",
        updatedAt: "2026-11-13T20:00:00",
        state: dividendFocus,
      },
      {
        name: "3. 연기연금 + 주택연금 극대화 플랜",
        description: "국민연금을 68세로 연기(+21.6% 증액)하고 65세부터 주택연금(비과세)을 적극 활용하는 절세 플랜",
        updatedAt: "2026-11-13T20:00:00",
        state: reverseMortgageFocus,
      },
    ];
  }

  /**
   * 한국주택금융공사(HF) 일반주택 종신지급방식(정액형) 연령별 월지급률 근사 테이블
   * (주택가격 1억원당 월 지급액(백만원 단위): 예: 60세 = 0.195 (19.5만원/1억), 70세 = 0.296 (29.6만원/1억), 80세 = 0.462 (46.2만원/1억))
   */
  const HF_RM_FACTOR_PER_100M = {
    55: 0.152,
    60: 0.195,
    65: 0.240,
    70: 0.298,
    75: 0.372,
    80: 0.468,
    85: 0.585,
    90: 0.720,
  };

  function estimateReverseMortgageMonthly(age, housePriceAtStart) {
    const clampedAge = Math.max(55, Math.min(90, age));
    const ages = [55, 60, 65, 70, 75, 80, 85, 90];
    let lower = 55;
    let upper = 90;
    for (let i = 0; i < ages.length - 1; i++) {
      if (clampedAge >= ages[i] && clampedAge <= ages[i + 1]) {
        lower = ages[i];
        upper = ages[i + 1];
        break;
      }
    }
    const ratio = upper === lower ? 0 : (clampedAge - lower) / (upper - lower);
    const factor =
      HF_RM_FACTOR_PER_100M[lower] +
      ratio * (HF_RM_FACTOR_PER_100M[upper] - HF_RM_FACTOR_PER_100M[lower]);

    // 주금공 산정 시 총 대출한도(시세 약 12억 상한 기준 반영)
    const effectiveHousePrice = Math.min(housePriceAtStart, 1200.0);
    return (effectiveHousePrice / 100.0) * factor;
  }

  /**
   * 연금소득공제 계산 (단위: 백만원)
   * - 350만원(3.5) 이하: 전액
   * - 350~700만원(7.0): 350만 + 초과분 40%
   * - 700~1400만원(14.0): 490만 + 초과분 20%
   * - 1400만원 초과: 630만 + 초과분 10% (최대 900만원(9.0) 한도)
   */
  function calcPensionIncomeDeduction(grossPensionIncome) {
    if (grossPensionIncome <= 0) return 0;
    if (grossPensionIncome <= 3.5) return grossPensionIncome;
    if (grossPensionIncome <= 7.0) return 3.5 + (grossPensionIncome - 3.5) * 0.4;
    if (grossPensionIncome <= 14.0) return 4.9 + (grossPensionIncome - 7.0) * 0.2;
    return Math.min(9.0, 6.3 + (grossPensionIncome - 14.0) * 0.1);
  }

  /**
   * 종합소득세 기본세율 산출 (과세표준 단위: 백만원, 지방소득세 10% 별도 가산 전 국세 기준)
   * 2024~2026 현행 소득세 과세표준 구간:
   * - 14.0 이하: 6%
   * - 14.0 ~ 50.0: 15% (누진공제 1.26)
   * - 50.0 ~ 88.0: 24% (누진공제 5.76)
   * - 88.0 ~ 150.0: 35% (누진공제 15.44)
   * - 150.0 ~ 300.0: 38% (누진공제 19.94)
   * - 300.0 ~ 500.0: 40% (누진공제 25.94)
   * - 500.0 ~ 1000.0: 42% (누진공제 35.94)
   * - 1000.0 초과: 45% (누진공제 65.94)
   */
  function calcProgressiveNationalIncomeTax(taxBase) {
    if (taxBase <= 0) return 0;
    if (taxBase <= 14.0) return taxBase * 0.06;
    if (taxBase <= 50.0) return taxBase * 0.15 - 1.26;
    if (taxBase <= 88.0) return taxBase * 0.24 - 5.76;
    if (taxBase <= 150.0) return taxBase * 0.35 - 15.44;
    if (taxBase <= 300.0) return taxBase * 0.38 - 19.94;
    if (taxBase <= 500.0) return taxBase * 0.40 - 25.94;
    if (taxBase <= 1000.0) return taxBase * 0.42 - 35.94;
    return taxBase * 0.45 - 65.94;
  }

  /**
   * 소득세법 제47조 근로소득공제
   * 연간 총급여(annualGross, 백만원) 기준
   */
  function calcEarnedIncomeDeduction(annualGross) {
    if (annualGross <= 0) return 0;
    if (annualGross <= 5.0) return annualGross * 0.7;
    if (annualGross <= 15.0) return 3.5 + (annualGross - 5.0) * 0.4;
    if (annualGross <= 45.0) return 7.5 + (annualGross - 15.0) * 0.15;
    if (annualGross <= 100.0) return 12.0 + (annualGross - 45.0) * 0.05;
    return 14.75 + (annualGross - 100.0) * 0.02;
  }

  /**
   * 근로소득의 월 4대보험(근로자부담분) 및 근로소득세/지방소득세 산출
   * grossMonthly: 세전 월 급여 (백만원)
   */
  function calcEarnedIncomeMonthly(grossMonthly, personalDeduction = 1.5) {
    if (grossMonthly <= 0) {
      return {
        grossMonthly: 0,
        netMonthly: 0,
        fourMajorTotal: 0,
        taxMonthly: 0,
        pensionPart: 0,
        healthPart: 0,
        ltciPart: 0,
        employPart: 0,
        incomeTax: 0,
        localTax: 0,
      };
    }
    const annualGross = grossMonthly * 12.0;

    // 1) 4대보험 (근로자 부담분)
    // 국민연금: 4.5% (기준소득월액 상한액 6.17백만원 반영)
    const pensionPart = Math.min(grossMonthly, 6.17) * 0.045;
    // 건강보험: 3.545%
    const healthPart = grossMonthly * 0.03545;
    // 노인장기요양보험: 건보료의 12.95%
    const ltciPart = healthPart * 0.1295;
    // 고용보험: 0.9%
    const employPart = grossMonthly * 0.009;
    const fourMajorTotal = pensionPart + healthPart + ltciPart + employPart;

    // 2) 근로소득세 계산
    const deduction = calcEarnedIncomeDeduction(annualGross);
    const earnedIncomeAmount = Math.max(0, annualGross - deduction);
    const taxBase = Math.max(0, earnedIncomeAmount - personalDeduction);
    let baseTax = calcProgressiveNationalIncomeTax(taxBase);

    // 근로소득 세액공제 (산출세액 130만원 이하 55%, 초과 30% 감면, 한도 최대 74만원)
    let taxCredit = 0;
    if (baseTax <= 1.3) {
      taxCredit = baseTax * 0.55;
    } else {
      taxCredit = 1.3 * 0.55 + (baseTax - 1.3) * 0.3;
    }
    taxCredit = Math.min(taxCredit, 0.74);

    const nationalTax = Math.max(0, baseTax - taxCredit);
    const localTax = nationalTax * 0.1; // 지방소득세 10%
    const annualTax = nationalTax + localTax;
    const taxMonthly = annualTax / 12.0;

    const netMonthly = Math.max(0, grossMonthly - fourMajorTotal - taxMonthly);

    return {
      grossMonthly,
      netMonthly,
      fourMajorTotal,
      taxMonthly,
      pensionPart,
      healthPart,
      ltciPart,
      employPart,
      incomeTax: nationalTax / 12.0,
      localTax: localTax / 12.0,
    };
  }

  /**
   * 지역가입자 건강보험 재산등급별 점수 산정 (단위: 백만원)
   * 주택 과세표준 = 시세 × 공시가격비율 × 공정시장가액비율(60%)
   * 2024.02 개편 기준 재산 기본공제 1억원(100백만원) 차감 후 잔여 과표 기준 점수 부여
   */
  const NHIS_PROPERTY_BRACKETS = [
    { maxBase: 4.5, points: 22 },
    { maxBase: 9.0, points: 44 },
    { maxBase: 13.5, points: 64 },
    { maxBase: 18.0, points: 85 },
    { maxBase: 23.0, points: 112 },
    { maxBase: 29.0, points: 138 },
    { maxBase: 36.0, points: 164 },
    { maxBase: 45.0, points: 193 },
    { maxBase: 55.0, points: 224 },
    { maxBase: 67.0, points: 257 },
    { maxBase: 81.0, points: 292 },
    { maxBase: 97.0, points: 325 },
    { maxBase: 115.0, points: 365 },
    { maxBase: 135.0, points: 405 },
    { maxBase: 160.0, points: 450 },
    { maxBase: 190.0, points: 501 },
    { maxBase: 230.0, points: 559 },
    { maxBase: 280.0, points: 624 },
    { maxBase: 345.0, points: 696 },
    { maxBase: 425.0, points: 775 },
    { maxBase: 525.0, points: 864 },
    { maxBase: 650.0, points: 963 },
    { maxBase: 800.0, points: 1073 },
    { maxBase: 1000.0, points: 1196 },
    { maxBase: 1300.0, points: 1350 },
    { maxBase: 1700.0, points: 1520 },
    { maxBase: 2200.0, points: 1710 },
    { maxBase: 3000.0, points: 1950 },
    { maxBase: Infinity, points: 2250 },
  ];

  function calcNhisPropertyMonthly(marketPrice, officialPriceRatio) {
    if (marketPrice <= 0) return 0;
    const officialPrice = marketPrice * (officialPriceRatio / 100.0);
    // 건보료 재산과표는 지방세법상 재산세 과세표준(공시가격 × 60%) 적용 후 1억원(100.0 백만원) 기본공제
    const propertyTaxBase = officialPrice * 0.6;
    const netBase = Math.max(0, propertyTaxBase - 100.0);
    if (netBase <= 0) return 0;

    let points = 22;
    for (const b of NHIS_PROPERTY_BRACKETS) {
      if (netBase <= b.maxBase) {
        points = b.points;
        break;
      }
    }
    // 점수당 208.4원 -> 백만원 단위로 변환 (points * 208.4 / 1,000,000)
    return (points * 208.4) / 1000000.0;
  }

  /**
   * 1세대 1주택 보유 재산세(지방교육세 20% + 도시지역분 0.14% 포함) 연간 세액 계산 -> 월 환산 (백만원)
   */
  function calcMonthlyHousingPropertyTax(marketPrice, officialPriceRatio) {
    if (marketPrice <= 0) return 0;
    const officialPrice = marketPrice * (officialPriceRatio / 100.0);
    // 1세대 1주택 공정시장가액비율 약 45% 적용
    const taxBase = officialPrice * 0.45;
    if (taxBase <= 0) return 0;

    // 공시가격 9억 이하 1세대 1주택 특례세율 (0.05% ~ 0.35%), 초과 시 일반세율(0.1% ~ 0.4%)
    let baseTax = 0;
    if (officialPrice <= 900.0) {
      if (taxBase <= 60.0) baseTax = taxBase * 0.0005;
      else if (taxBase <= 150.0) baseTax = 0.03 + (taxBase - 60.0) * 0.001;
      else if (taxBase <= 300.0) baseTax = 0.12 + (taxBase - 150.0) * 0.002;
      else baseTax = 0.42 + (taxBase - 300.0) * 0.0035;
    } else {
      if (taxBase <= 60.0) baseTax = taxBase * 0.001;
      else if (taxBase <= 150.0) baseTax = 0.06 + (taxBase - 60.0) * 0.0015;
      else if (taxBase <= 300.0) baseTax = 0.195 + (taxBase - 150.0) * 0.0025;
      else baseTax = 0.57 + (taxBase - 300.0) * 0.004;
    }

    const localEduTax = baseTax * 0.2; // 지방교육세
    const urbanTax = taxBase * 0.0014; // 도시지역분
    const annualTotal = baseTax + localEduTax + urbanTax;
    return annualTotal / 12.0;
  }

  /**
   * 특정 계좌형 연금(DC, IRP, 연금저축, 개인연금)의 월 인출액 계산 헬퍼
   */
  function stepAccountAsset(params, age, monthInYear, inflationFactorFromStart, inflationFactorFromBase) {
    // params: { enabled, balance, contribEndAge, monthlyContrib, returnRate, dividendRate, startAge, withdrawalMode, payoutYears, fixedMonthly, inflateFixed, withdrawalRate, annualTargetPmt }
    if (!params.enabled) {
      return { cif: 0, endBalance: 0, annualTargetPmt: 0 };
    }

    let bal = params.balance;
    const totalAnnualReturn = (params.returnRate + (params.dividendRate || 0)) / 100.0;
    const monthlyRate = Math.pow(1 + Math.max(-0.99, totalAnnualReturn), 1 / 12) - 1;

    // 1) 개시 전이고 적립 종료 나이 미만이면 월 추가납입
    if (age < params.contribEndAge && age < params.startAge) {
      bal += params.monthlyContrib;
    }

    // 2) 당월 운용수익(자본+배당) 반영
    const monthlyGain = bal * monthlyRate;
    bal += monthlyGain;

    // 3) 인출(개시 나이 이상)
    let cif = 0;
    let updatedAnnualPmt = params.annualTargetPmt || 0;

    if (age >= params.startAge && bal > 0.0001) {
      const mode = params.withdrawalMode;
      if (mode === "period") {
        // 매년 첫 달(monthInYear === 0) 또는 아직 PMT가 없으면 잔여 개월수 기준 원리금균등 인출액 재산정
        const remainingYears = Math.max(0, params.startAge + params.payoutYears - age);
        const remainingMonths = remainingYears * 12 - monthInYear;
        if (remainingMonths <= 0) {
          cif = 0;
        } else if (remainingMonths === 1) {
          cif = bal;
        } else {
          if (Math.abs(monthlyRate) < 1e-7) {
            cif = bal / remainingMonths;
          } else {
            cif =
              (bal * monthlyRate) /
              (1 - Math.pow(1 + monthlyRate, -remainingMonths));
          }
        }
      } else if (mode === "fixed") {
        const target = params.inflateFixed
          ? params.fixedMonthly * inflationFactorFromBase
          : params.fixedMonthly;
        cif = Math.min(bal, target);
      } else if (mode === "rate") {
        if (monthInYear === 0 || updatedAnnualPmt <= 0) {
          updatedAnnualPmt = bal * (params.withdrawalRate / 100.0);
        }
        cif = Math.min(bal, updatedAnnualPmt / 12.0);
      } else if (mode === "income_only") {
        // 당월 발생한 운용+배당수익만 인출하여 원금 보존
        cif = Math.max(0, Math.min(bal, monthlyGain));
      }

      cif = Math.max(0, Math.min(bal, cif));
      bal = Math.max(0, bal - cif);
    }

    return {
      cif,
      endBalance: bal,
      annualTargetPmt: updatedAnnualPmt,
    };
  }

  /**
   * 연간 세금 및 건강보험료 정밀 산출
   */
  function calculateAnnualTaxesAndNhis(yearCtx, taxConfig) {
    const {
      age,
      salaryAnnualGross, // 근로소득 세전 총액
      salaryTaxAnnual, // 근로소득세 및 지방소득세 연간액
      salaryFourMajorAnnual, // 직장 4대보험 연간액
      isEmployed, // 직장 근무 여부 (직장가입자 건강보험 적용)
      npAnnual, // 국민연금 연간 수령액
      npTaxableAnnual, // 국민연금 과세대상 연금소득
      dcAnnual, // DC 총 수령액
      dcSeveranceWithinLimit, // DC 한도 내 이연퇴직소득
      dcSeveranceOverLimit, // DC 한도 초과 이연퇴직소득 (감면 없음 100%)
      dcTaxableWithinLimit, // DC 한도 내 사적연금 과세분 (저율 연금소득세)
      dcTaxableOverLimit, // DC 한도 초과 사적연금 과세분 (기타소득세 16.5% 분리과세)
      dcYearsSinceStart,
      dcEffSevRate,
      irpAnnual,
      irpSeveranceWithinLimit,
      irpSeveranceOverLimit,
      irpTaxableWithinLimit,
      irpTaxableOverLimit,
      irpYearsSinceStart,
      irpEffSevRate,
      psAnnual, // 연금저축 총 수령액
      psTaxableWithinLimit, // 연금저축 한도 내 과세분 (저율 연금소득세)
      psTaxableOverLimit, // 연금저축 한도 초과 과세분 (기타소득세 16.5% 분리과세)
      privAnnual, // 개인연금 총 수령액
      privTaxableAnnual, // 개인연금 과세분 (비과세 체크 시 0)
      stockDividendAnnual, // 주식 배당금 총액 (세전)
      stockSellGainForeignAnnual, // 해외주식 매도 실현차익
      houseMarketPrice,
      houseOfficialRatio,
    } = yearCtx;

    // 1. 퇴직소득세 계산 (한도 내는 30~40% 감면, 한도 초과는 감면 없이 100% 과세)
    const dcReductionFactor = dcYearsSinceStart <= 10 ? 0.7 : 0.6;
    const irpReductionFactor = irpYearsSinceStart <= 10 ? 0.7 : 0.6;
    const severanceTaxAnnual =
      (dcSeveranceWithinLimit * dcReductionFactor + dcSeveranceOverLimit * 1.0) * (dcEffSevRate / 100.0) +
      (irpSeveranceWithinLimit * irpReductionFactor + irpSeveranceOverLimit * 1.0) * (irpEffSevRate / 100.0);

    // 2. 한도 초과분(연금외수령) 기타소득세 16.5% 분리과세 (사적연금 1500만원 종합과세 한도 제외)
    const penaltyOtherIncomeTaxAnnual =
      (dcTaxableOverLimit + irpTaxableOverLimit + psTaxableOverLimit) * 0.165;

    // 3. 연금수령 한도 내 사적연금 과세대상 합계 (저율 연금소득세 / 1500만 초과 판단 대상)
    const privatePensionTaxableTotal =
      dcTaxableWithinLimit +
      irpTaxableWithinLimit +
      psTaxableWithinLimit +
      privTaxableAnnual;

    // 연령별 저율 연금소득세율 (지방소득세 포함: 55~69세 5.5%, 70~79세 4.4%, 80세 이상 3.3%)
    let lowPensionTaxRate = 0.055;
    if (age >= 80) lowPensionTaxRate = 0.033;
    else if (age >= 70) lowPensionTaxRate = 0.044;

    // 3. 인적공제 계산 (본인 150만원 + 배우자 150만원 + 부양가족 1인당 150만원 + 경로우대 70세 이상 100만원)
    let personalDeduction = 1.5;
    if (taxConfig.hasSpouseDeduction) personalDeduction += 1.5;
    personalDeduction += (taxConfig.extraDependents || 0) * 1.5;
    if (age >= 70) personalDeduction += 1.0; // 경로우대 추가공제 100만원

    // 4. 금융소득(배당금) 과세 구분
    // - 연 2,000만원(20.0 백만원) 이하: 15.4% 분리과세 종결
    // - 연 2,000만원 초과: 2,000만원까지는 15.4%, 초과분은 종합소득 과세표준에 합산 (비교과세 적용)
    const dividendWithholdingBase = Math.min(20.0, stockDividendAnnual);
    const dividendExcess = Math.max(0, stockDividendAnnual - 20.0);

    // 헬퍼: 특정 종합과세 대상 연금소득(compPension)에 대해 총 소득세(공적연금+배당초과분+해당연금) 계산
    function computeComprehensiveTaxBundle(compPensionIncome) {
      const pensionDeduction = calcPensionIncomeDeduction(compPensionIncome);
      const netPensionIncome = Math.max(0, compPensionIncome - pensionDeduction);

      // 배당 초과분 Gross-up (11% 가산 후 배당세액공제 반영 근사) 및 비교과세
      const compTaxBase = Math.max(
        0,
        netPensionIncome + dividendExcess - personalDeduction
      );
      let nationalTax = calcProgressiveNationalIncomeTax(compTaxBase);
      // 표준세액공제 7만원(0.07 백만원) 차감
      nationalTax = Math.max(0, nationalTax - 0.07);
      const compTotalWithLocal = nationalTax * 1.1; // 지방소득세 10% 가산

      // 배당 2,000만원 이하 원천징수세액 (15.4%)
      const divBaseTax = dividendWithholdingBase * 0.154;
      // 금융소득 비교과세: 종합과세 시 세액이 전체 배당금 × 15.4%보다 작을 수 없음
      const minDividendTax = stockDividendAnnual * 0.154;

      return Math.max(compTotalWithLocal + divBaseTax, minDividendTax);
    }

    let totalIncomeAndPensionTax = 0;
    let chosenPrivatePensionTaxRule = "1,500만원 이하 저율 분리과세";
    let taxSavedByOptimization = 0;

    if (privatePensionTaxableTotal <= 15.0001) {
      // 사적연금이 연 1,500만원 이하인 경우: 연령별 저율(3.3~5.5%) 분리과세 + 국민연금/배당 종합소득세
      const privateLowTax = privatePensionTaxableTotal * lowPensionTaxRate;
      const publicAndDivTax = computeComprehensiveTaxBundle(npTaxableAnnual);
      totalIncomeAndPensionTax = privateLowTax + publicAndDivTax;
      chosenPrivatePensionTaxRule = `연 1,500만원 이하 저율 분리과세 (${(
        lowPensionTaxRate * 100
      ).toFixed(1)}%)`;
    } else {
      // 사적연금이 연 1,500만원을 초과한 경우!
      // 옵션 A: 사적연금 전액 16.5% 분리과세 + (국민연금 + 배당초과분) 종합과세
      const taxOptionSeparate165 =
        privatePensionTaxableTotal * 0.165 +
        computeComprehensiveTaxBundle(npTaxableAnnual);

      // 옵션 B: (국민연금 + 사적연금 전액 + 배당초과분) 종합소득 합산과세
      const taxOptionComprehensive = computeComprehensiveTaxBundle(
        npTaxableAnnual + privatePensionTaxableTotal
      );

      const mode = taxConfig.privatePensionOver15MMode || "auto";
      if (mode === "separate_165") {
        totalIncomeAndPensionTax = taxOptionSeparate165;
        chosenPrivatePensionTaxRule = "16.5% 분리과세 (사용자 고정)";
      } else if (mode === "comprehensive") {
        totalIncomeAndPensionTax = taxOptionComprehensive;
        chosenPrivatePensionTaxRule = "종합소득 합산과세 (사용자 고정)";
      } else {
        if (taxOptionSeparate165 <= taxOptionComprehensive) {
          totalIncomeAndPensionTax = taxOptionSeparate165;
          taxSavedByOptimization = taxOptionComprehensive - taxOptionSeparate165;
          chosenPrivatePensionTaxRule = "16.5% 분리과세 자동선택 (유리)";
        } else {
          totalIncomeAndPensionTax = taxOptionComprehensive;
          taxSavedByOptimization = taxOptionSeparate165 - taxOptionComprehensive;
          chosenPrivatePensionTaxRule = "종합소득 합산과세 자동선택 (유리)";
        }
      }
    }

    // 5. 해외주식 양도소득세 (연 250만원 기본공제 후 22% 분리과세)
    const foreignStockCapGainTax =
      Math.max(0, stockSellGainForeignAnnual - 2.5) * 0.22;

    // 총 연간 세금 합계 (근로소득세 + 퇴직소득세 + 한도초과 기타소득세 + 연금/배당/종합소득세 + 해외주식 양도세)
    const totalAnnualTax =
      (salaryTaxAnnual || 0) + severanceTaxAnnual + penaltyOtherIncomeTaxAnnual + totalIncomeAndPensionTax + foreignStockCapGainTax;

    // 6. 지역가입자 건강보험료 + 노인장기요양보험료 산출 (사용자 선택: 처음부터 지역가입자 기준)
    // - 소득 반영:
    //   ① 공적연금(국민연금): 총 수령액의 50% 반영
    //   ② 금융소득(주식배당): 연 1,000만원(10.0 백만원) 초과 시 전액(100%) 반영, 1,000만원 이하 0원
    //   ③ 사적연금: 옵션 활성화 시 50% 반영 (기본은 현행 실무대로 0원)
    const nhisPublicPensionIncome = npAnnual * 0.5;
    const nhisFinancialIncome =
      stockDividendAnnual > 10.0 ? stockDividendAnnual : 0;
    const nhisPrivatePensionIncome = taxConfig.includePrivatePensionInNHIS
      ? privatePensionTaxableTotal * 0.5
      : 0;

    const nhisAnnualAssessedIncome =
      nhisPublicPensionIncome + nhisFinancialIncome + nhisPrivatePensionIncome;

    const nhisRate = (taxConfig.nhisRate || 7.09) / 100.0;
    const ltciRate = (taxConfig.ltciRateOfNhis || 12.95) / 100.0;

    // 연 소득 336만원(3.36 백만원) 이하 시 소득 최저보험료(월 19,780원 = 0.01978 백만원) 적용
    let monthlyNhisIncomePart = 0;
    if (nhisAnnualAssessedIncome <= 3.36) {
      monthlyNhisIncomePart = 0.01978;
    } else {
      monthlyNhisIncomePart = (nhisAnnualAssessedIncome / 12.0) * nhisRate;
    }

    // 주택 재산 건보료 (월)
    const monthlyNhisPropertyPart = calcNhisPropertyMonthly(
      houseMarketPrice,
      houseOfficialRatio
    );

    let monthlyBaseNhis = monthlyNhisIncomePart + monthlyNhisPropertyPart;
    let monthlyLtci = monthlyBaseNhis * ltciRate; // 노인장기요양보험료
    let totalMonthlyNhis = monthlyBaseNhis + monthlyLtci;

    // 직장 근무 중(isEmployed)이면 직장 4대보험(건보+요양+국민연금+고용)이 적용되므로 지역건보료 대신 직장 4대보험료 반영
    if (isEmployed && salaryFourMajorAnnual > 0) {
      totalMonthlyNhis = salaryFourMajorAnnual / 12.0;
      monthlyBaseNhis = totalMonthlyNhis / (1 + ltciRate);
      monthlyLtci = totalMonthlyNhis - monthlyBaseNhis;
    }

    // 7. 거주주택 보유 재산세 (월 환산, 옵션)
    const monthlyPropertyTax = taxConfig.includePropertyTaxInCost
      ? calcMonthlyHousingPropertyTax(houseMarketPrice, houseOfficialRatio)
      : 0;

    // 세부 세목별 연간 세액 breakdown 계산 (툴팁 표시용)
    const dcSevTaxAnnual = (dcSeveranceWithinLimit * dcReductionFactor + dcSeveranceOverLimit * 1.0) * (dcEffSevRate / 100.0);
    const irpSevTaxAnnual = (irpSeveranceWithinLimit * irpReductionFactor + irpSeveranceOverLimit * 1.0) * (irpEffSevRate / 100.0);
    const dcPenaltyTaxAnnual = dcTaxableOverLimit * 0.165;
    const irpPenaltyTaxAnnual = irpTaxableOverLimit * 0.165;
    const psPenaltyTaxAnnual = psTaxableOverLimit * 0.165;

    // 배당 원천징수 세액 (연 2,000만원 이하 15.4%)
    const stockDividendTaxAnnual = dividendWithholdingBase * 0.154;

    // 공적연금(국민연금) 세액
    const publicPensionTaxAnnual = computeComprehensiveTaxBundle(npTaxableAnnual) - (dividendWithholdingBase * 0.154);

    // 사적연금(한도 내) 연금소득세 또는 종합과세분
    const privatePensionTaxAnnual = Math.max(0, totalIncomeAndPensionTax - (publicPensionTaxAnnual + stockDividendTaxAnnual));

    // 사적연금 과세대상(DC 운용수익분, IRP 운용수익분, 연금저축 과세분, 과세 개인연금) 비율대로 연금소득세 안분
    const dcPensionIncomeTaxAnnual = privatePensionTaxableTotal > 0
      ? (dcTaxableWithinLimit / privatePensionTaxableTotal) * privatePensionTaxAnnual
      : 0;
    const irpPensionIncomeTaxAnnual = privatePensionTaxableTotal > 0
      ? (irpTaxableWithinLimit / privatePensionTaxableTotal) * privatePensionTaxAnnual
      : 0;
    const psPensionIncomeTaxAnnual = privatePensionTaxableTotal > 0
      ? (psTaxableWithinLimit / privatePensionTaxableTotal) * privatePensionTaxAnnual
      : 0;
    const privPensionIncomeTaxAnnual = privatePensionTaxableTotal > 0
      ? (privTaxableAnnual / privatePensionTaxableTotal) * privatePensionTaxAnnual
      : 0;

    return {
      monthlyTax: totalAnnualTax / 12.0,
      monthlySeveranceTax: severanceTaxAnnual / 12.0,
      monthlyPenaltyTax: penaltyOtherIncomeTaxAnnual / 12.0,
      monthlyIncomeAndPensionTax: totalIncomeAndPensionTax / 12.0,
      monthlyCapGainTax: foreignStockCapGainTax / 12.0,
      taxBreakdown: {
        salaryTax: (salaryTaxAnnual || 0) / 12.0,
        dcTotal: (dcSevTaxAnnual + dcPenaltyTaxAnnual + dcPensionIncomeTaxAnnual) / 12.0,
        dcSeverance: dcSevTaxAnnual / 12.0,
        dcPenalty: dcPenaltyTaxAnnual / 12.0,
        dcPensionTax: dcPensionIncomeTaxAnnual / 12.0,
        irpTotal: (irpSevTaxAnnual + irpPenaltyTaxAnnual + irpPensionIncomeTaxAnnual) / 12.0,
        irpSeverance: irpSevTaxAnnual / 12.0,
        irpPenalty: irpPenaltyTaxAnnual / 12.0,
        irpPensionTax: irpPensionIncomeTaxAnnual / 12.0,
        psTotal: (psPenaltyTaxAnnual + psPensionIncomeTaxAnnual) / 12.0,
        psPenalty: psPenaltyTaxAnnual / 12.0,
        psPensionTax: psPensionIncomeTaxAnnual / 12.0,
        npTax: Math.max(0, publicPensionTaxAnnual) / 12.0,
        stockDivTax: stockDividendTaxAnnual / 12.0,
        stockCapGainTax: foreignStockCapGainTax / 12.0,
        stockTotal: (stockDividendTaxAnnual + foreignStockCapGainTax) / 12.0,
        privatePensionLowTax: privPensionIncomeTaxAnnual / 12.0,
      },
      monthlyNhis: totalMonthlyNhis,
      monthlyNhisIncomePart: monthlyNhisIncomePart * (1 + ltciRate),
      monthlyNhisPropertyPart: monthlyNhisPropertyPart * (1 + ltciRate),
      monthlyPropertyTax,
      totalMonthlyCost:
        totalAnnualTax / 12.0 + totalMonthlyNhis + monthlyPropertyTax,
      chosenPrivatePensionTaxRule,
      taxSavedByOptimizationAnnual: taxSavedByOptimization,
      privatePensionTaxableTotalAnnual: privatePensionTaxableTotal,
    };
  }

  // =========================================================================
  // 시뮬레이션 코어 (연 단위 상태 스냅샷 + 목표 CIF 역산 솔버)
  // =========================================================================

  const ACCOUNT_KEYS = ["dcPension", "irp", "pensionSavings", "privatePension"];
  const SHORT = {
    dcPension: "dc",
    irp: "irp",
    pensionSavings: "ps",
    privatePension: "priv",
    stockPortfolio: "stock",
  };
  const AUTO_CAPABLE = [
    "stockPortfolio",
    "pensionSavings",
    "irp",
    "dcPension",
    "privatePension",
  ];
  const AUTO_LABELS = {
    dcPension: "퇴직DC",
    irp: "IRP",
    pensionSavings: "연금저축",
    privatePension: "개인연금",
    stockPortfolio: "주식",
  };
  // 세법상 연금계좌(DC/IRP/연금저축)는 55세 이후 연금수령 가능
  const PENSION_ACCOUNT_MIN_AGE = {
    dcPension: 55,
    irp: 55,
    pensionSavings: 55,
    privatePension: 0,
  };

  function num(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function normalizeOrder(order) {
    const out = [];
    if (Array.isArray(order)) {
      for (const k of order) {
        if (AUTO_CAPABLE.includes(k) && !out.includes(k)) out.push(k);
      }
    }
    for (const k of AUTO_CAPABLE) if (!out.includes(k)) out.push(k);
    return out;
  }

  function normalizeTarget(state) {
    const def = createDefaultState().target;
    const t = Object.assign({}, def, state.target || {});
    t.priorityOrder = normalizeOrder(t.priorityOrder);
    return t;
  }

  function initSimState(assets) {
    const s = { acc: {}, stock: {}, house: {} };
    for (const key of ACCOUNT_KEYS) {
      const a = assets[key];
      s.acc[key] = {
        bal: a.enabled ? num(a.currentBalance) : 0,
        annualPmt: 0,
      };
    }
    const sp = assets.stockPortfolio;
    const sb = sp.enabled ? num(sp.currentBalance) : 0;
    s.stock = {
      bal: sb,
      principal: sb * (num(sp.currentPrincipalRatio, 75) / 100.0),
      annualSellTarget: 0,
    };
    const hs = assets.housing;
    s.house = {
      price: hs.enabled ? num(hs.currentMarketPrice) : 0,
      lockedRm: null,
      loan: 0,
    };
    return s;
  }

  function cloneSimState(s) {
    return {
      acc: {
        dcPension: { ...s.acc.dcPension },
        irp: { ...s.acc.irp },
        pensionSavings: { ...s.acc.pensionSavings },
        privatePension: { ...s.acc.privatePension },
      },
      stock: { ...s.stock },
      house: { ...s.house },
    };
  }

  // 계좌형 자산의 '직접 설정(고정)' 인출 로직
  function manualWithdrawal(a, st, age, m, mr, gain, infl) {
    const sa = num(a.startAge);
    let cif = 0;
    const mode = a.withdrawalMode;
    if (mode === "period") {
      const remainingYears = Math.max(0, sa + num(a.payoutYears, 20) - age);
      const remainingMonths = remainingYears * 12 - m;
      if (remainingMonths <= 0) cif = 0;
      else if (remainingMonths === 1) cif = st.bal;
      else if (Math.abs(mr) < 1e-7) cif = st.bal / remainingMonths;
      else cif = (st.bal * mr) / (1 - Math.pow(1 + mr, -remainingMonths));
    } else if (mode === "fixed") {
      const target = a.inflateFixed
        ? num(a.fixedMonthly) * infl
        : num(a.fixedMonthly);
      cif = target;
    } else if (mode === "rate") {
      if (m === 0 || st.annualPmt <= 0) {
        st.annualPmt = st.bal * (num(a.withdrawalRate) / 100.0);
      }
      cif = st.annualPmt / 12.0;
    } else if (mode === "income_only") {
      cif = Math.max(0, gain);
    }
    // 연 1,500만원 등 연간 수령 한도 캡 적용
    if (a.capAnnualLimit && num(a.maxAnnualPayout) > 0) {
      const maxMonthly = num(a.maxAnnualPayout, 15.0) / 12.0;
      cif = Math.min(cif, maxMonthly);
    }

    cif = Math.max(0, Math.min(st.bal, cif));
    st.bal = Math.max(0, st.bal - cif);
    return cif;
  }

  function sellStock(st, amt, sp, sums) {
    if (amt <= 0 || st.bal <= 0) return 0;
    const sell = Math.min(st.bal, amt);
    const gainRatio = Math.max(0, (st.bal - st.principal) / st.bal);
    st.bal = Math.max(0, st.bal - sell);
    st.principal = Math.max(0, st.principal - sell * (1 - gainRatio));
    const foreignRatio = num(sp.foreignStockRatio) / 100.0;
    sums.foreignGain += sell * gainRatio * foreignRatio;
    return sell;
  }

  /**
   * 1년(12개월) 시뮬레이션. s(상태)를 직접 변경합니다.
   * fill: { G: 월 추가 인출 목표액(세전), order: 자동조절 자산 우선순위 } 또는 null
   */
    /**
   * 소득세법 제20조의3 및 시행령 제40조의2: 연금수령한도 계산
   * 한도 = (과세기간 개시일 현재 평가액) / (11 - min(수령연차, 10)) * 120%
   * 11년차 이상부터는 한도 없음 (무제한)
   */
  function calcAnnualPensionLimit(startBalance, yearsSinceStart) {
    if (yearsSinceStart >= 11) return Infinity;
    const denom = Math.max(1, 11 - yearsSinceStart);
    return (startBalance / denom) * 1.2;
  }
function simulateYear(ctx, s, yIdx, fill) {
    const { assets, taxConfig, startAge, baseYear, inflationRate, targetEnabled } = ctx;
    const age = startAge + yIdx;
    const calendarYear = baseYear + yIdx;
    const ei = assets.earnedIncome;
    const np = assets.nationalPension;
    const sp = assets.stockPortfolio;
    const hs = assets.housing;

    // 퇴직DC 및 연금저축의 성장형/배당형 가중수익률 자동 산출
    if (assets.dcPension) {
      const gRatio = num(assets.dcPension.growthRatio, 60) / 100.0;
      const dRatio = num(assets.dcPension.dividendRatio, 40) / 100.0;
      const gRate = num(assets.dcPension.growthReturnRate, 5.0);
      const dRate = num(assets.dcPension.dividendReturnRate, 3.5);
      assets.dcPension.returnRate = gRatio * gRate;
      assets.dcPension.dividendRate = dRatio * dRate;
    }
    if (assets.pensionSavings) {
      const gRatio = num(assets.pensionSavings.growthRatio, 60) / 100.0;
      const dRatio = num(assets.pensionSavings.dividendRatio, 40) / 100.0;
      const gRate = num(assets.pensionSavings.growthReturnRate, 5.0);
      const dRate = num(assets.pensionSavings.dividendReturnRate, 3.5);
      assets.pensionSavings.returnRate = gRatio * gRate;
      assets.pensionSavings.dividendRate = dRatio * dRate;
    }

    // 근로소득 산출 (몇 년 동안 월 얼마)
    let salaryGrossMonthly = 0;
    let salaryNetMonthly = 0;
    let salaryTaxMonthly = 0;
    let salaryFourMajorMonthly = 0;
    let salaryCalcResult = null;
    const isEmployed = Boolean(
      ei && ei.enabled &&
      age >= num(ei.startAge) &&
      age < num(ei.startAge) + num(ei.workYears)
    );
    if (isEmployed) {
      salaryGrossMonthly = num(ei.monthlyGrossSalary);
      salaryCalcResult = calcEarnedIncomeMonthly(salaryGrossMonthly, 1.5);
      salaryNetMonthly = salaryCalcResult.netMonthly;
      salaryTaxMonthly = salaryCalcResult.taxMonthly;
      salaryFourMajorMonthly = salaryCalcResult.fourMajorTotal;
    }

    const sums = {
      salaryGross: 0, salaryNet: 0, salaryTax: 0, salaryFourMajor: 0,
      np: 0, dc: 0, irp: 0, ps: 0, priv: 0,
      stockDiv: 0, stockSell: 0, foreignGain: 0, rm: 0,
    };
    const fillTotals = {
      dcPension: 0, irp: 0, pensionSavings: 0, privatePension: 0, stockPortfolio: 0,
    };
    const manualTotals = {
      dcPension: 0, irp: 0, pensionSavings: 0, privatePension: 0,
    };

    // 연초 평가액 기록 및 연금수령연차 계산 (연금계좌 연금수령한도 산정용)
    const dcYearsSinceStart = Math.max(1, age - num(assets.dcPension.startAge) + 1);
    const irpYearsSinceStart = Math.max(1, age - num(assets.irp.startAge) + 1);
    const psYearsSinceStart = Math.max(1, age - num(assets.pensionSavings.startAge) + 1);

    const dcStartBal = s.acc.dcPension ? s.acc.dcPension.bal : 0;
    const irpStartBal = s.acc.irp ? s.acc.irp.bal : 0;
    const psStartBal = s.acc.pensionSavings ? s.acc.pensionSavings.bal : 0;

    const limits = {
      dcPension: age >= num(assets.dcPension.startAge) ? calcAnnualPensionLimit(dcStartBal, dcYearsSinceStart) : 0,
      irp: age >= num(assets.irp.startAge) ? (
        assets.irp.capAnnualLimit
          ? Math.min(calcAnnualPensionLimit(irpStartBal, irpYearsSinceStart), num(assets.irp.maxAnnualPayout, 15.0))
          : calcAnnualPensionLimit(irpStartBal, irpYearsSinceStart)
      ) : 0,
      pensionSavings: age >= num(assets.pensionSavings.startAge) ? (
        assets.pensionSavings.capAnnualLimit
          ? Math.min(calcAnnualPensionLimit(psStartBal, psYearsSinceStart), num(assets.pensionSavings.maxAnnualPayout, 15.0))
          : calcAnnualPensionLimit(psStartBal, psYearsSinceStart)
      ) : 0,
      privatePension: Infinity, // 개인연금(보험)은 세법상 연금계좌 수령한도 규정 없음
      stockPortfolio: Infinity,
    };

    // 주택연금 가입 시점: 월지급금 확정 + 초기보증료 대출잔액 반영
    if (
      hs.enabled && hs.useReverseMortgage &&
      age >= num(hs.rmStartAge) && s.house.lockedRm === null
    ) {
      s.house.lockedRm =
        hs.rmCalcMode === "manual"
          ? num(hs.rmManualMonthly)
          : estimateReverseMortgageMonthly(age, s.house.price);
      s.house.loan += s.house.price * (num(hs.rmInitialFeeRate, 1.5) / 100.0);
    }

    const months = [];

    for (let m = 0; m < 12; m++) {
      const monthIndex = yIdx * 12 + m;
      const infl = Math.pow(1 + inflationRate, monthIndex / 12.0);

      // 1) 국민연금
      let mNp = 0;
      if (np.enabled && age >= num(np.startAge)) {
        let baseMonthly = num(np.monthlyAmountAtStart);
        if (np.applyDeferralRule) {
          const diff = num(np.startAge) - num(np.baseAge, 65);
          if (diff < 0) baseMonthly *= Math.max(0.7, 1 + diff * 0.06);
          else if (diff > 0) baseMonthly *= 1 + Math.min(5, diff) * 0.072;
        }
        const g = np.linkToInflation ? inflationRate : num(np.customGrowthRate) / 100.0;
        mNp = baseMonthly * Math.pow(1 + g, yIdx + m / 12.0);
      }

      // 2) 계좌형 연금 (DC / IRP / 연금저축 / 개인연금)
      const acc = { dc: 0, irp: 0, ps: 0, priv: 0 };
      for (const key of ACCOUNT_KEYS) {
        const a = assets[key];
        if (!a.enabled) continue;

        // 개인연금은 "몇 년 동안 월 얼마" 약관 확정 수령 방식
        if (key === "privatePension") {
          const sa = num(a.startAge);
          const py = num(a.payoutYears, 10);
          if (age >= sa && age < sa + py) {
            const privPmt = num(a.monthlyPayout || a.fixedMonthly || 1.0);
            acc.priv = privPmt;
            manualTotals.privatePension += privPmt;
          }
          continue;
        }

        const st = s.acc[key];
        const auto = targetEnabled && a.cifMode === "auto";
        const sa = num(a.startAge);
        const totalRet = (num(a.returnRate) + num(a.dividendRate)) / 100.0;
        const mr = Math.pow(1 + Math.max(-0.99, totalRet), 1 / 12) - 1;
        if (age < num(a.contribEndAge) && (auto || age < sa)) {
          st.bal += num(a.monthlyContrib);
        }
        const gain = st.bal * mr;
        st.bal += gain;
        if (!auto && age >= sa && st.bal > 1e-4) {
          const w = manualWithdrawal(a, st, age, m, mr, gain, infl);
          acc[SHORT[key]] = w;
          manualTotals[key] += w;
        }
      }

      // 연금저축과 IRP 인출액 합산 연간 1,500만원(월 1.25백만원) 절세 한도 적용
      const hasSharedLimit = Boolean(assets.irp.capAnnualLimit || assets.pensionSavings.capAnnualLimit);
      const maxMonthlyShared = 15.0 / 12.0; // 월 1.25백만원 (연간 1,500만원)
      if (hasSharedLimit && (acc.irp + acc.ps) > maxMonthlyShared) {
        const sumPsIrp = acc.irp + acc.ps;
        const scale = maxMonthlyShared / sumPsIrp;
        const diffIrp = acc.irp * (1 - scale);
        const diffPs = acc.ps * (1 - scale);
        acc.irp *= scale;
        acc.ps *= scale;
        s.acc.irp.bal += diffIrp;
        s.acc.pensionSavings.bal += diffPs;
        manualTotals.irp -= diffIrp;
        manualTotals.pensionSavings -= diffPs;
      }

      // 3) 주식투자액
      let mDiv = 0;
      let mSell = 0;
      if (sp.enabled) {
        const st = s.stock;
        const auto = targetEnabled && sp.cifMode === "auto";
        const sa = num(sp.startAge);
        const mPriceRate = Math.pow(1 + num(sp.priceReturnRate) / 100.0, 1 / 12) - 1;
        const mDivRate = num(sp.dividendRate) / 100.0 / 12.0;
        if (age < num(sp.contribEndAge) && (auto || age < sa)) {
          const c = num(sp.monthlyContrib);
          st.bal += c;
          st.principal += c;
        }
        st.bal *= 1 + mPriceRate;
        const rawDiv = st.bal * mDivRate;
        if (age < sa) {
          const re = rawDiv * (1 - 0.154);
          st.bal += re;
          st.principal += re;
        } else {
          mDiv = rawDiv;
          if (!auto && st.bal > 1e-4 && sp.principalWithdrawalMode !== "none") {
            let amt = 0;
            if (sp.principalWithdrawalMode === "fixed") {
              amt = num(sp.fixedMonthlySell);
            } else if (sp.principalWithdrawalMode === "rate") {
              if (m === 0 || st.annualSellTarget <= 0) {
                st.annualSellTarget = st.bal * (num(sp.sellRate) / 100.0);
              }
              amt = st.annualSellTarget / 12.0;
            }
            mSell += sellStock(st, amt, sp, sums);
          }
        }
      }

      // 4) 거주주택 + 주택연금 (대출잔액 누적: 지급액 + 이자/보증료)
      let mRm = 0;
      if (hs.enabled) {
        s.house.price *= Math.pow(1 + num(hs.priceGrowthRate) / 100.0, 1 / 12);
        if (hs.useReverseMortgage && age >= num(hs.rmStartAge)) {
          mRm = s.house.lockedRm || 0;
          const loanMr = Math.pow(1 + num(hs.rmLoanRate, 4.5) / 100.0, 1 / 12) - 1;
          s.house.loan = (s.house.loan + mRm) * (1 + loanMr);
        }
      }

      // 5) 목표 CIF 자동조절:
      // [균등 배분 및 절세 전략 반영]
      // 특정 계좌에서 초반 몇 개월에 몰아서 인출하고 이후 0원이 되는 현상을 방지하기 위해,
      // 각 계좌의 잔액과 연간 한도를 잔여 개월 수(remMonths = 12 - m)로 나눈 '월 균등 인출 상한액' 내에서만 인출하고
      // 부족분은 다음 우선순위 계좌에서 동일하게 월 균등 인출합니다.
      if (fill && fill.G > 0) {
        let rem = fill.G;
        const remMonths = Math.max(1, 12 - m);

        // 1단계: 각 계좌의 '연간 수령한도 및 잔액의 월 균등 배분액' 이내에서 먼저 인출 (페널티 및 월별 변동 방지)
        for (const key of fill.order) {
          if (rem <= 1e-9) break;
          const a = assets[key];
          if (!a.enabled || age < num(a.startAge)) continue;

          if (key === "stockPortfolio") {
            const evenMonthlyStock = s.stock.bal / remMonths;
            const want = Math.min(rem, evenMonthlyStock);
            const got = sellStock(s.stock, want, sp, sums);
            mSell += got;
            fillTotals[key] += got;
            rem -= got;
          } else {
            if (age < PENSION_ACCOUNT_MIN_AGE[key]) continue;
            const st = s.acc[key];
            // 당해 연도 누적 인출액 기준 잔여 한도
            const prevMonthsWithdrawn = sums[SHORT[key]] || 0;
            const thisMonthWithdrawn = acc[SHORT[key]] || 0;
            let remainingLimit = Math.max(0, limits[key] - prevMonthsWithdrawn - thisMonthWithdrawn);
            let evenMonthlyLimit = remainingLimit === Infinity
              ? st.bal / remMonths
              : Math.max(0, (limits[key] - prevMonthsWithdrawn) / remMonths - thisMonthWithdrawn);

            // 연금저축과 IRP는 합산 연간 1,500만원(월 125만원) 한도 공유:
            // 이전 달까지 인출된 합산액을 제외한 잔여 연간 공유한도를 잔여 개월수(remMonths)로 먼저 나누고,
            // 이번 달에 이미 인출된(acc.irp + acc.ps) 금액을 차감하여 1~12월 내내 매달 완벽히 동일한 인출액 유지!
            if ((key === "irp" || key === "pensionSavings") && hasSharedLimit) {
              const prevMonthsShared = sums.irp + sums.ps;
              const thisMonthAlreadyShared = acc.irp + acc.ps;
              const remainingSharedAnnual = Math.max(0, 15.0 - prevMonthsShared - thisMonthAlreadyShared);
              remainingLimit = Math.min(remainingLimit, remainingSharedAnnual);
              const evenMonthlySharedCap = Math.max(0, (15.0 - prevMonthsShared) / remMonths - thisMonthAlreadyShared);
              evenMonthlyLimit = Math.min(evenMonthlyLimit, evenMonthlySharedCap);
            }

            // 잔여 개월(remMonths) 동안 매월 똑같은 금액으로 나누어 인출하도록 월 상한 설정
            const evenMonthlyBal = st.bal / remMonths;
            const evenCap = Math.min(evenMonthlyLimit, evenMonthlyBal);

            const canWithdraw = Math.min(st.bal, rem, remainingLimit, evenCap);
            if (canWithdraw > 1e-7) {
              st.bal -= canWithdraw;
              acc[SHORT[key]] += canWithdraw;
              fillTotals[key] += canWithdraw;
              rem -= canWithdraw;
            }
          }
        }

        // 2단계: 한도 초과 인출 (1단계 후에도 부족액이 있을 경우, 절세한도 미적용 계좌에서 잔여 개월 균등 인출)
        if (rem > 1e-9) {
          for (const key of fill.order) {
            if (rem <= 1e-9) break;
            const a = assets[key];
            if (!a.enabled || age < num(a.startAge) || key === "stockPortfolio") continue;
            if (a.capAnnualLimit) continue; // 연 1500만원 등 절세 한도 설정 시 한도 초과 인출 제외
            if (age < PENSION_ACCOUNT_MIN_AGE[key]) continue;
            const st = s.acc[key];
            const evenMonthlyBal = st.bal / remMonths;
            const got = Math.min(st.bal, rem, evenMonthlyBal);
            if (got > 1e-7) {
              st.bal -= got;
              acc[SHORT[key]] += got;
              fillTotals[key] += got;
              rem -= got;
            }
          }
        }
      }

      sums.salaryGross += salaryGrossMonthly;
      sums.salaryNet += salaryNetMonthly;
      sums.salaryTax += salaryTaxMonthly;
      sums.salaryFourMajor += salaryFourMajorMonthly;
      sums.np += mNp;
      sums.dc += acc.dc;
      sums.irp += acc.irp;
      sums.ps += acc.ps;
      sums.priv += acc.priv;
      sums.stockDiv += mDiv;
      sums.stockSell += mSell;
      sums.rm += mRm;

      // 개인연금은 확정 기간 월 지급 수령액(CIF)으로만 관리하며, 잔여 금융자산/순자산 원금 평가액에서는 제외
      const fin =
        s.acc.dcPension.bal + s.acc.irp.bal + s.acc.pensionSavings.bal + s.stock.bal;
      const houseEquity = Math.max(0, s.house.price - s.house.loan);

      months.push({
        age,
        year: calendarYear,
        month: m + 1,
        label: `${age}세 (${calendarYear}.${String(m + 1).padStart(2, "0")})`,
        inflationFactor: infl,
        salary: salaryGrossMonthly,
        salaryNet: salaryNetMonthly,
        np: mNp,
        dc: acc.dc,
        irp: acc.irp,
        ps: acc.ps,
        priv: acc.priv,
        stock: mDiv + mSell,
        stockDiv: mDiv,
        stockSell: mSell,
        housingRm: mRm,
        grossCif: salaryGrossMonthly + mNp + acc.dc + acc.irp + acc.ps + acc.priv + mDiv + mSell + mRm,
        balances: {
          dc: s.acc.dcPension.bal,
          irp: s.acc.irp.bal,
          ps: s.acc.pensionSavings.bal,
          priv: s.acc.privatePension.bal,
          stock: s.stock.bal,
          house: s.house.price,
          rmLoan: s.house.loan,
          houseEquity,
          financialTotal: fin,
          netWorth: fin + houseEquity,
        },
      });
    }

    // 세법상 한도 내/한도 초과(연금외수령) 인출액 분리
    // 1) DC
    const dcTotal = sums.dc;
    const dcWithin = Math.min(dcTotal, limits.dcPension);
    const dcOver = Math.max(0, dcTotal - dcWithin);
    const dcSevRatio = num(assets.dcPension.severancePrincipalRatio) / 100.0;

    // 2) IRP
    const irpTotal = sums.irp;
    const irpWithin = Math.min(irpTotal, limits.irp);
    const irpOver = Math.max(0, irpTotal - irpWithin);
    const irpSevRatio = num(assets.irp.severancePrincipalRatio) / 100.0;

    // 3) 연금저축
    const psTotal = sums.ps;
    const psWithin = Math.min(psTotal, limits.pensionSavings);
    const psOver = Math.max(0, psTotal - psWithin);
    const psNonTaxRatio = num(assets.pensionSavings.nonTaxablePrincipalRatio) / 100.0;

    const taxAndNhis = calculateAnnualTaxesAndNhis(
      {
        age,
        salaryAnnualGross: sums.salaryGross,
        salaryTaxAnnual: sums.salaryTax,
        salaryFourMajorAnnual: sums.salaryFourMajor,
        isEmployed,
        npAnnual: sums.np,
        npTaxableAnnual: sums.np * (num(np.taxableRatio, 100) / 100.0),
        dcAnnual: sums.dc,
        dcSeveranceWithinLimit: dcWithin * dcSevRatio,
        dcSeveranceOverLimit: dcOver * dcSevRatio,
        dcTaxableWithinLimit: dcWithin * (1 - dcSevRatio),
        dcTaxableOverLimit: dcOver * (1 - dcSevRatio),
        dcYearsSinceStart,
        dcEffSevRate: num(assets.dcPension.effectiveSeveranceTaxRate, 5.5),
        irpAnnual: sums.irp,
        irpSeveranceWithinLimit: irpWithin * irpSevRatio,
        irpSeveranceOverLimit: irpOver * irpSevRatio,
        irpTaxableWithinLimit: irpWithin * (1 - irpSevRatio),
        irpTaxableOverLimit: irpOver * (1 - irpSevRatio),
        irpYearsSinceStart,
        irpEffSevRate: num(assets.irp.effectiveSeveranceTaxRate, 5.5),
        psAnnual: sums.ps,
        psTaxableWithinLimit: psWithin * (1 - psNonTaxRatio),
        psTaxableOverLimit: psOver * (1 - psNonTaxRatio),
        privAnnual: sums.priv,
        privTaxableAnnual: assets.privatePension.isTaxFree ? 0 : sums.priv * 0.5,
        stockDividendAnnual: sums.stockDiv,
        stockSellGainForeignAnnual: sums.foreignGain,
        houseMarketPrice: hs.enabled ? s.house.price : 0,
        houseOfficialRatio: num(hs.officialPriceRatio, 69),
      },
      taxConfig
    );

    const annualGross =
      sums.salaryGross + sums.np + sums.dc + sums.irp + sums.ps + sums.priv +
      sums.stockDiv + sums.stockSell + sums.rm;
    const avgGross = annualGross / 12.0;
    const avgNet = avgGross - taxAndNhis.totalMonthlyCost;

    return { age, calendarYear, months, sums, taxAndNhis, avgGross, avgNet, fillTotals, manualTotals, limits, dcOver, irpOver, psOver, dcStartBal, irpStartBal, psStartBal, isEmployed, salaryCalcResult };
  }
function solveYearForTarget(ctx, s0, yIdx, order, targetNominal, measure) {
    const trial = (G) => {
      const st = cloneSimState(s0);
      const r = simulateYear(ctx, st, yIdx, G > 0 ? { G, order } : null);
      return { r, st, G };
    };
    const val = (t) => (measure === "gross" ? t.r.avgGross : t.r.avgNet);

    const t0 = trial(0);
    if (val(t0) >= targetNominal - 1e-4) return t0;

    let available = 0;
    for (const k of order) {
      available += k === "stockPortfolio" ? s0.stock.bal : s0.acc[k].bal;
    }
    let hi = (available * 1.2) / 12 + 0.05;
    const tHi = trial(hi);
    if (val(tHi) < targetNominal) return tHi; // 자산 소진 -> 목표 미달

    let lo = 0;
    let best = tHi;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const t = trial(mid);
      const v = val(t);
      if (v >= targetNominal) {
        hi = mid;
        best = t;
        if (v - targetNominal < 0.002) break;
      } else {
        lo = mid;
      }
    }
    return best;
  }

  /**
   * 전체 기간 시뮬레이션 실행
   * @param {Object} state 사용자 설정
   * @param {Object} opts { lite: true 이면 월별 레코드 생략(최적화용) }
   */
  function runSimulation(state, opts = {}) {
    const lite = Boolean(opts.lite);
    const meta = state.meta;
    const taxConfig = state.taxConfig;
    const assets = state.assets;
    const target = normalizeTarget(state);

    const startAge = Math.max(20, Math.min(95, num(meta.currentAge, 52)));
    const endAge = Math.max(startAge + 1, Math.min(110, num(meta.endAge, 95)));
    const baseYear = num(meta.baseYear, 2026);
    const inflationRate = num(meta.inflationRate) / 100.0;
    const isRealValue = meta.valueMode === "real";

    // 연금개시나이에 목표 CIF 적용 시작 나이 자동 반영
    const targetStartAge = num(target.startAge, 60);
    if (assets.dcPension) assets.dcPension.startAge = targetStartAge;
    if (assets.irp) assets.irp.startAge = targetStartAge;
    if (assets.pensionSavings) assets.pensionSavings.startAge = targetStartAge;
    if (assets.privatePension) assets.privatePension.startAge = targetStartAge;
    if (assets.stockPortfolio) assets.stockPortfolio.startAge = targetStartAge;

    const ctx = {
      assets,
      taxConfig,
      startAge,
      baseYear,
      inflationRate,
      targetEnabled: Boolean(target.enabled),
    };

    const autoOrder = target.enabled
      ? target.priorityOrder.filter(
          (k) => assets[k] && assets[k].enabled && assets[k].cifMode === "auto"
        )
      : [];

    let s = initSimState(assets);
    const yearlyRecords = [];
    const monthlyRecords = [];
    const conv = (val, f) => (isRealValue ? val / f : val);
    const convBal = (b, f) => ({
      dc: conv(b.dc, f),
      irp: conv(b.irp, f),
      ps: conv(b.ps, f),
      priv: conv(b.priv, f),
      stock: conv(b.stock, f),
      house: conv(b.house, f),
      rmLoan: conv(b.rmLoan, f),
      houseEquity: conv(b.houseEquity, f),
      financialTotal: conv(b.financialTotal, f),
      netWorth: conv(b.netWorth, f),
    });

    let shortfallYears = 0;
    let firstShortfallAge = null;
    let totalShortfallAnnual = 0;

    const totalYears = endAge - startAge + 1;
    for (let yIdx = 0; yIdx < totalYears; yIdx++) {
      const age = startAge + yIdx;
      const yf = Math.pow(1 + inflationRate, yIdx);

      const targetActive = target.enabled && age >= num(target.startAge, 60);
      const targetNominal = targetActive
        ? num(target.netMonthly) * (target.basis === "real" ? yf : 1)
        : null;

      let out;
      if (targetActive && autoOrder.length > 0) {
        out = solveYearForTarget(ctx, s, yIdx, autoOrder, targetNominal, target.measure);
        s = out.st;
      } else {
        const r = simulateYear(ctx, s, yIdx, null);
        out = { r, st: s };
      }
      const yr = out.r;
      const tx = yr.taxAndNhis;

      const measured = target.measure === "gross" ? yr.avgGross : yr.avgNet;
      const shortfall = targetActive ? Math.max(0, targetNominal - measured) : 0;
      if (shortfall > 0.005) {
        shortfallYears++;
        if (firstShortfallAge === null) firstShortfallAge = age;
        totalShortfallAnnual += shortfall * 12;
      }

      const mTaxAvg = conv(tx.monthlyTax, yf);
      const mNhisAvg = conv(tx.monthlyNhis, yf);
      const mPropAvg = conv(tx.monthlyPropertyTax, yf);
      const grossAvg = conv(yr.avgGross, yf);
      const costAvg = mTaxAvg + mNhisAvg + mPropAvg;
      const endItem = yr.months[11];
      const fmtKorMan = (mVal) => {
        const man = Math.round(mVal * 100);
        if (man <= 0) return "0원";
        const eok = Math.floor(man / 10000);
        const remMan = man % 10000;
        if (eok > 0 && remMan > 0) return `${eok}억 ${remMan.toLocaleString()}만원`;
        if (eok > 0) return `${eok}억원`;
        return `${remMan.toLocaleString()}만원`;
      };
      const fillDesc = Object.entries(yr.fillTotals)
        .filter(([, v]) => v > 0.01)
        .map(([k, v]) => `${AUTO_LABELS[k]} ${fmtKorMan(conv(v / 12, yf))}`)
        .join(", ");

      if (!lite) {
        for (const item of yr.months) {
          const f = item.inflationFactor;
          const grossCif = conv(item.grossCif, f);
          const mTax = conv(tx.monthlyTax, f);
          const mNhis = conv(tx.monthlyNhis, f);
          const mProp = conv(tx.monthlyPropertyTax, f);
          const totalCost = mTax + mNhis + mProp;
          monthlyRecords.push({
            age: item.age,
            year: item.year,
            month: item.month,
            label: item.label,
            salary: conv(item.salary, f),
            salaryNet: conv(item.salaryNet, f),
            np: conv(item.np, f),
            dc: conv(item.dc, f),
            irp: conv(item.irp, f),
            ps: conv(item.ps, f),
            priv: conv(item.priv, f),
            stock: conv(item.stock, f),
            stockDiv: conv(item.stockDiv, f),
            stockSell: conv(item.stockSell, f),
            housingRm: conv(item.housingRm, f),
            grossCif,
            tax: mTax,
            nhis: mNhis,
            propertyTax: mProp,
            totalCost,
            netCif: Math.max(0, grossCif - totalCost),
            target: targetActive ? conv(targetNominal, f) : null,
            shortfall: conv(shortfall, f),
            fillDesc,
            chosenTaxRule: tx.chosenPrivatePensionTaxRule,
            balances: convBal(item.balances, f),
            taxBreakdown: {
              salaryTax: conv(tx.taxBreakdown.salaryTax || 0, f),
              dcTotal: conv(tx.taxBreakdown.dcTotal, f),
              dcSeverance: conv(tx.taxBreakdown.dcSeverance, f),
              dcPenalty: conv(tx.taxBreakdown.dcPenalty, f),
              irpTotal: conv(tx.taxBreakdown.irpTotal, f),
              irpSeverance: conv(tx.taxBreakdown.irpSeverance, f),
              irpPenalty: conv(tx.taxBreakdown.irpPenalty, f),
              psTotal: conv(tx.taxBreakdown.psTotal, f),
              psPenalty: conv(tx.taxBreakdown.psPenalty, f),
              npTax: conv(tx.taxBreakdown.npTax, f),
              stockDivTax: conv(tx.taxBreakdown.stockDivTax, f),
              stockCapGainTax: conv(tx.taxBreakdown.stockCapGainTax, f),
              stockTotal: conv(tx.taxBreakdown.stockTotal, f),
              privatePensionLowTax: conv(tx.taxBreakdown.privatePensionLowTax, f),
            },
            details: {
              salary: {
                isEmployed: yr.isEmployed,
              },
            },
          });
        }
      }

      // 당해 연도 기말 잔액과 기초 잔액 간 자산변동액 계산 (금융자산별 & 주택/순자산)
      const prevBal = yIdx === 0
        ? {
            dc: conv(num(assets.dcPension.enabled ? assets.dcPension.currentBalance : 0), yf),
            irp: conv(num(assets.irp.enabled ? assets.irp.currentBalance : 0), yf),
            ps: conv(num(assets.pensionSavings.enabled ? assets.pensionSavings.currentBalance : 0), yf),
            priv: conv(num(assets.privatePension.enabled ? assets.privatePension.currentBalance : 0), yf),
            stock: conv(num(assets.stockPortfolio.enabled ? assets.stockPortfolio.currentBalance : 0), yf),
            financialTotal: conv(
              (assets.dcPension.enabled ? num(assets.dcPension.currentBalance) : 0) +
              (assets.irp.enabled ? num(assets.irp.currentBalance) : 0) +
              (assets.pensionSavings.enabled ? num(assets.pensionSavings.currentBalance) : 0) +
              (assets.stockPortfolio.enabled ? num(assets.stockPortfolio.currentBalance) : 0),
              yf
            ),
            houseEquity: conv(
              assets.housing.enabled ? num(assets.housing.currentMarketPrice) : 0,
              yf
            ),
            netWorth: conv(
              (assets.dcPension.enabled ? num(assets.dcPension.currentBalance) : 0) +
              (assets.irp.enabled ? num(assets.irp.currentBalance) : 0) +
              (assets.pensionSavings.enabled ? num(assets.pensionSavings.currentBalance) : 0) +
              (assets.stockPortfolio.enabled ? num(assets.stockPortfolio.currentBalance) : 0) +
              (assets.housing.enabled ? num(assets.housing.currentMarketPrice) : 0),
              yf
            ),
          }
        : yearlyRecords[yIdx - 1].balances;

      const curBal = convBal(endItem.balances, yf);
      const assetDelta = {
        dc: curBal.dc - prevBal.dc,
        irp: curBal.irp - prevBal.irp,
        ps: curBal.ps - prevBal.ps,
        priv: curBal.priv - prevBal.priv,
        stock: curBal.stock - prevBal.stock,
        financialTotal: curBal.financialTotal - prevBal.financialTotal,
        houseEquity: curBal.houseEquity - prevBal.houseEquity,
        netWorth: curBal.netWorth - prevBal.netWorth,
      };

      yearlyRecords.push({
        age,
        year: yr.calendarYear,
        label: `${age}세 (${yr.calendarYear})`,
        salary: conv(yr.sums.salaryGross / 12, yf),
        salaryNet: conv(yr.sums.salaryNet / 12, yf),
        np: conv(yr.sums.np / 12, yf),
        dc: conv(yr.sums.dc / 12, yf),
        irp: conv(yr.sums.irp / 12, yf),
        ps: conv(yr.sums.ps / 12, yf),
        priv: conv(yr.sums.priv / 12, yf),
        stock: conv((yr.sums.stockDiv + yr.sums.stockSell) / 12, yf),
        stockDiv: conv(yr.sums.stockDiv / 12, yf),
        stockSell: conv(yr.sums.stockSell / 12, yf),
        housingRm: conv(yr.sums.rm / 12, yf),
        grossCif: grossAvg,
        tax: mTaxAvg,
        nhis: mNhisAvg,
        propertyTax: mPropAvg,
        totalCost: costAvg,
        netCif: Math.max(0, grossAvg - costAvg),
        target: targetActive ? conv(targetNominal, yf) : null,
        shortfall: conv(shortfall, yf),
        fillDesc,
        chosenTaxRule: tx.chosenPrivatePensionTaxRule,
        taxSavedAnnual: conv(tx.taxSavedByOptimizationAnnual, yf),
        balances: curBal,
        assetDelta,
        taxBreakdown: {
          salaryTax: conv(tx.taxBreakdown.salaryTax || 0, yf),
          dcTotal: conv(tx.taxBreakdown.dcTotal, yf),
          dcSeverance: conv(tx.taxBreakdown.dcSeverance, yf),
          dcPenalty: conv(tx.taxBreakdown.dcPenalty, yf),
          irpTotal: conv(tx.taxBreakdown.irpTotal, yf),
          irpSeverance: conv(tx.taxBreakdown.irpSeverance, yf),
          irpPenalty: conv(tx.taxBreakdown.irpPenalty, yf),
          psTotal: conv(tx.taxBreakdown.psTotal, yf),
          psPenalty: conv(tx.taxBreakdown.psPenalty, yf),
          npTax: conv(tx.taxBreakdown.npTax, yf),
          stockDivTax: conv(tx.taxBreakdown.stockDivTax, yf),
          stockCapGainTax: conv(tx.taxBreakdown.stockCapGainTax, yf),
          stockTotal: conv(tx.taxBreakdown.stockTotal, yf),
          privatePensionLowTax: conv(tx.taxBreakdown.privatePensionLowTax, yf),
        },
        details: {
          salary: {
            totalMonthly: conv(yr.sums.salaryGross / 12, yf),
            grossMonthly: conv(yr.sums.salaryGross / 12, yf),
            netMonthly: conv(yr.sums.salaryNet / 12, yf),
            taxMonthly: conv(yr.sums.salaryTax / 12, yf),
            fourMajorMonthly: conv(yr.sums.salaryFourMajor / 12, yf),
            isEmployed: yr.isEmployed,
            startAge: assets.earnedIncome ? num(assets.earnedIncome.startAge) : 0,
            workYears: assets.earnedIncome ? num(assets.earnedIncome.workYears) : 0,
            rawCalc: yr.salaryCalcResult,
          },
          dc: {
            totalMonthly: conv(yr.sums.dc / 12, yf),
            fillMonthly: conv(yr.fillTotals.dcPension / 12, yf),
            manualMonthly: conv(yr.manualTotals.dcPension / 12, yf),
            startBal: conv(yr.dcStartBal, yf),
            annualLimit: yr.limits.dcPension === Infinity ? Infinity : conv(yr.limits.dcPension, yf),
            isAuto: target.enabled && assets.dcPension.cifMode === "auto",
            mode: assets.dcPension.withdrawalMode,
            growthRatio: num(assets.dcPension.growthRatio, 60),
            growthReturnRate: num(assets.dcPension.growthReturnRate, 5.0),
            dividendRatio: num(assets.dcPension.dividendRatio, 40),
            dividendReturnRate: num(assets.dcPension.dividendReturnRate, 3.5),
            divMonthly: conv((yr.dcStartBal * (num(assets.dcPension.dividendRate) / 100.0)) / 12, yf),
            sellMonthly: conv(Math.max(0, (yr.sums.dc / 12) - (yr.dcStartBal * (num(assets.dcPension.dividendRate) / 100.0)) / 12), yf),
          },
          irp: {
            totalMonthly: conv(yr.sums.irp / 12, yf),
            fillMonthly: conv(yr.fillTotals.irp / 12, yf),
            manualMonthly: conv(yr.manualTotals.irp / 12, yf),
            startBal: conv(yr.irpStartBal, yf),
            annualLimit: yr.limits.irp === Infinity ? Infinity : conv(yr.limits.irp, yf),
            isAuto: target.enabled && assets.irp.cifMode === "auto",
            mode: assets.irp.withdrawalMode,
            capAnnualLimit: Boolean(assets.irp.capAnnualLimit),
            maxAnnualPayout: 15.0,
            sharedAnnualLimit: 15.0,
            sharedMonthlyTotal: conv((yr.sums.irp + yr.sums.ps) / 12, yf),
            sharedAnnualTotal: conv(yr.sums.irp + yr.sums.ps, yf),
            divMonthly: conv((yr.irpStartBal * (num(assets.irp.dividendRate) / 100.0)) / 12, yf),
            sellMonthly: conv(Math.max(0, (yr.sums.irp / 12) - (yr.irpStartBal * (num(assets.irp.dividendRate) / 100.0)) / 12), yf),
          },
          ps: {
            totalMonthly: conv(yr.sums.ps / 12, yf),
            fillMonthly: conv(yr.fillTotals.pensionSavings / 12, yf),
            manualMonthly: conv(yr.manualTotals.pensionSavings / 12, yf),
            startBal: conv(yr.psStartBal, yf),
            annualLimit: yr.limits.pensionSavings === Infinity ? Infinity : conv(yr.limits.pensionSavings, yf),
            isAuto: target.enabled && assets.pensionSavings.cifMode === "auto",
            mode: assets.pensionSavings.withdrawalMode,
            capAnnualLimit: Boolean(assets.pensionSavings.capAnnualLimit),
            maxAnnualPayout: 15.0,
            sharedAnnualLimit: 15.0,
            sharedMonthlyTotal: conv((yr.sums.irp + yr.sums.ps) / 12, yf),
            sharedAnnualTotal: conv(yr.sums.irp + yr.sums.ps, yf),
            growthRatio: num(assets.pensionSavings.growthRatio, 60),
            growthReturnRate: num(assets.pensionSavings.growthReturnRate, 5.0),
            dividendRatio: num(assets.pensionSavings.dividendRatio, 40),
            dividendReturnRate: num(assets.pensionSavings.dividendReturnRate, 3.5),
            divMonthly: conv((yr.psStartBal * (num(assets.pensionSavings.dividendRate) / 100.0)) / 12, yf),
            sellMonthly: conv(Math.max(0, (yr.sums.ps / 12) - (yr.psStartBal * (num(assets.pensionSavings.dividendRate) / 100.0)) / 12), yf),
          },
          priv: {
            totalMonthly: conv(yr.sums.priv / 12, yf),
            fillMonthly: conv(yr.fillTotals.privatePension / 12, yf),
            manualMonthly: conv(yr.manualTotals.privatePension / 12, yf),
            startAge: num(assets.privatePension.startAge),
            payoutYears: num(assets.privatePension.payoutYears, 10),
            monthlyPayout: num(assets.privatePension.monthlyPayout || assets.privatePension.fixedMonthly || 1.0),
            isTaxFree: Boolean(assets.privatePension.isTaxFree),
          },
          stock: {
            totalMonthly: conv((yr.sums.stockDiv + yr.sums.stockSell) / 12, yf),
            divMonthly: conv(yr.sums.stockDiv / 12, yf),
            sellMonthly: conv(yr.sums.stockSell / 12, yf),
            fillMonthly: conv(yr.fillTotals.stockPortfolio / 12, yf),
            isAuto: target.enabled && assets.stockPortfolio.cifMode === "auto",
            sellMode: assets.stockPortfolio.principalWithdrawalMode,
          },
          np: {
            totalMonthly: conv(yr.sums.np / 12, yf),
            startAge: num(assets.nationalPension.startAge),
            baseAmount: num(assets.nationalPension.monthlyAmountAtStart),
          },
          housingRm: {
            totalMonthly: conv(yr.sums.rm / 12, yf),
            startAge: num(assets.housing.rmStartAge),
            useRm: assets.housing.useReverseMortgage,
          },
        },
      });
    }

    const activeYears = yearlyRecords.filter((r) => r.grossCif > 0.01);
    const avg = (fn) =>
      activeYears.length ? activeYears.reduce((acc, r) => acc + fn(r), 0) / activeYears.length : 0;
    const avgGrossCif = avg((r) => r.grossCif);
    const avgNetCif = avg((r) => r.netCif);
    const avgMonthlyCost = avg((r) => r.totalCost);

    let peak = yearlyRecords[0];
    for (const r of yearlyRecords) if (r.netCif > peak.netCif) peak = r;
    const age65 = yearlyRecords.find((r) => r.age === 65) || yearlyRecords[Math.min(yearlyRecords.length - 1, 10)];
    const age75 = yearlyRecords.find((r) => r.age === 75) || yearlyRecords[Math.min(yearlyRecords.length - 1, 20)];
    const fin = yearlyRecords[yearlyRecords.length - 1];

    return {
      yearlyRecords,
      monthlyRecords,
      summary: {
        avgGrossCif,
        avgNetCif,
        avgMonthlyCost,
        effectiveDeductionRate: avgGrossCif > 0 ? (avgMonthlyCost / avgGrossCif) * 100 : 0,
        peakAge: peak.age,
        peakNetCif: peak.netCif,
        peakGrossCif: peak.grossCif,
        age65NetCif: age65 ? age65.netCif : 0,
        age65GrossCif: age65 ? age65.grossCif : 0,
        age75NetCif: age75 ? age75.netCif : 0,
        finalFinancialBalance: fin.balances.financialTotal,
        finalHouseEquity: fin.balances.houseEquity,
        finalNetWorth: fin.balances.netWorth,
        finalFinancialBalanceReal: fin.balances.financialTotal / (isRealValue ? 1 : Math.pow(1 + inflationRate, totalYears - 1)),
        finalNetWorthReal: fin.balances.netWorth / (isRealValue ? 1 : Math.pow(1 + inflationRate, totalYears - 1)),
        targetEnabled: Boolean(target.enabled),
        autoAssetCount: autoOrder.length,
        shortfallYears,
        firstShortfallAge,
        totalShortfallAnnual,
      },
    };
  }

  // =========================================================================
  // 최적 조합 추천 (목표 CIF 충족 + 종료시점 잔여재산 최대화)
  // 탐색 변수: 자동조절 자산 인출 우선순위(순열), 국민연금 개시나이, 주택연금 가입 여부/개시나이
  // =========================================================================

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permutations(rest)) out.push([x].concat(p));
    });
    return out;
  }

  async function optimizeCombination(state, options = {}) {
    const onProgress = options.onProgress || (() => {});
    const keepManual = Boolean(options.keepManual);
    const base = JSON.parse(JSON.stringify(state));
    base.target = normalizeTarget(base);
    base.target.enabled = true;
    base.meta.valueMode = "nominal";

    let keys = AUTO_CAPABLE.filter((k) => base.assets[k].enabled);
    if (keepManual) {
      const autoKeys = keys.filter((k) => base.assets[k].cifMode === "auto");
      if (autoKeys.length > 0) keys = autoKeys;
    }
    if (keys.length === 0) {
      throw new Error("자동조절에 사용할 금융자산(DC/IRP/연금저축/개인연금/주식)이 활성화되어 있지 않습니다.");
    }
    for (const k of keys) base.assets[k].cifMode = "auto";

    const perms = permutations(keys);
    const npOpts = base.assets.nationalPension.enabled
      ? [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]
      : [null];
    const rmOpts = base.assets.housing.enabled
      ? [-1, 55, 60, 65, 70, 75, 80, 85]
      : [null];

    const objective = base.target.objective === "financial" ? "financial" : "netWorth";
    const cache = new Map();
    let evalCount = 0;

    const evaluate = (order, npAge, rm) => {
      const key = `${order.join(">")}|${npAge}|${rm}`;
      if (cache.has(key)) return cache.get(key);
      const st = JSON.parse(JSON.stringify(base));
      st.target.priorityOrder = normalizeOrder(order);
      if (npAge !== null) st.assets.nationalPension.startAge = npAge;
      if (rm !== null) {
        if (rm < 0) st.assets.housing.useReverseMortgage = false;
        else {
          st.assets.housing.useReverseMortgage = true;
          st.assets.housing.rmStartAge = rm;
        }
      }
      const sm = runSimulation(st, { lite: true }).summary;
      const wealth = objective === "financial" ? sm.finalFinancialBalance : sm.finalNetWorth;
      const item = {
        order: order.slice(),
        orderLabel: order.map((k) => AUTO_LABELS[k]).join(" → "),
        npAge,
        rm,
        wealth,
        finalFinancial: sm.finalFinancialBalance,
        finalNetWorth: sm.finalNetWorth,
        shortfallYears: sm.shortfallYears,
        firstShortfallAge: sm.firstShortfallAge,
        totalShortfall: sm.totalShortfallAnnual,
        // 목표 미달은 강한 페널티 (부족액 1백만원당 잔여재산 100백만원 차감)
        score: wealth - 100 * sm.totalShortfallAnnual,
      };
      cache.set(key, item);
      evalCount++;
      return item;
    };

    const yieldUI = () => new Promise((r) => setTimeout(r, 0));

    const curOrder = base.target.priorityOrder.filter((k) => keys.includes(k));
    const curNp = npOpts[0] === null ? null : num(base.assets.nationalPension.startAge, 65);
    const curRm = rmOpts[0] === null
      ? null
      : base.assets.housing.useReverseMortgage ? num(base.assets.housing.rmStartAge, 70) : -1;

    const baseline = evaluate(curOrder, curNp, curRm);
    let best = baseline;
    const totalPlanned = perms.length + npOpts.length * rmOpts.length;

    for (let round = 0; round < 3; round++) {
      let improved = false;
      let i = 0;
      for (const p of perms) {
        const it = evaluate(p, best.npAge, best.rm);
        if (it.score > best.score + 1e-6) { best = it; improved = true; }
        if (++i % 12 === 0) {
          onProgress(round, Math.min(99, Math.round((i / totalPlanned) * 100)), evalCount);
          await yieldUI();
        }
      }
      for (const npAge of npOpts) {
        for (const rm of rmOpts) {
          const it = evaluate(best.order, npAge, rm);
          if (it.score > best.score + 1e-6) { best = it; improved = true; }
          if (++i % 12 === 0) {
            onProgress(round, Math.min(99, Math.round((i / totalPlanned) * 100)), evalCount);
            await yieldUI();
          }
        }
      }
      if (!improved) break;
    }

    const top = [...cache.values()].sort((a, b) => b.score - a.score).slice(0, 8);
    return { best, baseline, top, evaluated: evalCount, keys, objective };
  }

  global.SimulatorEngine = {
    createDefaultState,
    getSamplePresets,
    estimateReverseMortgageMonthly,
    runSimulation,
    optimizeCombination,
    normalizeOrder,
    AUTO_CAPABLE,
    AUTO_LABELS,
    // 단위 테스트용 내부 계산 함수 (UI에서는 사용하지 않음)
    _internal: {
      calcPensionIncomeDeduction,
      calcProgressiveNationalIncomeTax,
      calcEarnedIncomeDeduction,
      calcNhisPropertyMonthly,
      calcMonthlyHousingPropertyTax,
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
