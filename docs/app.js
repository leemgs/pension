// -*- coding: utf-8 -*-
/**
 * 노후 현금흐름(CIF) 시뮬레이터 UI 컨트롤러 & 고해상도 캔버스 차트 렌더러
 */

(function () {
  "use strict";

  const STORAGE_KEY_LAST = "fi_cif_simulator_last_state_v1";
  const STORAGE_KEY_PRESETS = "fi_cif_simulator_presets_v1";

  const ASSET_COLORS = {
    salary: "#14b8a6",  // 근로소득 (틸/민트)
    np: "#3b82f6",      // 국민연금
    dc: "#06b6d4",      // 퇴직연금 DC
    irp: "#10b981",     // IRP
    ps: "#8b5cf6",      // 연금저축
    priv: "#6366f1",    // 개인연금
    stock: "#f59e0b",   // 주식투자액
    housing: "#ec4899", // 주택연금
  };

  let currentState = window.SimulatorEngine.createDefaultState();
  let savedPresets = [];
  let latestSimResult = null;
  let serverAvailable = false;
  let saveTimer = null;
  let showHouseInBalanceChart = false;

  // 아코디언 열림 상태 기억
  const collapsedCardMap = {
    earnedIncome: false,
    nationalPension: false,
    dcPension: false,
    irp: true,
    pensionSavings: true,
    privatePension: false,
    stockPortfolio: false,
    housing: false,
  };

  // 포맷팅 유틸리티 (백만원 -> 읽기 쉬운 문자열)
  function fmtMillion(val, digits = 2) {
    const num = Number(val) || 0;
    return num.toFixed(digits);
  }

  function fmtKoreanMoneyHint(millionVal) {
    const num = Number(millionVal) || 0;
    const manwon = Math.round(num * 100); // 1백만원 = 100만원
    if (Math.abs(manwon) === 0) return "0원";
    if (Math.abs(manwon) >= 10000) {
      const eok = Math.floor(Math.abs(manwon) / 10000);
      const remMan = Math.abs(manwon) % 10000;
      const sign = manwon < 0 ? "-" : "";
      return remMan > 0
        ? `${sign}${eok}억 ${remMan.toLocaleString()}만원`
        : `${sign}${eok}억원`;
    }
    return `${manwon.toLocaleString()}만원`;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // 기본 상태와 병합하여 누락된 필드 보완
  function mergeWithDefaultState(loaded) {
    const def = window.SimulatorEngine.createDefaultState();
    if (!loaded || typeof loaded !== "object") return def;
    const target = loaded.state ? loaded.state : loaded;

    if (target.meta) Object.assign(def.meta, target.meta);
    if (target.target) Object.assign(def.target, target.target);
    def.target.priorityOrder = window.SimulatorEngine.normalizeOrder(
      def.target.priorityOrder
    );
    if (target.taxConfig) Object.assign(def.taxConfig, target.taxConfig);
    if (target.assets) {
      for (const key of Object.keys(def.assets)) {
        if (target.assets[key]) {
          Object.assign(def.assets[key], target.assets[key]);
        }
      }
    }
    return def;
  }

  // 저장 상태 표시 배지 업데이트
  function setSaveStatus(text, isSaving = false) {
    const el = document.getElementById("saveStatusText");
    const badge = document.getElementById("saveStatusBadge");
    if (!el || !badge) return;
    el.textContent = text;
    if (isSaving) {
      badge.style.color = "#f59e0b";
      badge.style.borderColor = "rgba(245, 158, 11, 0.4)";
    } else {
      badge.style.color = "#10b981";
      badge.style.borderColor = "rgba(16, 185, 129, 0.35)";
    }
  }

  // 초기 데이터 부트스트랩 (서버 API -> embedded_state.js -> localStorage -> 기본값 순)
  async function bootstrapStateAndPresets() {
    let loadedLast = null;
    let loadedPresets = null;

    // 1) 로컬 Python 서버 API 시도
    try {
      if (location.protocol === "file:") throw new Error("file protocol: no server");
      const res = await fetch("/api/bootstrap", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok) {
          serverAvailable = true;
          if (data.lastState) loadedLast = data.lastState;
          if (Array.isArray(data.presets) && data.presets.length > 0) {
            loadedPresets = data.presets;
          }
        }
      }
    } catch (_) {
      serverAvailable = false;
    }

    // 2) data/embedded_state.js (단독 HTML 실행 또는 다른 PC 이동 직후)
    if (!loadedLast && window.__PORTABLE_STORAGE__) {
      if (window.__PORTABLE_STORAGE__.lastState) {
        loadedLast = window.__PORTABLE_STORAGE__.lastState;
      }
      if (
        !loadedPresets &&
        Array.isArray(window.__PORTABLE_STORAGE__.presets) &&
        window.__PORTABLE_STORAGE__.presets.length > 0
      ) {
        loadedPresets = window.__PORTABLE_STORAGE__.presets;
      }
    }

    // 3) 브라우저 localStorage 확인
    try {
      const localRaw = localStorage.getItem(STORAGE_KEY_LAST);
      if (localRaw) {
        const parsedLocal = JSON.parse(localRaw);
        // 서버/파일 상태보다 최신이거나 서버 상태가 없으면 사용
        if (
          !loadedLast ||
          (parsedLocal.updatedAt &&
            loadedLast.updatedAt &&
            parsedLocal.updatedAt > loadedLast.updatedAt)
        ) {
          loadedLast = parsedLocal;
        }
      }
      if (!loadedPresets) {
        const localPresetsRaw = localStorage.getItem(STORAGE_KEY_PRESETS);
        if (localPresetsRaw) {
          const parsedP = JSON.parse(localPresetsRaw);
          if (Array.isArray(parsedP) && parsedP.length > 0) {
            loadedPresets = parsedP;
          }
        }
      }
    } catch (_) { }

    if (loadedLast) {
      currentState = mergeWithDefaultState(loadedLast);
    } else {
      currentState = window.SimulatorEngine.createDefaultState();
    }

    if (loadedPresets && loadedPresets.length > 0) {
      savedPresets = loadedPresets;
    } else {
      savedPresets = window.SimulatorEngine.getSamplePresets();
      // 서버가 켜져 있으면 샘플 프리셋과 초기 상태를 서버 파일에도 최초 기록
      if (serverAvailable) {
        try {
          await fetch("/api/presets/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lastState: currentState,
              presets: savedPresets,
            }),
          });
        } catch (_) { }
      }
    }

    saveToLocalStorageOnly();
    setSaveStatus(
      serverAvailable
        ? "마지막 세팅 복원됨 (폴더 자동저장 활성)"
        : "마지막 세팅 복원됨 (브라우저 저장 활성)"
    );
  }

  function saveToLocalStorageOnly() {
    try {
      const wrapper = {
        updatedAt: new Date().toISOString(),
        state: currentState,
      };
      localStorage.setItem(STORAGE_KEY_LAST, JSON.stringify(wrapper));
      localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(savedPresets));
    } catch (_) { }
  }

  // 상태 변경 시 자동 저장 (디바운스)
  function scheduleAutoSave() {
    saveToLocalStorageOnly();
    setSaveStatus("변경사항 저장 중...", true);

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (serverAvailable) {
        try {
          const res = await fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: currentState }),
          });
          if (res.ok) {
            const nowStr = new Date().toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            setSaveStatus(`자동 저장됨 (${nowStr})`);
            return;
          }
        } catch (_) { }
      }
      setSaveStatus("자동 저장됨 (로컬)");
    }, 250);
  }

  // 창 종료 직전 마지막 세팅 즉시 전송 보장
  window.addEventListener("beforeunload", () => {
    saveToLocalStorageOnly();
    if (serverAvailable && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({ state: currentState })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/state", blob);
    }
  });

  // =========================================================================
  // UI 컨트롤 생성 헬퍼
  // =========================================================================

  function createSliderNumberRow({
    label,
    value,
    min,
    max,
    step,
    unit,
    isMoney = false,
    syncRole = "",
    onChange,
  }) {
    const wrap = document.createElement("div");
    wrap.className = "control-row";

    const labelLine = document.createElement("div");
    labelLine.className = "control-label-line";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = label;

    const hintSpan = document.createElement("span");
    hintSpan.className = "control-hint";
    const updateHint = (v) => {
      if (isMoney) {
        hintSpan.textContent = fmtKoreanMoneyHint(v);
      } else {
        hintSpan.textContent = `${v}${unit}`;
      }
    };
    updateHint(value);

    labelLine.appendChild(titleSpan);
    labelLine.appendChild(hintSpan);

    const inputsRow = document.createElement("div");
    inputsRow.className = "control-inputs";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);

    const numWrap = document.createElement("div");
    numWrap.className = "num-input-wrap";

    const numInput = document.createElement("input");
    numInput.type = "number";
    numInput.className = "num-input";
    numInput.step = String(step);
    numInput.value = String(value);

    const suffix = document.createElement("span");
    suffix.className = "unit-suffix";
    suffix.textContent = unit;

    numWrap.appendChild(numInput);
    numWrap.appendChild(suffix);

    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      numInput.value = String(v);
      updateHint(v);
      onChange(v);
    });

    numInput.addEventListener("input", () => {
      const v = Number(numInput.value);
      if (!Number.isNaN(v)) {
        slider.value = String(Math.max(min, Math.min(max, v)));
        updateHint(v);
        onChange(v);
      }
    });

    inputsRow.appendChild(slider);
    inputsRow.appendChild(numWrap);

    if (syncRole) {
      wrap.dataset.syncRole = syncRole;
    }
    wrap._setTitle = (newLabel) => {
      titleSpan.textContent = newLabel;
    };
    wrap._setValue = (newVal) => {
      slider.value = String(newVal);
      numInput.value = String(newVal);
      updateHint(newVal);
    };
    wrap.appendChild(labelLine);
    wrap.appendChild(inputsRow);
    return wrap;
  }

  function createSelectRow({ label, value, options, onChange }) {
    const wrap = document.createElement("div");
    wrap.className = "control-row";

    const labelLine = document.createElement("div");
    labelLine.className = "control-label-line";
    const titleSpan = document.createElement("span");
    titleSpan.textContent = label;
    labelLine.appendChild(titleSpan);

    const select = document.createElement("select");
    select.className = "select-input";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (String(opt.value) === String(value)) o.selected = true;
      select.appendChild(o);
    }

    select.addEventListener("change", () => {
      onChange(select.value);
    });

    wrap.appendChild(labelLine);
    wrap.appendChild(select);
    return wrap;
  }

  function createCheckboxRow({ label, checked, onChange }) {
    const row = document.createElement("label");
    row.className = "checkbox-row";
    row.style.cursor = "pointer";

    const span = document.createElement("span");
    span.textContent = label;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = Boolean(checked);
    chk.addEventListener("change", () => {
      onChange(chk.checked);
    });

    row.appendChild(span);
    row.appendChild(chk);
    return row;
  }

  // =========================================================================
  // 좌측 패널 렌더링 (프리셋, 글로벌 설정, 7대 자산 카드)
  // =========================================================================

  function renderPresetList() {
    const container = document.getElementById("presetListContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!savedPresets || savedPresets.length === 0) {
      const empty = document.createElement("div");
      empty.style.fontSize = "12px";
      empty.style.color = "#94a3b8";
      empty.textContent = "저장된 상태가 없습니다. 위 입력창에 이름을 넣고 저장해 보세요.";
      container.appendChild(empty);
      return;
    }

    for (const preset of savedPresets) {
      const item = document.createElement("div");
      item.className = "preset-item";

      const info = document.createElement("div");
      info.className = "preset-info";
      info.title = "클릭하면 이 상태 조합을 불러옵니다.";

      const nameEl = document.createElement("div");
      nameEl.className = "preset-name";
      nameEl.textContent = preset.name;

      const descEl = document.createElement("div");
      descEl.className = "preset-desc";
      descEl.textContent = preset.description || "저장된 시뮬레이션 상태 조합";

      info.appendChild(nameEl);
      info.appendChild(descEl);

      info.addEventListener("click", () => {
        currentState = mergeWithDefaultState(deepClone(preset.state));
        rebuildAllControls();
        recalculateAndRender();
        scheduleAutoSave();
        setSaveStatus(`'${preset.name}' 불러옴`);
      });

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "4px";

      const loadBtn = document.createElement("button");
      loadBtn.className = "btn";
      loadBtn.style.padding = "4px 8px";
      loadBtn.style.fontSize = "11.5px";
      loadBtn.textContent = "불러오기";
      loadBtn.addEventListener("click", () => info.click());

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger";
      delBtn.style.padding = "4px 7px";
      delBtn.style.fontSize = "11.5px";
      delBtn.textContent = "✕";
      delBtn.title = "이 프리셋 삭제";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await handleDeletePreset(preset.name);
      });

      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);

      item.appendChild(info);
      item.appendChild(actions);
      container.appendChild(item);
    }
  }

  async function handleSavePreset() {
    const nameInput = document.getElementById("presetNameInput");
    const descInput = document.getElementById("presetDescInput");
    const name = (nameInput.value || "").trim();
    const description = (descInput.value || "").trim();

    if (!name) {
      alert("저장할 시나리오(상태) 이름을 입력해 주세요.");
      nameInput.focus();
      return;
    }

    const newPreset = {
      name,
      description:
        description ||
        `${currentState.meta.currentAge}세~${currentState.meta.endAge}세 | ${new Date().toLocaleDateString("ko-KR")}`,
      updatedAt: new Date().toISOString(),
      state: deepClone(currentState),
    };

    const existingIdx = savedPresets.findIndex((p) => p.name === name);
    if (existingIdx >= 0) {
      savedPresets[existingIdx] = newPreset;
    } else {
      savedPresets.unshift(newPreset);
    }

    if (serverAvailable) {
      try {
        const res = await fetch("/api/presets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newPreset),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.presets) savedPresets = d.presets;
        }
      } catch (_) { }
    }

    saveToLocalStorageOnly();
    renderPresetList();
    nameInput.value = "";
    descInput.value = "";
    setSaveStatus(`'${name}' 상태 저장 완료`);
  }

  async function handleDeletePreset(name) {
    savedPresets = savedPresets.filter((p) => p.name !== name);
    if (serverAvailable) {
      try {
        const res = await fetch(
          `/api/presets?name=${encodeURIComponent(name)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          const d = await res.json();
          if (d.presets) savedPresets = d.presets;
        }
      } catch (_) { }
    }
    saveToLocalStorageOnly();
    renderPresetList();
    setSaveStatus(`'${name}' 삭제됨`);
  }

  // 기본 환경 및 세법 컨트롤 렌더링
  function renderGlobalConfig() {
    const container = document.getElementById("globalConfigContainer");
    if (!container) return;
    container.innerHTML = "";

    const meta = currentState.meta;
    const tax = currentState.taxConfig;

    container.appendChild(
      createSliderNumberRow({
        label: "현재 나이 (시뮬레이션 시작)",
        value: meta.currentAge,
        min: 25,
        max: 85,
        step: 1,
        unit: "세",
        onChange: (v) => {
          meta.currentAge = v;
          if (meta.endAge <= v) meta.endAge = v + 10;
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    container.appendChild(
      createSliderNumberRow({
        label: "시뮬레이션 종료 나이",
        value: meta.endAge,
        min: 65,
        max: 110,
        step: 1,
        unit: "세",
        onChange: (v) => {
          meta.endAge = Math.max(meta.currentAge + 1, v);
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    container.appendChild(
      createSliderNumberRow({
        label: "연평균 물가상승률 (인플레이션)",
        value: meta.inflationRate,
        min: 0.0,
        max: 8.0,
        step: 0.1,
        unit: "%",
        onChange: (v) => {
          meta.inflationRate = v;
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    container.appendChild(
      createSelectRow({
        label: "사적연금 연 1,500만원 초과 시 과세 방식",
        value: tax.privatePensionOver15MMode,
        options: [
          {
            value: "auto",
            label: "자동 비교 선택 (16.5% 분리과세 vs 종합과세 중 유리한 쪽)",
          },
          { value: "separate_165", label: "16.5% 분리과세로 고정" },
          { value: "comprehensive", label: "종합소득 합산과세로 고정" },
        ],
        onChange: (v) => {
          tax.privatePensionOver15MMode = v;
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    container.appendChild(
      createCheckboxRow({
        label: "배우자 인적공제(연 150만원) 적용",
        checked: tax.hasSpouseDeduction,
        onChange: (v) => {
          tax.hasSpouseDeduction = v;
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    container.appendChild(
      createCheckboxRow({
        label: "거주주택 보유 재산세를 월 발생비용에 반영",
        checked: tax.includePropertyTaxInCost,
        onChange: (v) => {
          tax.includePropertyTaxInCost = v;
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    container.appendChild(
      createCheckboxRow({
        label: "지역건보료 산정 시 사적연금(50%)도 포함 (현행은 공적연금만 부과)",
        checked: tax.includePrivatePensionInNHIS,
        onChange: (v) => {
          tax.includePrivatePensionInNHIS = v;
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );
  }

  // 계좌형 연금(퇴직DC, IRP, 연금저축, 개인연금)의 인출방식별 하위 컨트롤 추가 헬퍼
  function appendCifModeSelect(bodyEl, assetObj, onReRenderCard) {
    bodyEl.appendChild(
      createSelectRow({
        label: "CIF 결정 방식",
        value: assetObj.cifMode || "manual",
        options: [
          { value: "manual", label: "직접 설정 (고정) — 아래 인출 방식대로 수령" },
          { value: "auto", label: "목표 CIF 자동조절 — 부족분을 우선순위대로 채움" },
        ],
        onChange: (v) => {
          assetObj.cifMode = v;
          onReRenderCard();
          renderTargetPanel();
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );
    const isAuto = assetObj.cifMode === "auto";
    if (isAuto) {
      const note = document.createElement("div");
      note.className = "auto-note";
      note.textContent = currentState.target.enabled
        ? "🎯 자동조절 중: 개시 나이부터 목표 CIF 부족분만큼 우선순위에 따라 인출합니다. (개별 인출 설정은 무시됨)"
        : "⚠ 자동조절로 지정됐지만 🎯 목표 CIF가 꺼져 있어 아래 '직접 설정' 값이 적용됩니다.";
      bodyEl.appendChild(note);
    }
    return isAuto && currentState.target.enabled;
  }

  function appendWithdrawalSubControls(bodyEl, assetObj, onReRenderCard) {
    if (appendCifModeSelect(bodyEl, assetObj, onReRenderCard)) return;

    bodyEl.appendChild(
      createSelectRow({
        label: "연금 인출(수령) 방식",
        value: assetObj.withdrawalMode,
        options: [
          { value: "period", label: "기간 분할 수령 (지정 연수 동안 원리금 균등 인출)" },
          { value: "fixed", label: "월 정액 인출 (잔액 소진 시까지 매월 일정액)" },
          { value: "rate", label: "연 정률 인출 (매년 잔액의 일정 % 인출)" },
          { value: "income_only", label: "운용·배당수익만 인출 (원금 보존형)" },
        ],
        onChange: (v) => {
          assetObj.withdrawalMode = v;
          onReRenderCard();
          recalculateAndRender();
          scheduleAutoSave();
        },
      })
    );

    if (assetObj.withdrawalMode === "period") {
      bodyEl.appendChild(
        createSliderNumberRow({
          label: "수령 기간 (분할 지급 연수)",
          value: assetObj.payoutYears,
          min: 5,
          max: 45,
          step: 1,
          unit: "년",
          onChange: (v) => {
            assetObj.payoutYears = v;
            recalculateAndRender();
            scheduleAutoSave();
          },
        })
      );
    } else if (assetObj.withdrawalMode === "fixed") {
      bodyEl.appendChild(
        createSliderNumberRow({
          label: "희망 월 정액 인출액 (백만원)",
          value: assetObj.fixedMonthly,
          min: 0.1,
          max: 10.0,
          step: 0.05,
          unit: "백만",
          isMoney: true,
          onChange: (v) => {
            assetObj.fixedMonthly = v;
            recalculateAndRender();
            scheduleAutoSave();
          },
        })
      );
      bodyEl.appendChild(
        createCheckboxRow({
          label: "정액 인출액을 매년 물가상승률만큼 증액",
          checked: assetObj.inflateFixed,
          onChange: (v) => {
            assetObj.inflateFixed = v;
            recalculateAndRender();
            scheduleAutoSave();
          },
        })
      );
    } else if (assetObj.withdrawalMode === "rate") {
      bodyEl.appendChild(
        createSliderNumberRow({
          label: "연간 잔액 대비 인출 비율 (%)",
          value: assetObj.withdrawalRate,
          min: 1.0,
          max: 20.0,
          step: 0.2,
          unit: "%",
          onChange: (v) => {
            assetObj.withdrawalRate = v;
            recalculateAndRender();
            scheduleAutoSave();
          },
        })
      );
    }
  }

  // =========================================================================
  // 🎯 목표 CIF 패널 (자동조절 우선순위 + 최적 조합 추천)
  // =========================================================================

  let lastOptResult = null;
  let optRunning = false;

  // 목표 CIF 적용 시작 나이 변경 시 전체 연금 개시 나이 자동 동기화 (DOM 재생성 없이 In-place 업데이트)
  function syncPensionStartAgesWithTarget(targetAge) {
    const assets = currentState.assets;
    if (!assets) return;

    currentState.target.startAge = targetAge;
    if (assets.dcPension) assets.dcPension.startAge = targetAge;
    if (assets.irp) assets.irp.startAge = targetAge;
    if (assets.pensionSavings) assets.pensionSavings.startAge = targetAge;
    if (assets.privatePension) assets.privatePension.startAge = targetAge;
    if (assets.stockPortfolio) assets.stockPortfolio.startAge = targetAge;

    // 화면에 이미 렌더링된 모든 연동 개시나이 슬라이더를 DOM 파괴 없이 즉시 값만 갱신
    document.querySelectorAll('[data-sync-role="linked-start-age"]').forEach((rowEl) => {
      if (typeof rowEl._setValue === "function") {
        rowEl._setValue(targetAge);
      }
    });

    // 목표 CIF 패널의 우선순위 리스트 내 나이 텍스트도 In-place 갱신
    const LABELS = window.SimulatorEngine.AUTO_LABELS;
    document.querySelectorAll("[data-priority-txt-key]").forEach((spanEl) => {
      const k = spanEl.dataset.priorityTxtKey;
      const a = assets[k];
      if (a && LABELS[k]) {
        spanEl.textContent = `${LABELS[k]}${a.enabled ? "" : " (비활성)"} · ${a.startAge}세부터`;
      }
    });

    updateAssetBadges();
  }

  function renderTargetPanel() {
    const container = document.getElementById("targetConfigContainer");
    if (!container) return;
    container.innerHTML = "";
    const t = currentState.target;
    const assets = currentState.assets;
    const LABELS = window.SimulatorEngine.AUTO_LABELS;

    const onChangeRecalc = () => {
      recalculateAndRender();
      scheduleAutoSave();
    };

    container.appendChild(
      createCheckboxRow({
        label: "목표 CIF 자동조절 켜기 (부족분을 '자동조절' 자산에서 자동 인출)",
        checked: t.enabled,
        onChange: (v) => {
          t.enabled = v;
          renderTargetPanel();
          renderAssetCards();
          onChangeRecalc();
        },
      })
    );

    container.appendChild(
      createSliderNumberRow({
        label: "목표 월 현금흐름 (백만원/월)",
        value: t.netMonthly,
        min: 0.5,
        max: 20,
        step: 0.1,
        unit: "백만",
        isMoney: true,
        onChange: (v) => {
          t.netMonthly = v;
          onChangeRecalc();
        },
      })
    );

    container.appendChild(
      createSelectRow({
        label: "목표 기준",
        value: `${t.measure}|${t.basis}`,
        options: [
          { value: "net|real", label: "세후 실수령 · 현재가치(매년 물가만큼 증액)" },
          { value: "net|nominal", label: "세후 실수령 · 명목 고정액" },
          { value: "gross|real", label: "세전 총액 · 현재가치(매년 물가만큼 증액)" },
          { value: "gross|nominal", label: "세전 총액 · 명목 고정액" },
        ],
        onChange: (v) => {
          const [m, b] = v.split("|");
          t.measure = m;
          t.basis = b;
          onChangeRecalc();
        },
      })
    );

    container.appendChild(
      createSliderNumberRow({
        label: "목표 CIF 적용 시작 나이 (전체 연금 개시나이 자동 연동)",
        value: t.startAge,
        min: 45,
        max: 80,
        step: 1,
        unit: "세",
        syncRole: "linked-start-age",
        onChange: (v) => {
          t.startAge = v;
          syncPensionStartAgesWithTarget(v);
          onChangeRecalc();
        },
      })
    );

    // 자동조절 자산 및 인출 우선순위
    const prTitle = document.createElement("div");
    prTitle.className = "control-label-line";
    prTitle.innerHTML =
      "<span>자동조절 인출 우선순위 (체크 = 자동조절, 해제 = 직접 설정 고정)</span>";
    container.appendChild(prTitle);

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "4px";

    t.priorityOrder.forEach((key, idx) => {
      const a = assets[key];
      const isAuto = a.cifMode === "auto";
      const row = document.createElement("div");
      row.className = `priority-item ${isAuto && a.enabled ? "" : "is-manual"}`;

      const rank = document.createElement("span");
      rank.className = "priority-rank";
      rank.textContent = String(idx + 1);

      const lbl = document.createElement("label");
      lbl.style.display = "flex";
      lbl.style.alignItems = "center";
      lbl.style.gap = "6px";
      lbl.style.cursor = "pointer";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = isAuto;
      chk.disabled = !a.enabled;
      chk.addEventListener("change", () => {
        a.cifMode = chk.checked ? "auto" : "manual";
        renderTargetPanel();
        renderAssetCards();
        onChangeRecalc();
      });
      const txt = document.createElement("span");
      txt.dataset.priorityTxtKey = key;
      txt.textContent = `${LABELS[key]}${a.enabled ? "" : " (비활성)"} · ${a.startAge}세부터`;
      lbl.appendChild(chk);
      lbl.appendChild(txt);

      const up = document.createElement("button");
      up.className = "mini-btn";
      up.textContent = "▲";
      up.disabled = idx === 0;
      up.addEventListener("click", () => {
        const arr = t.priorityOrder;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        renderTargetPanel();
        onChangeRecalc();
      });
      const down = document.createElement("button");
      down.className = "mini-btn";
      down.textContent = "▼";
      down.disabled = idx === t.priorityOrder.length - 1;
      down.addEventListener("click", () => {
        const arr = t.priorityOrder;
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        renderTargetPanel();
        onChangeRecalc();
      });

      row.appendChild(rank);
      row.appendChild(lbl);
      row.appendChild(up);
      row.appendChild(down);
      list.appendChild(row);
    });
    container.appendChild(list);

    const hint = document.createElement("div");
    hint.className = "control-hint";
    hint.style.fontWeight = "500";
    hint.style.color = "#94a3b8";
    hint.textContent =
      "국민연금·주택연금·'고정' 자산을 먼저 반영한 뒤, 목표에 모자라는 금액(세금·건보료 증가분 포함)을 1순위부터 꺼내 씁니다. 잔고가 바닥나면 다음 순위로 넘어갑니다.";
    container.appendChild(hint);

    // 최적 조합 추천
    container.appendChild(
      createSelectRow({
        label: "추천 기준 (종료 나이 시점 잔여재산 최대화)",
        value: t.objective,
        options: [
          { value: "netWorth", label: "금융자산 + 주택 순자산(시세 − 주택연금 대출잔액)" },
          { value: "financial", label: "금융자산만" },
        ],
        onChange: (v) => {
          t.objective = v;
          scheduleAutoSave();
        },
      })
    );

    let keepManual = false;
    container.appendChild(
      createCheckboxRow({
        label: "추천 시 '고정'으로 둔 자산은 그대로 유지",
        checked: keepManual,
        onChange: (v) => {
          keepManual = v;
        },
      })
    );

    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.style.justifyContent = "center";
    btn.textContent = optRunning ? "⏳ 계산 중..." : "🔍 최적 조합 추천 실행";
    btn.disabled = optRunning;
    container.appendChild(btn);

    const resultBox = document.createElement("div");
    resultBox.className = "opt-result";
    container.appendChild(resultBox);
    if (lastOptResult) renderOptResult(resultBox, lastOptResult);

    btn.addEventListener("click", async () => {
      if (optRunning) return;
      optRunning = true;
      btn.disabled = true;
      btn.textContent = "⏳ 계산 중... 0%";
      try {
        const res = await window.SimulatorEngine.optimizeCombination(currentState, {
          keepManual,
          onProgress: (round, pct, n) => {
            btn.textContent = `⏳ 계산 중... ${round + 1}회차 ${pct}% (${n}개 조합)`;
          },
        });
        lastOptResult = res;
      } catch (err) {
        alert(err.message);
      } finally {
        optRunning = false;
        renderTargetPanel();
      }
    });
  }

  function describeCombo(it) {
    const np = it.npAge === null ? "" : `국민연금 ${it.npAge}세`;
    const rm =
      it.rm === null ? "" : it.rm < 0 ? "주택연금 미가입" : `주택연금 ${it.rm}세`;
    return [it.orderLabel, np, rm].filter(Boolean).join(" | ");
  }

  function renderOptResult(box, res) {
    box.innerHTML = "";
    const head = document.createElement("div");
    head.style.fontSize = "11.5px";
    head.style.color = "#cbd5e1";
    const gain = res.best.wealth - res.baseline.wealth;
    head.innerHTML = `총 <b>${res.evaluated}</b>개 조합 계산 · 잔여재산은 종료 나이 시점 <b>명목</b>값<br/>현재 설정(자동조절 적용) 대비 <b style="color:#10b981">${gain >= 0 ? "+" : ""}${fmtKoreanMoneyHint(gain)}</b>`;
    box.appendChild(head);

    // 추천 상위 5개 + (순위 밖이면) 현재 설정
    const ordered = res.top.slice(0, 5);
    if (!ordered.includes(res.baseline)) ordered.push(res.baseline);

    ordered.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = `opt-row ${it === res.best ? "best" : ""}`;
      const info = document.createElement("div");
      const tag = it === res.best ? "⭐ 추천" : it === res.baseline ? "현재 설정" : `${i + 1}위`;
      const sf =
        it.shortfallYears > 0
          ? `<span style="color:#f43f5e">목표 미달 ${it.shortfallYears}년 (${it.firstShortfallAge}세~)</span>`
          : `<span style="color:#10b981">목표 전 기간 충족</span>`;
      info.innerHTML = `<b>${tag}</b> · 잔여 ${fmtKoreanMoneyHint(it.wealth)} · ${sf}<br/><span style="color:#94a3b8">${describeCombo(it)}</span>`;
      const apply = document.createElement("button");
      apply.className = "mini-btn";
      apply.textContent = "적용";
      apply.addEventListener("click", () => applyCombo(it, res.keys));
      row.appendChild(info);
      row.appendChild(apply);
      box.appendChild(row);
    });
  }

  function applyCombo(it, keys) {
    const st = currentState;
    st.target.enabled = true;
    for (const k of keys) st.assets[k].cifMode = "auto";
    st.target.priorityOrder = window.SimulatorEngine.normalizeOrder(it.order);
    if (it.npAge !== null) st.assets.nationalPension.startAge = it.npAge;
    if (it.rm !== null) {
      if (it.rm < 0) st.assets.housing.useReverseMortgage = false;
      else {
        st.assets.housing.useReverseMortgage = true;
        st.assets.housing.rmStartAge = it.rm;
      }
    }
    rebuildAllControls();
    recalculateAndRender();
    scheduleAutoSave();
    setSaveStatus("추천 조합 적용됨");
  }

  // 7대 자산 카드 전체 생성
  function renderAssetCards() {
    const container = document.getElementById("assetCardsContainer");
    if (!container) return;
    container.innerHTML = "";

    const assets = currentState.assets;

    const cardDefs = [
      {
        key: "earnedIncome",
        title: "0. 근로소득 (은퇴 전·재취업 급여)",
        color: ASSET_COLORS.salary,
        badgeFn: (a) =>
          `${a.startAge}세부터 ${a.workYears}년 동안 · 월 ${fmtKoreanMoneyHint(a.monthlyGrossSalary)}(세전)`,
        buildBody: (body, a, rerender) => {
          const infoBox = document.createElement("div");
          infoBox.style.cssText =
            "margin-top: 6px; padding: 8px 10px; background: rgba(20, 184, 166, 0.08); border: 1px solid rgba(20, 184, 166, 0.3); border-radius: 6px; font-size: 11.5px; line-height: 1.5; color: #cbd5e1;";
          const updateSalaryInfoBox = () => {
            const gross = Number(a.monthlyGrossSalary) || 0;
            const salCalc = window.SimulatorEngine.calcEarnedIncomeMonthly
              ? window.SimulatorEngine.calcEarnedIncomeMonthly(gross, 1.5)
              : { netMonthly: gross * 0.82, fourMajorTotal: gross * 0.09, taxMonthly: gross * 0.09 };
            infoBox.innerHTML = `
              <div style="font-weight: 700; color: #5eead4; margin-bottom: 2px;">💡 급여 실수령액 및 공제 자동계산</div>
              <div>• 세전 월급: <b>${fmtKoreanMoneyHint(gross)}</b></div>
              <div>• 4대보험(근로자분): <b style="color: #fda4af;">-${fmtKoreanMoneyHint(salCalc.fourMajorTotal)}</b></div>
              <div>• 소득세/지방세: <b style="color: #fda4af;">-${fmtKoreanMoneyHint(salCalc.taxMonthly)}</b></div>
              <div style="margin-top: 2px; padding-top: 2px; border-top: 1px dashed rgba(20, 184, 166, 0.3); font-weight: 800; color: #38bdf8;">
                • 월 세후 실수령: ${fmtKoreanMoneyHint(salCalc.netMonthly)} / 월
              </div>
              <div style="font-size: 10.5px; color: #94a3b8; margin-top: 2px;">
                * 근로 기간에는 직장 4대보험이 적용되어 지역건보료가 부과되지 않습니다.
              </div>
            `;
          };

          body.appendChild(
            createSliderNumberRow({
              label: "근로 시작 나이 (현재 연령 기준)",
              value: a.startAge,
              min: 20,
              max: 75,
              step: 1,
              unit: "세",
              onChange: (v) => {
                a.startAge = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "근로 기간 (몇 년 동안)",
              value: a.workYears,
              min: 1,
              max: 30,
              step: 1,
              unit: "년",
              onChange: (v) => {
                a.workYears = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "세전 월 급여 (백만원)",
              value: a.monthlyGrossSalary,
              min: 0.5,
              max: 30.0,
              step: 0.1,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.monthlyGrossSalary = v;
                updateSalaryInfoBox();
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          updateSalaryInfoBox();
          body.appendChild(infoBox);
        },
      },
      {
        key: "nationalPension",
        title: "1. 국민연금 (공적연금)",
        color: ASSET_COLORS.np,
        badgeFn: (a) => `${a.startAge}세 개시 · 월 ${fmtKoreanMoneyHint(a.monthlyAmountAtStart)}`,
        buildBody: (body, a, rerender) => {
          body.appendChild(
            createSliderNumberRow({
              label: "수령 개시 나이 (조기 60~64세 / 기본 65세 / 연기 66~70세)",
              value: a.startAge,
              min: 60,
              max: 70,
              step: 1,
              unit: "세",
              onChange: (v) => {
                a.startAge = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "기준 개시시점 예상 월 수령액 (현재가치 백만원)",
              value: a.monthlyAmountAtStart,
              min: 0.1,
              max: 4.5,
              step: 0.05,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.monthlyAmountAtStart = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createCheckboxRow({
              label: "65세 대비 조기감액(-6%/년)·연기증액(+7.2%/년) 자동 반영",
              checked: a.applyDeferralRule,
              onChange: (v) => {
                a.applyDeferralRule = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createCheckboxRow({
              label: "매년 물가상승률 연동 인상 적용",
              checked: a.linkToInflation,
              onChange: (v) => {
                a.linkToInflation = v;
                rerender();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          if (!a.linkToInflation) {
            body.appendChild(
              createSliderNumberRow({
                label: "연평균 연금액 인상률 직접 지정 (%)",
                value: a.customGrowthRate,
                min: 0.0,
                max: 6.0,
                step: 0.1,
                unit: "%",
                onChange: (v) => {
                  a.customGrowthRate = v;
                  recalculateAndRender();
                  scheduleAutoSave();
                },
              })
            );
          }
          body.appendChild(
            createSliderNumberRow({
              label: "과세대상 연금소득 비중 (2002년 이후 납입분 비율)",
              value: a.taxableRatio,
              min: 0,
              max: 100,
              step: 5,
              unit: "%",
              onChange: (v) => {
                a.taxableRatio = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
        },
      },
      {
        key: "dcPension",
        title: "2. 퇴직연금 DC",
        color: ASSET_COLORS.dc,
        badgeFn: (a) =>
          `현재 ${fmtKoreanMoneyHint(a.currentBalance)} · ${a.startAge}세 개시`,
        buildBody: (body, a, rerender) => {
          body.appendChild(
            createSliderNumberRow({
              label: "현재 DC 계좌 평가액 (백만원)",
              value: a.currentBalance,
              min: 0,
              max: 1500,
              step: 5,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.currentBalance = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          // 포트폴리오 가중 총 수익률 안내 박스 (In-place 갱신용)
          const dcSummaryBox = document.createElement("div");
          dcSummaryBox.style.cssText = "margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 6px; font-size: 11px; color: #a5f3fc;";
          const updateWeightedSummary = () => {
            const gRatioVal = a.growthRatio !== undefined ? a.growthRatio : 60;
            const dRatioVal = 100 - gRatioVal;
            const gRateVal = a.growthReturnRate !== undefined ? a.growthReturnRate : 5.0;
            const dRateVal = a.dividendReturnRate !== undefined ? a.dividendReturnRate : 3.5;
            a.returnRate = Number(((gRatioVal / 100.0) * gRateVal).toFixed(2));
            a.dividendRate = Number(((dRatioVal / 100.0) * dRateVal).toFixed(2));
            const totRet = ((gRatioVal * gRateVal + dRatioVal * dRateVal) / 100).toFixed(2);
            dcSummaryBox.innerHTML = `📊 포트폴리오 가중 총 운용수익률: <b>연 ${totRet}%</b> (성장 ${gRatioVal}% × ${gRateVal}% + 배당 ${dRatioVal}% × ${dRateVal}%)`;
          };

          // 성장형 vs 배당형 비중 및 수익률 슬라이더
          const growthSliderRow = createSliderNumberRow({
            label: `성장형 비중 (%) [배당형 비중은 자동 ${100 - (a.growthRatio !== undefined ? a.growthRatio : 60)}%]`,
            value: a.growthRatio !== undefined ? a.growthRatio : 60,
            min: 0,
            max: 100,
            step: 5,
            unit: "%",
            onChange: (v) => {
              a.growthRatio = v;
              a.dividendRatio = 100 - v;
              growthSliderRow._setTitle(`성장형 비중 (%) [배당형 비중은 자동 ${100 - v}%]`);
              updateWeightedSummary();
              recalculateAndRender();
              scheduleAutoSave();
            },
          });
          body.appendChild(growthSliderRow);

          body.appendChild(
            createSliderNumberRow({
              label: "성장형 자본운용수익률 (%)",
              value: a.growthReturnRate !== undefined ? a.growthReturnRate : 5.0,
              min: 0.0,
              max: 15.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.growthReturnRate = v;
                updateWeightedSummary();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "배당형 배당/이자수익률 (%)",
              value: a.dividendReturnRate !== undefined ? a.dividendReturnRate : 3.5,
              min: 0.0,
              max: 10.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.dividendReturnRate = v;
                updateWeightedSummary();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          updateWeightedSummary();
          body.appendChild(dcSummaryBox);
          body.appendChild(
            createSliderNumberRow({
              label: "연금 개시 나이 (목표 CIF 시작나이 자동 연동)",
              value: a.startAge,
              min: 55,
              max: 80,
              step: 1,
              unit: "세",
              syncRole: "linked-start-age",
              onChange: (v) => {
                a.startAge = v;
                syncPensionStartAgesWithTarget(v);
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          appendWithdrawalSubControls(body, a, rerender);

          body.appendChild(
            createSliderNumberRow({
              label: "이연퇴직소득(퇴직금 원금) 비중 (1,500만원 한도 제외분)",
              value: a.severancePrincipalRatio,
              min: 0,
              max: 100,
              step: 5,
              unit: "%",
              onChange: (v) => {
                a.severancePrincipalRatio = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "퇴직소득세 원 실효세율 (연금수령 시 30~40% 감면 적용)",
              value: a.effectiveSeveranceTaxRate,
              min: 1.0,
              max: 20.0,
              step: 0.5,
              unit: "%",
              onChange: (v) => {
                a.effectiveSeveranceTaxRate = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
        },
      },
      {
        key: "irp",
        title: "3. IRP (개인형 퇴직연금)",
        color: ASSET_COLORS.irp,
        badgeFn: (a) =>
          `현재 ${fmtKoreanMoneyHint(a.currentBalance)} · ${a.startAge}세 개시`,
        buildBody: (body, a, rerender) => {
          body.appendChild(
            createSliderNumberRow({
              label: "현재 IRP 평가액 (백만원)",
              value: a.currentBalance,
              min: 0,
              max: 1000,
              step: 5,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.currentBalance = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          // 포트폴리오 가중 총 수익률 안내 박스 (In-place 갱신용)
          const dcSummaryBox = document.createElement("div");
          dcSummaryBox.style.cssText = "margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 6px; font-size: 11px; color: #a5f3fc;";
          const updateWeightedSummary = () => {
            const gRatioVal = a.growthRatio !== undefined ? a.growthRatio : 60;
            const dRatioVal = 100 - gRatioVal;
            const gRateVal = a.growthReturnRate !== undefined ? a.growthReturnRate : 5.0;
            const dRateVal = a.dividendReturnRate !== undefined ? a.dividendReturnRate : 3.5;
            a.returnRate = Number(((gRatioVal / 100.0) * gRateVal).toFixed(2));
            a.dividendRate = Number(((dRatioVal / 100.0) * dRateVal).toFixed(2));
            const totRet = ((gRatioVal * gRateVal + dRatioVal * dRateVal) / 100).toFixed(2);
            dcSummaryBox.innerHTML = `📊 포트폴리오 가중 총 운용수익률: <b>연 ${totRet}%</b> (성장 ${gRatioVal}% × ${gRateVal}% + 배당 ${dRatioVal}% × ${dRateVal}%)`;
          };

          // 성장형 vs 배당형 비중 및 수익률 슬라이더
          const growthSliderRow = createSliderNumberRow({
            label: `성장형 비중 (%) [배당형 비중은 자동 ${100 - (a.growthRatio !== undefined ? a.growthRatio : 60)}%]`,
            value: a.growthRatio !== undefined ? a.growthRatio : 60,
            min: 0,
            max: 100,
            step: 5,
            unit: "%",
            onChange: (v) => {
              a.growthRatio = v;
              a.dividendRatio = 100 - v;
              growthSliderRow._setTitle(`성장형 비중 (%) [배당형 비중은 자동 ${100 - v}%]`);
              updateWeightedSummary();
              recalculateAndRender();
              scheduleAutoSave();
            },
          });
          body.appendChild(growthSliderRow);

          body.appendChild(
            createSliderNumberRow({
              label: "성장형 자본운용수익률 (%)",
              value: a.growthReturnRate !== undefined ? a.growthReturnRate : 5.0,
              min: 0.0,
              max: 15.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.growthReturnRate = v;
                updateWeightedSummary();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "배당형 배당/이자수익률 (%)",
              value: a.dividendReturnRate !== undefined ? a.dividendReturnRate : 3.5,
              min: 0.0,
              max: 10.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.dividendReturnRate = v;
                updateWeightedSummary();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          updateWeightedSummary();
          body.appendChild(dcSummaryBox);
          body.appendChild(
            createSliderNumberRow({
              label: "연금 개시 나이 (목표 CIF 시작나이 자동 연동)",
              value: a.startAge,
              min: 55,
              max: 80,
              step: 1,
              unit: "세",
              syncRole: "linked-start-age",
              onChange: (v) => {
                a.startAge = v;
                syncPensionStartAgesWithTarget(v);
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          appendWithdrawalSubControls(body, a, rerender);

          // 연금저축 + IRP 합산 연간 1,500만원 절세 한도 설정
          body.appendChild(
            createCheckboxRow({
              label: "연금저축+IRP 합산 연 1,500만원(월 125만원) 절세 한도 내로 수령 제한",
              checked: a.capAnnualLimit !== undefined ? a.capAnnualLimit : true,
              onChange: (v) => {
                a.capAnnualLimit = v;
                if (currentState.assets.pensionSavings) {
                  currentState.assets.pensionSavings.capAnnualLimit = v;
                }
                renderAssetCards();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          if (a.capAnnualLimit !== false) {
            const irpSharedBox = document.createElement("div");
            irpSharedBox.style.cssText = "margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; font-size: 11px; color: #a7f3d0; line-height: 1.4;";
            irpSharedBox.innerHTML = "💡 <b>사적연금 합산 절세 한도</b>: 소득세법에 따라 <b>연금저축과 IRP 수령액의 합산</b>이 연 1,500만원(월 125만원) 이하로 자동 안분·제한되어 저율(3.3~5.5%) 분리과세가 유지됩니다.";
            body.appendChild(irpSharedBox);
          }
          body.appendChild(
            createSliderNumberRow({
              label: "이연퇴직소득(퇴직금 원금) 비중 (1,500만원 한도 제외분)",
              value: a.severancePrincipalRatio,
              min: 0,
              max: 100,
              step: 5,
              unit: "%",
              onChange: (v) => {
                a.severancePrincipalRatio = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
        },
      },
      {
        key: "pensionSavings",
        title: "4. 연금저축 (펀드/신탁/보험)",
        color: ASSET_COLORS.ps,
        badgeFn: (a) =>
          `현재 ${fmtKoreanMoneyHint(a.currentBalance)} · ${a.startAge}세 개시`,
        buildBody: (body, a, rerender) => {
          body.appendChild(
            createSliderNumberRow({
              label: "현재 연금저축 평가액 (백만원)",
              value: a.currentBalance,
              min: 0,
              max: 1000,
              step: 5,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.currentBalance = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          // 포트폴리오 가중 총 수익률 안내 박스 (In-place 갱신용)
          const psSummaryBox = document.createElement("div");
          psSummaryBox.style.cssText = "margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 6px; font-size: 11px; color: #ddd6fe;";
          const updatePsSummary = () => {
            const gRatioVal = a.growthRatio !== undefined ? a.growthRatio : 60;
            const dRatioVal = 100 - gRatioVal;
            const gRateVal = a.growthReturnRate !== undefined ? a.growthReturnRate : 5.0;
            const dRateVal = a.dividendReturnRate !== undefined ? a.dividendReturnRate : 3.5;
            a.returnRate = Number(((gRatioVal / 100.0) * gRateVal).toFixed(2));
            a.dividendRate = Number(((dRatioVal / 100.0) * dRateVal).toFixed(2));
            const totRet = ((gRatioVal * gRateVal + dRatioVal * dRateVal) / 100).toFixed(2);
            psSummaryBox.innerHTML = `📊 포트폴리오 가중 총 운용수익률: <b>연 ${totRet}%</b> (성장 ${gRatioVal}% × ${gRateVal}% + 배당 ${dRatioVal}% × ${dRateVal}%)`;
          };

          // 성장형 vs 배당형 비중 및 수익률 슬라이더
          const psGrowthRow = createSliderNumberRow({
            label: `성장형 비중 (%) [배당형 비중은 자동 ${100 - (a.growthRatio !== undefined ? a.growthRatio : 60)}%]`,
            value: a.growthRatio !== undefined ? a.growthRatio : 60,
            min: 0,
            max: 100,
            step: 5,
            unit: "%",
            onChange: (v) => {
              a.growthRatio = v;
              a.dividendRatio = 100 - v;
              psGrowthRow._setTitle(`성장형 비중 (%) [배당형 비중은 자동 ${100 - v}%]`);
              updatePsSummary();
              recalculateAndRender();
              scheduleAutoSave();
            },
          });
          body.appendChild(psGrowthRow);

          body.appendChild(
            createSliderNumberRow({
              label: "성장형 자본운용수익률 (%)",
              value: a.growthReturnRate !== undefined ? a.growthReturnRate : 5.0,
              min: 0.0,
              max: 15.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.growthReturnRate = v;
                updatePsSummary();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "배당형 배당수익률 (%)",
              value: a.dividendReturnRate !== undefined ? a.dividendReturnRate : 3.5,
              min: 0.0,
              max: 10.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.dividendReturnRate = v;
                updatePsSummary();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          updatePsSummary();
          body.appendChild(psSummaryBox);
          body.appendChild(
            createSliderNumberRow({
              label: "연금 개시 나이 (목표 CIF 시작나이 자동 연동)",
              value: a.startAge,
              min: 55,
              max: 80,
              step: 1,
              unit: "세",
              syncRole: "linked-start-age",
              onChange: (v) => {
                a.startAge = v;
                syncPensionStartAgesWithTarget(v);
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          appendWithdrawalSubControls(body, a, rerender);

          // 연금저축 + IRP 합산 연간 1,500만원 절세 한도 설정
          body.appendChild(
            createCheckboxRow({
              label: "연금저축+IRP 합산 연 1,500만원(월 125만원) 절세 한도 내로 수령 제한",
              checked: a.capAnnualLimit !== undefined ? a.capAnnualLimit : true,
              onChange: (v) => {
                a.capAnnualLimit = v;
                if (currentState.assets.irp) {
                  currentState.assets.irp.capAnnualLimit = v;
                }
                renderAssetCards();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          if (a.capAnnualLimit !== false) {
            const psSharedBox = document.createElement("div");
            psSharedBox.style.cssText = "margin: 4px 0 8px 0; padding: 6px 10px; background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 6px; font-size: 11px; color: #ddd6fe; line-height: 1.4;";
            psSharedBox.innerHTML = "💡 <b>사적연금 합산 절세 한도</b>: 소득세법에 따라 <b>연금저축과 IRP 수령액의 합산</b>이 연 1,500만원(월 125만원) 이하로 자동 안분·제한되어 저율(3.3~5.5%) 분리과세가 유지됩니다.";
            body.appendChild(psSharedBox);
          }

          body.appendChild(
            createSliderNumberRow({
              label: "세액공제 받지 않은 비과세 원금 비중 (%)",
              value: a.nonTaxablePrincipalRatio,
              min: 0,
              max: 100,
              step: 5,
              unit: "%",
              onChange: (v) => {
                a.nonTaxablePrincipalRatio = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
        },
      },
      {
        key: "privatePension",
        title: "5. 개인연금 (확정 기간·월정액 연금)",
        color: ASSET_COLORS.priv,
        badgeFn: (a) =>
          `${a.startAge}세부터 ${a.payoutYears || 10}년 동안 · 월 ${fmtKoreanMoneyHint(a.monthlyPayout || a.fixedMonthly || 1.0)}`,
        buildBody: (body, a, rerender) => {
          const privBox = document.createElement("div");
          privBox.style.cssText = "margin-top: 6px; padding: 6px 10px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 6px; font-size: 11px; color: #c7d2fe;";
          const updatePrivBox = () => {
            privBox.innerHTML = `🛡️ 보험사 약관 확정 수령: <b>${a.startAge}세부터 ${(a.payoutYears || 10)}년 동안 매월 ${fmtKoreanMoneyHint(a.monthlyPayout || a.fixedMonthly || 1.0)}</b>씩 확정 유입됩니다.`;
          };

          body.appendChild(
            createSliderNumberRow({
              label: "연금 수령 개시 나이",
              value: a.startAge,
              min: 45,
              max: 85,
              step: 1,
              unit: "세",
              syncRole: "linked-start-age",
              onChange: (v) => {
                a.startAge = v;
                syncPensionStartAgesWithTarget(v);
                updatePrivBox();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "수령 기간 (몇 년 동안)",
              value: a.payoutYears !== undefined ? a.payoutYears : 10,
              min: 1,
              max: 40,
              step: 1,
              unit: "년",
              onChange: (v) => {
                a.payoutYears = v;
                updatePrivBox();
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "월 수령액 (월 얼마, 백만원)",
              value: a.monthlyPayout !== undefined ? a.monthlyPayout : (a.fixedMonthly || 1.0),
              min: 0.1,
              max: 20.0,
              step: 0.05,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.monthlyPayout = v;
                a.fixedMonthly = v;
                updatePrivBox();
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createCheckboxRow({
              label: "10년 이상 유지 비과세 연금보험 (세금·건보료 완전 제외)",
              checked: a.isTaxFree,
              onChange: (v) => {
                a.isTaxFree = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          updatePrivBox();
          body.appendChild(privBox);
        },
      },
      {
        key: "stockPortfolio",
        title: "6. 주식투자액 (배당 + 지분매도)",
        color: ASSET_COLORS.stock,
        badgeFn: (a) =>
          `현재 ${fmtKoreanMoneyHint(a.currentBalance)} · 배당 ${a.dividendRate}%`,
        buildBody: (body, a, rerender) => {
          body.appendChild(
            createSliderNumberRow({
              label: "현재 주식투자 평가액 (백만원)",
              value: a.currentBalance,
              min: 0,
              max: 3000,
              step: 10,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.currentBalance = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );

          body.appendChild(
            createSliderNumberRow({
              label: "연평균 주가상승률 (자본 운영수익률, %)",
              value: a.priceReturnRate,
              min: -5.0,
              max: 15.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.priceReturnRate = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "연평균 배당수익률 (세전, %)",
              value: a.dividendRate,
              min: 0.0,
              max: 12.0,
              step: 0.1,
              unit: "%",
              onChange: (v) => {
                a.dividendRate = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "현금흐름(배당 수령/인출) 개시 나이 (개시 전 배당 재투자)",
              value: a.startAge,
              min: 45,
              max: 85,
              step: 1,
              unit: "세",
              syncRole: "linked-start-age",
              onChange: (v) => {
                a.startAge = v;
                syncPensionStartAgesWithTarget(v);
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          const stockAuto = appendCifModeSelect(body, a, rerender);
          if (!stockAuto) body.appendChild(
            createSelectRow({
              label: "배당금 외 추가 지분(원금+수익) 매도 인출 방식",
              value: a.principalWithdrawalMode,
              options: [
                { value: "none", label: "지분 매도 안 함 (배당금만 현금 수령)" },
                { value: "fixed", label: "배당금 + 매월 정액 지분 매도" },
                { value: "rate", label: "배당금 + 매년 잔액의 일정 비율(%) 지분 매도" },
              ],
              onChange: (v) => {
                a.principalWithdrawalMode = v;
                rerender();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          if (stockAuto) {
            // 자동조절 시 지분매도 설정 숨김
          } else if (a.principalWithdrawalMode === "fixed") {
            body.appendChild(
              createSliderNumberRow({
                label: "매월 추가 지분 매도액 (백만원)",
                value: a.fixedMonthlySell,
                min: 0.1,
                max: 10.0,
                step: 0.1,
                unit: "백만",
                isMoney: true,
                onChange: (v) => {
                  a.fixedMonthlySell = v;
                  recalculateAndRender();
                  scheduleAutoSave();
                },
              })
            );
          } else if (a.principalWithdrawalMode === "rate") {
            body.appendChild(
              createSliderNumberRow({
                label: "매년 잔액 대비 지분 매도 비율 (%)",
                value: a.sellRate,
                min: 0.5,
                max: 15.0,
                step: 0.2,
                unit: "%",
                onChange: (v) => {
                  a.sellRate = v;
                  recalculateAndRender();
                  scheduleAutoSave();
                },
              })
            );
          }
          body.appendChild(
            createSliderNumberRow({
              label: "해외주식 비중 (지분 매도 시 연 250만원 공제 후 22% 양도세)",
              value: a.foreignStockRatio,
              min: 0,
              max: 100,
              step: 5,
              unit: "%",
              onChange: (v) => {
                a.foreignStockRatio = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
        },
      },
      {
        key: "housing",
        title: "7. 거주주택 (주택연금화 옵션)",
        color: ASSET_COLORS.housing,
        badgeFn: (a) =>
          a.useReverseMortgage
            ? `시세 ${fmtKoreanMoneyHint(a.currentMarketPrice)} · ${a.rmStartAge}세 주택연금`
            : `시세 ${fmtKoreanMoneyHint(a.currentMarketPrice)} · 주택연금 미사용`,
        buildBody: (body, a, rerender) => {
          body.appendChild(
            createSliderNumberRow({
              label: "현재 거주주택 시세 (백만원)",
              value: a.currentMarketPrice,
              min: 100,
              max: 3000,
              step: 10,
              unit: "백만",
              isMoney: true,
              onChange: (v) => {
                a.currentMarketPrice = v;
                updateAssetBadges();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "시세 대비 공시가격 비율 (건보료·재산세 과표 산정용)",
              value: a.officialPriceRatio,
              min: 50,
              max: 90,
              step: 1,
              unit: "%",
              onChange: (v) => {
                a.officialPriceRatio = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createSliderNumberRow({
              label: "주택가격 연평균 상승률 (%)",
              value: a.priceGrowthRate,
              min: -2.0,
              max: 8.0,
              step: 0.2,
              unit: "%",
              onChange: (v) => {
                a.priceGrowthRate = v;
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          body.appendChild(
            createCheckboxRow({
              label: "주택연금(역모기지) 가입 활성화 (비과세 현금흐름 창출)",
              checked: a.useReverseMortgage,
              onChange: (v) => {
                a.useReverseMortgage = v;
                updateAssetBadges();
                rerender();
                recalculateAndRender();
                scheduleAutoSave();
              },
            })
          );
          if (a.useReverseMortgage) {
            body.appendChild(
              createSliderNumberRow({
                label: "주택연금 개시 나이 (55세 이상)",
                value: a.rmStartAge,
                min: 55,
                max: 90,
                step: 1,
                unit: "세",
                onChange: (v) => {
                  a.rmStartAge = v;
                  updateAssetBadges();
                  recalculateAndRender();
                  scheduleAutoSave();
                },
              })
            );
            body.appendChild(
              createSelectRow({
                label: "주택연금 월 수령액 산정 방식",
                value: a.rmCalcMode,
                options: [
                  {
                    value: "auto",
                    label: "한국주택금융공사(HF) 연령·주택가격 지급률표 자동 계산",
                  },
                  { value: "manual", label: "예상 월 수령액 직접 입력" },
                ],
                onChange: (v) => {
                  a.rmCalcMode = v;
                  rerender();
                  recalculateAndRender();
                  scheduleAutoSave();
                },
              })
            );
            if (a.rmCalcMode === "manual") {
              body.appendChild(
                createSliderNumberRow({
                  label: "주택연금 월 수령액 직접 지정 (백만원)",
                  value: a.rmManualMonthly,
                  min: 0.2,
                  max: 6.0,
                  step: 0.05,
                  unit: "백만",
                  isMoney: true,
                  onChange: (v) => {
                    a.rmManualMonthly = v;
                    recalculateAndRender();
                    scheduleAutoSave();
                  },
                })
              );
            }
            body.appendChild(
              createSliderNumberRow({
                label: "주택연금 대출잔액 누적 금리+보증료 (잔여 주택순자산 계산용)",
                value: a.rmLoanRate,
                min: 2.0,
                max: 8.0,
                step: 0.1,
                unit: "%",
                onChange: (v) => {
                  a.rmLoanRate = v;
                  recalculateAndRender();
                  scheduleAutoSave();
                },
              })
            );
          }
        },
      },
    ];

    for (const def of cardDefs) {
      const assetObj = assets[def.key];
      const card = document.createElement("div");
      card.className = `asset-card ${assetObj.enabled ? "" : "disabled-asset"}`;
      card.dataset.assetKey = def.key;

      const header = document.createElement("div");
      header.className = "asset-card-header";

      const titleWrap = document.createElement("div");
      titleWrap.className = "asset-title-wrap";

      const dot = document.createElement("span");
      dot.className = "color-dot";
      dot.style.background = def.color;

      const titleText = document.createElement("span");
      titleText.textContent = def.title;

      titleWrap.appendChild(dot);
      titleWrap.appendChild(titleText);

      const rightWrap = document.createElement("div");
      rightWrap.className = "asset-header-right";

      const badge = document.createElement("span");
      badge.className = "asset-summary-badge";
      badge.id = `badge-${def.key}`;
      badge.textContent = def.badgeFn(assetObj);

      const enableChk = document.createElement("input");
      enableChk.type = "checkbox";
      enableChk.checked = Boolean(assetObj.enabled);
      enableChk.title = "이 자산을 시뮬레이션에 포함/제외";
      enableChk.style.width = "16px";
      enableChk.style.height = "16px";
      enableChk.style.accentColor = def.color;
      enableChk.addEventListener("click", (e) => {
        e.stopPropagation();
        assetObj.enabled = enableChk.checked;
        card.className = `asset-card ${assetObj.enabled ? "" : "disabled-asset"}`;
        recalculateAndRender();
        scheduleAutoSave();
      });

      rightWrap.appendChild(badge);
      rightWrap.appendChild(enableChk);

      header.appendChild(titleWrap);
      header.appendChild(rightWrap);

      const body = document.createElement("div");
      body.className = `asset-card-body ${collapsedCardMap[def.key] ? "collapsed" : ""
        }`;

      const rebuildBody = () => {
        body.innerHTML = "";
        def.buildBody(body, assetObj, rebuildBody);
      };
      rebuildBody();

      header.addEventListener("click", () => {
        collapsedCardMap[def.key] = !collapsedCardMap[def.key];
        body.className = `asset-card-body ${collapsedCardMap[def.key] ? "collapsed" : ""
          }`;
      });

      card.appendChild(header);
      card.appendChild(body);
      container.appendChild(card);
    }
  }

  function updateAssetBadges() {
    const a = currentState.assets;
    const map = {
      earnedIncome: `${a.earnedIncome.startAge}세부터 ${a.earnedIncome.workYears}년 동안 · 월 ${fmtKoreanMoneyHint(a.earnedIncome.monthlyGrossSalary)}(세전)`,
      nationalPension: `${a.nationalPension.startAge}세 개시 · 월 ${fmtKoreanMoneyHint(
        a.nationalPension.monthlyAmountAtStart
      )}`,
      dcPension: `현재 ${fmtKoreanMoneyHint(a.dcPension.currentBalance)} · ${a.dcPension.startAge
        }세 개시`,
      irp: `현재 ${fmtKoreanMoneyHint(a.irp.currentBalance)} · ${a.irp.startAge}세 개시`,
      pensionSavings: `현재 ${fmtKoreanMoneyHint(
        a.pensionSavings.currentBalance
      )} · ${a.pensionSavings.startAge}세 개시`,
      privatePension: `${a.privatePension.startAge}세부터 ${a.privatePension.payoutYears || 10}년 동안 · 월 ${fmtKoreanMoneyHint(
        a.privatePension.monthlyPayout || a.privatePension.fixedMonthly || 1.0
      )}`,
      stockPortfolio: `현재 ${fmtKoreanMoneyHint(
        a.stockPortfolio.currentBalance
      )} · 배당 ${a.stockPortfolio.dividendRate}%`,
      housing: a.housing.useReverseMortgage
        ? `시세 ${fmtKoreanMoneyHint(a.housing.currentMarketPrice)} · ${a.housing.rmStartAge
        }세 주택연금`
        : `시세 ${fmtKoreanMoneyHint(a.housing.currentMarketPrice)} · 주택연금 미사용`,
    };
    for (const [k, text] of Object.entries(map)) {
      const el = document.getElementById(`badge-${k}`);
      if (el) el.textContent = text;
    }
  }

  function rebuildAllControls() {
    renderPresetList();
    renderTargetPanel();
    renderGlobalConfig();
    renderAssetCards();
    syncTopSegmentButtons();
  }

  function syncTopSegmentButtons() {
    const valToggle = document.getElementById("valueModeToggle");
    if (valToggle) {
      for (const btn of valToggle.querySelectorAll(".seg-btn")) {
        btn.classList.toggle(
          "active",
          btn.dataset.mode === currentState.meta.valueMode
        );
      }
    }
    const intToggle = document.getElementById("intervalModeToggle");
    if (intToggle) {
      for (const btn of intToggle.querySelectorAll(".seg-btn")) {
        btn.classList.toggle(
          "active",
          btn.dataset.interval === currentState.meta.chartInterval
        );
      }
    }
  }

  // =========================================================================
  // KPI 카드 및 상세 테이블 업데이트
  // =========================================================================

  function renderKpisAndTable(simResult) {
    const s = simResult.summary;

    document.getElementById("kpiAvgGross").textContent = `${fmtMillion(
      s.avgGrossCif
    )} 백만원`;
    document.getElementById("kpiAvgGrossSub").textContent = `약 ${fmtKoreanMoneyHint(
      s.avgGrossCif
    )} / 월`;

    document.getElementById("kpiAvgNet").textContent = `${fmtMillion(
      s.avgNetCif
    )} 백만원`;
    document.getElementById("kpiAvgNetSub").textContent = `약 ${fmtKoreanMoneyHint(
      s.avgNetCif
    )} / 월 (실수령)`;

    document.getElementById("kpiAvgCost").textContent = `-${fmtMillion(
      s.avgMonthlyCost
    )} 백만원`;
    document.getElementById("kpiAvgCostSub").textContent = `약 ${fmtKoreanMoneyHint(
      s.avgMonthlyCost
    )} 차감 (실효부담률 ${s.effectiveDeductionRate.toFixed(1)}%)`;

    document.getElementById("kpiAge65And75").textContent = `${fmtMillion(
      s.age65NetCif
    )} / ${fmtMillion(s.age75NetCif)} 백만`;
    document.getElementById(
      "kpiPeakSub"
    ).textContent = `최대 실수령: ${s.peakAge}세 (${fmtMillion(
      s.peakNetCif
    )} 백만원/월)`;

    document.getElementById("kpiFinalBalance").textContent = `${fmtMillion(
      s.finalFinancialBalance,
      1
    )} 백만원`;
    const finRealStr = (s.finalFinancialBalanceReal !== undefined) ? fmtKoreanMoneyHint(s.finalFinancialBalanceReal) : fmtKoreanMoneyHint(s.finalFinancialBalance);
    const nwRealStr = (s.finalNetWorthReal !== undefined) ? fmtKoreanMoneyHint(s.finalNetWorthReal) : fmtKoreanMoneyHint(s.finalNetWorth);
    document.getElementById(
      "kpiFinalBalanceSub"
    ).innerHTML = `금융 ${fmtKoreanMoneyHint(s.finalFinancialBalance)} · 순자산 ${fmtKoreanMoneyHint(s.finalNetWorth)}<br/><span style="font-size: 11px; color: #94a3b8; font-weight: normal;">(현재가치: 금융 ${finRealStr} · 순자산 ${nwRealStr})</span>`;

    const kT = document.getElementById("kpiTarget");
    const kTs = document.getElementById("kpiTargetSub");
    const t = currentState.target;
    if (!t.enabled) {
      kT.textContent = "미설정";
      kTs.textContent = "좌측 🎯 패널에서 목표 CIF를 켜세요";
    } else if (s.autoAssetCount === 0) {
      kT.textContent = `${fmtMillion(t.netMonthly)} 목표`;
      kTs.textContent = "⚠ '자동조절' 자산이 없어 비교만 표시됩니다";
    } else if (s.shortfallYears === 0) {
      kT.textContent = "✅ 전 기간 충족";
      kTs.textContent = `${t.startAge}세부터 월 ${fmtKoreanMoneyHint(t.netMonthly)}(${t.measure === "net" ? "세후" : "세전"}, ${t.basis === "real" ? "현재가치" : "명목"})`;
    } else {
      kT.textContent = `⚠ ${s.firstShortfallAge}세부터 부족`;
      kT.style.color = "#f43f5e";
      kTs.textContent = `미달 ${s.shortfallYears}년 · 누적 부족 ${fmtKoreanMoneyHint(s.totalShortfallAnnual)}(명목)`;
    }
    if (s.shortfallYears === 0) kT.style.color = "#facc15";

    // 연도별 상세 테이블 렌더링
    const tbody = document.getElementById("simTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    for (const r of simResult.yearlyRecords) {
      const tr = document.createElement("tr");
      const nhisAndProp = r.nhis + r.propertyTax;

      tr.innerHTML = `
        <td>${r.age}세 (${r.year})</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="salary" style="cursor: pointer; text-decoration: underline dotted; color: #5eead4;">${fmtMillion(r.salary)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="np" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.np)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="dc" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.dc)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="irp" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.irp)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="ps" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.ps)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="priv" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.priv)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="stock" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.stock)}</td>
        <td class="cif-cell" data-age="${r.age}" data-asset="housingRm" style="cursor: pointer; text-decoration: underline dotted;">${fmtMillion(r.housingRm)}</td>
        <td class="col-cif-val" style="font-weight: 700; color: #f8fafc;">${fmtMillion(r.grossCif)}</td>
        <td class="col-cif-val tax-cell" data-age="${r.age}" style="color: #fda4af; cursor: pointer; text-decoration: underline dotted;">-${fmtMillion(r.tax)}</td>
        <td class="col-cif-val" style="color: #fda4af;">-${fmtMillion(nhisAndProp)}</td>
        <td class="col-cif-val" style="font-weight: 800; color: #38bdf8;">${fmtMillion(r.netCif)}</td>
        <td style="color: ${r.shortfall > 0.005 ? "#f43f5e" : "#facc15"};">${r.target === null
          ? "-"
          : `${fmtMillion(r.target)}${r.shortfall > 0.005 ? ` / -${fmtMillion(r.shortfall)}` : " ✓"}`
        }</td>
        <td style="text-align: left; color: #fde68a;">${r.fillDesc || "-"}</td>
        <td style="text-align: center;"><span class="tax-badge">${r.chosenTaxRule}</span></td>
        <td style="font-weight: 700; color: #38bdf8;">${fmtMillion(r.netCif * 12.0, 1)}</td>
        <td style="color: #fda4af;">-${fmtMillion(r.totalCost * 12.0, 1)}</td>
        <td class="delta-cell" data-age="${r.age}" style="color: ${r.assetDelta.financialTotal >= 0 ? '#38bdf8' : '#f43f5e'}; font-weight: 700; cursor: pointer; text-decoration: underline dotted;">${r.assetDelta.financialTotal >= 0 ? '+' : ''}${fmtMillion(r.assetDelta.financialTotal, 1)}</td>
        <td class="balance-cell" data-age="${r.age}" style="color: #10b981; font-weight: 700; cursor: pointer; text-decoration: underline dotted;">${fmtMillion(
          r.balances.financialTotal,
          1
        )}</td>
        <td style="color: #10b981;">${fmtMillion(r.balances.netWorth, 1)}</td>
      `;
      tbody.appendChild(tr);
    }

    // 잔여 금융자산 및 자산증가액 셀 마우스 호버 시 구성 자산 툴팁 연결
    bindTableBalanceTooltips(simResult);
  }

  // =========================================================================
  // 고해상도 캔버스 차트 렌더러 (1. 월간 CIF 누적 차트 / 2. 잔여 자산 추이 차트)
  // =========================================================================

  let cifChartHitRegions = [];
  let balanceChartHitRegions = [];

  function setupHiDPICanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(300, Math.floor(rect.width * dpr));
    const targetH = Math.max(180, Math.floor(rect.height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function calcNiceMaxY(maxVal) {
    if (maxVal <= 0.5) return 1.0;
    const raw = maxVal * 1.15;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm <= 1.5) step = 1.5;
    else if (norm <= 2) step = 2;
    else if (norm <= 3) step = 3;
    else if (norm <= 4) step = 4;
    else if (norm <= 5) step = 5;
    else if (norm <= 6) step = 6;
    else if (norm <= 8) step = 8;
    else step = 10;
    return step * mag;
  }

  // 1) 메인 차트: 월간 현금흐름(CIF) 추이 (가로축: 시간, 세로축: 백만원 단위)
  function drawCifChart(simResult) {
    const canvas = document.getElementById("cifChartCanvas");
    if (!canvas) return;
    const { ctx, width, height } = setupHiDPICanvas(canvas);

    const isMonthly = currentState.meta.chartInterval === "monthly";
    const records = isMonthly ? simResult.monthlyRecords : simResult.yearlyRecords;
    if (!records || records.length === 0) return;

    const padLeft = 64;
    const padRight = 24;
    const padTop = 34;
    const padBottom = 42;
    const plotW = Math.max(50, width - padLeft - padRight);
    const plotH = Math.max(50, height - padTop - padBottom);

    ctx.clearRect(0, 0, width, height);

    let maxVal = 0;
    for (const r of records) {
      if (r.grossCif > maxVal) maxVal = r.grossCif;
      if (r.target !== null && r.target > maxVal) maxVal = r.target;
    }
    const yMax = calcNiceMaxY(maxVal);

    // Y축 그리드 및 백만원 단위 눈금
    const yTicks = 5;
    ctx.font = "11.5px Pretendard, Malgun Gothic, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= yTicks; i++) {
      const val = (yMax / yTicks) * i;
      const y = padTop + plotH - (val / yMax) * plotH;

      ctx.strokeStyle = i === 0 ? "#475569" : "rgba(51, 65, 85, 0.55)";
      ctx.lineWidth = i === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = "#94a3b8";
      ctx.fillText(
        `${val >= 10 ? val.toFixed(0) : val.toFixed(1)}백만`,
        padLeft - 8,
        y
      );
    }

    // Y축 단위 라벨
    ctx.save();
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "bold 11px Pretendard, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("단위: 백만원/월", 8, 12);
    ctx.restore();

    const n = records.length;
    const stepX = plotW / n;
    const barW = Math.max(1.5, Math.min(28, stepX * (isMonthly ? 0.92 : 0.72)));

    cifChartHitRegions = [];

    const stackKeys = [
      { key: "salary", color: ASSET_COLORS.salary },
      { key: "np", color: ASSET_COLORS.np },
      { key: "dc", color: ASSET_COLORS.dc },
      { key: "irp", color: ASSET_COLORS.irp },
      { key: "ps", color: ASSET_COLORS.ps },
      { key: "priv", color: ASSET_COLORS.priv },
      { key: "stock", color: ASSET_COLORS.stock },
      { key: "housingRm", color: ASSET_COLORS.housing },
    ];

    const netPoints = [];

    for (let i = 0; i < n; i++) {
      const r = records[i];
      const cx = padLeft + i * stepX + stepX / 2;
      const bx = cx - barW / 2;

      let curBottomVal = 0;
      for (const sk of stackKeys) {
        const val = r[sk.key] || 0;
        if (val > 0.0001) {
          const topVal = curBottomVal + val;
          const yBottom = padTop + plotH - (curBottomVal / yMax) * plotH;
          const yTop = padTop + plotH - (topVal / yMax) * plotH;
          const h = Math.max(0.5, yBottom - yTop);

          ctx.fillStyle = sk.color;
          ctx.fillRect(bx, yTop, barW, h);
          curBottomVal = topVal;
        }
      }

      // 세금+건보료+재산세 차감 구간 표시 (Gross CIF 상단에서 Net CIF까지 붉은 반투명/빗금 오버레이)
      if (r.totalCost > 0.001 && r.grossCif > 0.001) {
        const yGross = padTop + plotH - (r.grossCif / yMax) * plotH;
        const yNet = padTop + plotH - (r.netCif / yMax) * plotH;
        const costH = Math.max(1, yNet - yGross);
        ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
        ctx.fillRect(bx, yGross, barW, costH);
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, yGross, barW, costH);
      }

      const netY = padTop + plotH - (r.netCif / yMax) * plotH;
      netPoints.push({ x: cx, y: netY, record: r });

      cifChartHitRegions.push({
        xLeft: padLeft + i * stepX,
        xRight: padLeft + (i + 1) * stepX,
        cx,
        record: r,
      });

      // X축 시간 라벨
      const shouldDrawLabel = isMonthly
        ? r.month === 1 && (r.age % 5 === 0 || i === 0)
        : r.age % 5 === 0 || i === 0 || i === n - 1;

      if (shouldDrawLabel) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${r.age}세`, cx, padTop + plotH + 6);
        ctx.fillStyle = "#64748b";
        ctx.font = "10px Pretendard, sans-serif";
        ctx.fillText(`(${r.year})`, cx, padTop + plotH + 20);
      }
    }

    // 세후 실수령액 (Net CIF) 꺾은선 렌더링
    if (netPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      netPoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      if (!isMonthly) {
        for (const pt of netPoints) {
          ctx.fillStyle = "#0f172a";
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 목표 CIF 점선
    const tgtPts = netPoints.filter((p) => p.record.target !== null);
    if (tgtPts.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      tgtPts.forEach((p, idx) => {
        const y = padTop + plotH - (p.record.target / yMax) * plotH;
        if (idx === 0) ctx.moveTo(p.x - stepX / 2, y);
        ctx.lineTo(p.x + stepX / 2, y);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  // 2) 보조 차트: 시간에 따른 잔여 자산 총액 추이 (고갈 시점 확인용)
  function drawBalanceChart(simResult) {
    const canvas = document.getElementById("balanceChartCanvas");
    if (!canvas) return;
    const { ctx, width, height } = setupHiDPICanvas(canvas);

    const records = simResult.yearlyRecords;
    if (!records || records.length === 0) return;

    const padLeft = 64;
    const padRight = 24;
    const padTop = 20;
    const padBottom = 38;
    const plotW = Math.max(50, width - padLeft - padRight);
    const plotH = Math.max(50, height - padTop - padBottom);

    ctx.clearRect(0, 0, width, height);

    const balKeys = [
      { key: "dc", label: "퇴직DC", color: ASSET_COLORS.dc },
      { key: "irp", label: "IRP", color: ASSET_COLORS.irp },
      { key: "ps", label: "연금저축", color: ASSET_COLORS.ps },
      { key: "stock", label: "주식투자", color: ASSET_COLORS.stock },
    ];
    if (showHouseInBalanceChart) {
      balKeys.push({
        key: "house",
        label: "거주주택",
        color: ASSET_COLORS.housing,
      });
    }

    let maxBal = 0;
    for (const r of records) {
      const sum = balKeys.reduce((s, k) => s + (r.balances[k.key] || 0), 0);
      if (sum > maxBal) maxBal = sum;
    }
    const yMax = calcNiceMaxY(maxBal);

    // Y축 그리드
    const yTicks = 4;
    ctx.font = "11px Pretendard, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yTicks; i++) {
      const val = (yMax / yTicks) * i;
      const y = padTop + plotH - (val / yMax) * plotH;
      ctx.strokeStyle = i === 0 ? "#475569" : "rgba(51, 65, 85, 0.5)";
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      ctx.fillStyle = "#94a3b8";
      ctx.fillText(`${Math.round(val).toLocaleString()}백만`, padLeft - 8, y);
    }

    const n = records.length;
    const stepX = plotW / n;
    const barW = Math.max(2, Math.min(26, stepX * 0.7));

    balanceChartHitRegions = [];

    for (let i = 0; i < n; i++) {
      const r = records[i];
      const cx = padLeft + i * stepX + stepX / 2;
      const bx = cx - barW / 2;

      let curBottom = 0;
      for (const bk of balKeys) {
        const val = r.balances[bk.key] || 0;
        if (val > 0.01) {
          const topVal = curBottom + val;
          const yBottom = padTop + plotH - (curBottom / yMax) * plotH;
          const yTop = padTop + plotH - (topVal / yMax) * plotH;
          ctx.fillStyle = bk.color;
          ctx.fillRect(bx, yTop, barW, Math.max(0.5, yBottom - yTop));
          curBottom = topVal;
        }
      }

      balanceChartHitRegions.push({
        xLeft: padLeft + i * stepX,
        xRight: padLeft + (i + 1) * stepX,
        cx,
        record: r,
      });

      if (r.age % 5 === 0 || i === 0 || i === n - 1) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${r.age}세 (${r.year})`, cx, padTop + plotH + 8);
      }
    }
  }

  // 차트 마우스 호버 툴팁 바인딩
  function bindChartTooltips() {
    const tooltip = document.getElementById("chartTooltip");
    const cifCanvas = document.getElementById("cifChartCanvas");
    const balCanvas = document.getElementById("balanceChartCanvas");

    function positionTooltip(e) {
      const pad = 16;
      let left = e.clientX + pad;
      let top = e.clientY + pad;
      const rect = tooltip.getBoundingClientRect();
      if (left + rect.width > window.innerWidth - 12) {
        left = e.clientX - rect.width - pad;
      }
      if (top + rect.height > window.innerHeight - 12) {
        top = e.clientY - rect.height - pad;
      }
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
    }

    if (cifCanvas) {
      cifCanvas.addEventListener("mousemove", (e) => {
        const rect = cifCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const hit = cifChartHitRegions.find(
          (h) => mx >= h.xLeft && mx <= h.xRight
        );
        if (!hit) {
          tooltip.style.display = "none";
          return;
        }
        const r = hit.record;

        // 누적막대그래프가 아래(바닥)에서 위로 쌓이는 순서(stackKeys)와 일치시킴:
        // 바닥: 국민연금 -> 퇴직연금 DC -> IRP -> 연금저축 -> 개인연금 -> 주식투자 -> 주택연금 (맨 위)
        // 시각적으로 막대의 위에서 아래 순서(Top-to-Bottom) 또는 아래에서 위 순서 중
        // 막대에 쌓인 순서와 일치하도록 컬러 점(dot)과 함께 표시
        // 좌측 열: 월간 연금 및 현금 수입 (세전)
        const incomeItems = [
          { label: "근로소득", val: r.salary, color: ASSET_COLORS.salary },
          { label: "국민연금", val: r.np, color: ASSET_COLORS.np },
          { label: "퇴직연금 DC", val: r.dc, color: ASSET_COLORS.dc },
          { label: "IRP", val: r.irp, color: ASSET_COLORS.irp },
          { label: "연금저축", val: r.ps, color: ASSET_COLORS.ps },
          { label: "개인연금", val: r.priv, color: ASSET_COLORS.priv },
          { label: "주식(배당+매도)", val: r.stock, color: ASSET_COLORS.stock },
          { label: "주택연금", val: r.housingRm, color: ASSET_COLORS.housing },
        ];

        let incomeHtml = "";
        for (const item of incomeItems) {
          const v = item.val || 0;
          const opacity = v > 0.001 ? "1" : "0.45";
          incomeHtml += `
            <div class="tt-row" style="opacity: ${opacity};">
              <span><span class="color-dot" style="background: ${item.color}; vertical-align: middle; margin-right: 5px;"></span>${item.label}</span>
              <strong>${fmtKoreanMoneyHint(v)}</strong>
            </div>
          `;
        }

        // 우측 열: 세금 및 건보료 등 공제 내역 (engine.js의 taxBreakdown은 이미 월 환산 수치임)
        const tb = r.taxBreakdown || {};
        const salaryTaxMonthly = tb.salaryTax || 0;
        const dcTaxMonthly = tb.dcTotal || 0;
        const irpTaxMonthly = tb.irpTotal || 0;
        const psTaxMonthly = tb.psTotal || 0;
        const npTaxMonthly = tb.npTax || 0;
        const stockTaxMonthly = tb.stockTotal || 0;
        const privTaxMonthly = tb.privatePensionLowTax || 0;
        const nhisMonthly = r.nhis || 0;
        const propTaxMonthly = r.propertyTax || 0;
        const totalDeductionMonthly = (r.tax || 0) + nhisMonthly + propTaxMonthly;

        const isEmp = r.details && r.details.salary && r.details.salary.isEmployed;
        const nhisLabel = isEmp ? "직장건보료(보수외)" : "건보료+장기요양";

        const taxItems = [
          { label: "근로소득세", val: salaryTaxMonthly },
          { label: "국민연금 과세", val: npTaxMonthly },
          { label: "퇴직DC 세금", val: dcTaxMonthly },
          { label: "IRP 세금", val: irpTaxMonthly },
          { label: "연금저축 세금", val: psTaxMonthly },
          { label: "개인연금 세금", val: privTaxMonthly },
          { label: "주식 배당/양도세", val: stockTaxMonthly },
          { label: nhisLabel, val: nhisMonthly },
          { label: "주택 재산세", val: propTaxMonthly },
        ];

        let taxHtml = "";
        for (const item of taxItems) {
          const v = item.val || 0;
          const opacity = v > 0.001 ? "1" : "0.45";
          taxHtml += `
            <div class="tt-row" style="opacity: ${opacity}; color: #fca5a5;">
              <span>${item.label}</span>
              <strong>${v > 0.001 ? `-${fmtKoreanMoneyHint(v)}` : "0원"}</strong>
            </div>
          `;
        }

        // 과세 및 수령 로직 요약
        const irpPsSharedAnnual = ((r.irp || 0) + (r.ps || 0)) * 12;
        const limitHint = (irpPsSharedAnnual > 0.01)
          ? ` · 연금저축+IRP: 연 ${fmtKoreanMoneyHint(irpPsSharedAnnual)} (${irpPsSharedAnnual <= 15.0001 ? "1,500만원 이하 3.3~5.5% 분리과세 한도 내 ✓" : "1,500만원 초과 전액 종합/16.5% 분리과세"})`
          : "";
        const nhisDesc = isEmp ? "근로소득 직장가입자 (지역건보료 면제/보수외소득만 부과)" : "지역가입자 건보료 (소득+재산 점수제 부과)";

        tooltip.innerHTML = `
          <div class="tt-title">${r.label} 월간 현금흐름 상세 분석</div>
          <div class="tt-grid-2col">
            <div>
              <div class="tt-col-title">📥 월간 연금·현금 수입 (세전)</div>
              ${incomeHtml}
              <div class="tt-divider"></div>
              <div class="tt-row" style="font-weight: 700; color: #93c5fd;">
                <span>세전 총 CIF</span>
                <strong>${fmtKoreanMoneyHint(r.grossCif)}</strong>
              </div>
            </div>
            <div>
              <div class="tt-col-title">📤 세금 및 건보료 공제</div>
              ${taxHtml}
              <div class="tt-divider"></div>
              <div class="tt-row" style="font-weight: 700; color: #f87171;">
                <span>총 공제액</span>
                <strong>-${fmtKoreanMoneyHint(totalDeductionMonthly)}</strong>
              </div>
            </div>
          </div>
          <div class="tt-summary-box">
            <div class="tt-row" style="color: #38bdf8; font-size: 13.5px; font-weight: 800; margin-bottom: 4px;">
              <span><span class="color-dot" style="background: #ffffff; border: 2px solid #38bdf8; vertical-align: middle; margin-right: 6px;"></span>최종 세후 실수령액 (Net CIF):</span>
              <strong style="font-size: 14.5px;">${fmtKoreanMoneyHint(r.netCif)} / 월 <span style="font-size: 11.5px; font-weight: normal; color: #94a3b8;">(연 ${fmtKoreanMoneyHint(r.netCif * 12)})</span></strong>
            </div>
            ${r.target !== null ? `
              <div class="tt-row" style="color: #facc15; font-size: 11.5px;">
                <span>🎯 목표 CIF: ${fmtKoreanMoneyHint(r.target)} / 월</span>
                <strong>${r.shortfall > 0.005 ? `부족 ${fmtKoreanMoneyHint(r.shortfall)}` : "목표 달성 ✓"}</strong>
              </div>` : ""}
            ${r.fillDesc ? `<div style="font-size: 11px; color: #fde68a; margin-top: 2px;">⚡ 목표충족 자동인출(월평균): ${r.fillDesc}</div>` : ""}
            <div style="font-size: 11px; color: #cbd5e1; margin-top: 5px; line-height: 1.45; border-top: 1px dashed #475569; padding-top: 5px;">
              ℹ️ <strong>산출 로직 요약</strong>: 과세방식 [${r.chosenTaxRule}]${limitHint}<br/>
              · 건강보험: ${nhisDesc}
            </div>
          </div>
        `;
        tooltip.style.display = "block";
        positionTooltip(e);
      });

      cifCanvas.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    }

    if (balCanvas) {
      balCanvas.addEventListener("mousemove", (e) => {
        const rect = balCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const hit = balanceChartHitRegions.find(
          (h) => mx >= h.xLeft && mx <= h.xRight
        );
        if (!hit) {
          tooltip.style.display = "none";
          return;
        }
        const r = hit.record;
        const b = r.balances;

        // 잔여 자산 누적막대그래프가 쌓이는 순서(balKeys)와 일치시킴:
        // 바닥: 퇴직DC -> IRP -> 연금저축 -> 개인연금 -> 주식투자 -> (선택 시 거주주택 맨 위)
        // 화면 막대의 위에서 아래(Top-to-Bottom) 순서로 표시
        const balList = [];
        if (showHouseInBalanceChart) {
          balList.push({ label: "거주주택 시세", val: b.house, color: ASSET_COLORS.housing });
        }
        balList.push(
          { label: "주식투자 잔액", val: b.stock, color: ASSET_COLORS.stock },
          { label: "연금저축 잔액", val: b.ps, color: ASSET_COLORS.ps },
          { label: "IRP 잔액", val: b.irp, color: ASSET_COLORS.irp },
          { label: "퇴직연금 DC 잔액", val: b.dc, color: ASSET_COLORS.dc }
        );

        let balRowsHtml = "";
        for (const item of balList) {
          const v = item.val || 0;
          const opacity = v > 0.01 ? "1" : "0.45";
          balRowsHtml += `
            <div class="tt-row" style="opacity: ${opacity};">
              <span><span class="color-dot" style="background: ${item.color}; vertical-align: middle; margin-right: 5px;"></span>${item.label}:</span>
              <strong>${fmtKoreanMoneyHint(v)}</strong>
            </div>
          `;
        }

        const houseLoanInfo = (b.rmLoan && b.rmLoan > 0.1)
          ? `<div class="tt-row" style="color: #fda4af;"><span>└ 주택연금 누적대출(부채):</span><strong>-${fmtKoreanMoneyHint(b.rmLoan)}</strong></div>
             <div class="tt-row" style="color: #ec4899;"><span>└ 주택 순가치(시세−대출):</span><strong>${fmtKoreanMoneyHint(b.houseEquity)}</strong></div>`
          : "";

        tooltip.innerHTML = `
          <div class="tt-title">${r.age}세 (${r.year}년 말) 잔여 자산 평가액 (막대 위→아래 순)</div>
          ${balRowsHtml}
          <div class="tt-divider"></div>
          <div class="tt-row" style="color: #10b981; font-size: 13px;"><span><span class="color-dot" style="background: #10b981; vertical-align: middle; margin-right: 5px;"></span>잔여 금융자산 합계:</span><strong>${fmtKoreanMoneyHint(b.financialTotal)}</strong></div>
          ${!showHouseInBalanceChart ? `<div class="tt-row" style="color: #ec4899;"><span><span class="color-dot" style="background: ${ASSET_COLORS.housing}; vertical-align: middle; margin-right: 5px;"></span>거주주택 시세:</span><strong>${fmtKoreanMoneyHint(b.house)}</strong></div>` : ""}
          ${houseLoanInfo}
          <div class="tt-divider"></div>
          <div class="tt-row" style="color: #38bdf8; font-weight: bold; font-size: 13px;"><span>순자산 (금융자산 + 주택순가치):</span><strong>${fmtKoreanMoneyHint(b.netWorth)}</strong></div>
        `;
        tooltip.style.display = "block";
        positionTooltip(e);
      });

      balCanvas.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    }
  }

  // 테이블 잔여 금융자산 셀 호버 시 구성 자산 툴팁 바인딩
  function bindTableBalanceTooltips(simResult) {
    const tooltip = document.getElementById("chartTooltip");
    if (!tooltip) return;

    function positionTooltip(e) {
      const pad = 16;
      let left = e.clientX + pad;
      let top = e.clientY + pad;
      const rect = tooltip.getBoundingClientRect();
      if (left + rect.width > window.innerWidth - 12) {
        left = e.clientX - rect.width - pad;
      }
      if (top + rect.height > window.innerHeight - 12) {
        top = e.clientY - rect.height - pad;
      }
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
    }

    const cells = document.querySelectorAll("#simTableBody .balance-cell");
    cells.forEach((cell) => {
      const age = Number(cell.dataset.age);
      const r = simResult.yearlyRecords.find((item) => item.age === age);
      if (!r) return;
      const b = r.balances;

      cell.addEventListener("mousemove", (e) => {
        const houseLoanInfo = (b.rmLoan && b.rmLoan > 0.1)
          ? `<div class="tt-row" style="color: #fda4af;"><span>└ 주택연금 누적대출(부채):</span><strong>-${fmtKoreanMoneyHint(b.rmLoan)}</strong></div>
             <div class="tt-row" style="color: #ec4899;"><span>└ 주택 순가치(시세−대출):</span><strong>${fmtKoreanMoneyHint(b.houseEquity)}</strong></div>`
          : `<div class="tt-row" style="color: #ec4899;"><span>거주주택 시세:</span><strong>${fmtKoreanMoneyHint(b.house)}</strong></div>`;

        tooltip.innerHTML = `
          <div class="tt-title">${r.age}세 (${r.year}년 말) 잔여 금융자산 구성</div>
          <div class="tt-row"><span>퇴직연금 DC:</span><strong>${fmtKoreanMoneyHint(b.dc)}</strong></div>
          <div class="tt-row"><span>IRP:</span><strong>${fmtKoreanMoneyHint(b.irp)}</strong></div>
          <div class="tt-row"><span>연금저축:</span><strong>${fmtKoreanMoneyHint(b.ps)}</strong></div>

          <div class="tt-row"><span>주식투자액:</span><strong>${fmtKoreanMoneyHint(b.stock)}</strong></div>
          <div class="tt-divider"></div>
          <div class="tt-row" style="color: #10b981; font-size: 13px;"><span>잔여 금융자산 합계:</span><strong>${fmtKoreanMoneyHint(b.financialTotal)}</strong></div>
          ${houseLoanInfo}
          <div class="tt-divider"></div>
          <div class="tt-row" style="color: #38bdf8; font-weight: bold; font-size: 13px;"><span>순자산 (금융자산 + 주택순가치):</span><strong>${fmtKoreanMoneyHint(b.netWorth)}</strong></div>
        `;
        tooltip.style.display = "block";
        positionTooltip(e);
      });

      cell.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });

    const deltaCells = document.querySelectorAll("#simTableBody .delta-cell");
    deltaCells.forEach((cell) => {
      const age = Number(cell.dataset.age);
      const r = simResult.yearlyRecords.find((item) => item.age === age);
      if (!r || !r.assetDelta) return;
      const d = r.assetDelta;

      const fmtDelta = (val) => {
        const sign = val > 0 ? "+" : "";
        return `${sign}${fmtKoreanMoneyHint(val)}`;
      };

      cell.addEventListener("mousemove", (e) => {
        tooltip.innerHTML = `
          <div class="tt-title">${r.age}세 (${r.year}년) 연간 자산변동(증감) 구성</div>
          <div class="tt-row"><span>퇴직연금 DC 변동:</span><strong>${fmtDelta(d.dc)}</strong></div>
          <div class="tt-row"><span>IRP 변동:</span><strong>${fmtDelta(d.irp)}</strong></div>
          <div class="tt-row"><span>연금저축 변동:</span><strong>${fmtDelta(d.ps)}</strong></div>
          <div class="tt-row"><span>주식투자액 변동:</span><strong>${fmtDelta(d.stock)}</strong></div>
          <div class="tt-divider"></div>
          <div class="tt-row" style="color: ${d.financialTotal >= 0 ? '#38bdf8' : '#f43f5e'}; font-size: 13px;"><span>금융자산 연간 순증감:</span><strong>${fmtDelta(d.financialTotal)}</strong></div>
          <div class="tt-row" style="color: #ec4899;"><span>거주주택 순가치 변동:</span><strong>${fmtDelta(d.houseEquity)}</strong></div>
          <div class="tt-row" style="color: #10b981; font-weight: bold;"><span>순자산 연간 순증감:</span><strong>${fmtDelta(d.netWorth)}</strong></div>
          <div style="margin-top: 5px; font-size: 11px; color: #94a3b8;">* 전년 기말(또는 초기) 대비 당해 연도 기말 잔액의 증감액입니다.</div>
        `;
        tooltip.style.display = "block";
        positionTooltip(e);
      });

      cell.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });

    // 각 CIF 셀 호버 시 계산 과정 및 (주식/연금) 배당액·매도액 상세 툴팁 바인딩
    const cifCells = document.querySelectorAll("#simTableBody .cif-cell");
    cifCells.forEach((cell) => {
      const age = Number(cell.dataset.age);
      const assetKey = cell.dataset.asset;
      const r = simResult.yearlyRecords.find((item) => item.age === age);
      if (!r || !r.details) return;

      const d = r.details;
      cell.addEventListener("mousemove", (e) => {
        let contentHtml = "";

        if (assetKey === "salary") {
          const sd = d.salary;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 근로소득(급여) 계산 상세</div>
            <div class="tt-row"><span>월 세전 급여:</span><strong>${fmtKoreanMoneyHint(sd.grossMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row" style="color: #fda4af;"><span>├ 4대보험 공제:</span><strong>-${fmtKoreanMoneyHint(sd.fourMajorMonthly)} / 월</strong></div>
            <div class="tt-row" style="color: #fda4af;"><span>├ 소득세·지방소득세:</span><strong>-${fmtKoreanMoneyHint(sd.taxMonthly)} / 월</strong></div>
            <div class="tt-row" style="color: #38bdf8; font-weight: 800;"><span>└ 세후 실수령액(Net):</span><strong>${fmtKoreanMoneyHint(sd.netMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
              * 근로 기간: <b>${sd.startAge}세부터 ${sd.workYears}년 동안</b> 재직<br/>
              * 직장가입자 건강보험(3.545%+장기요양)이 적용되어 지역건보료가 부과되지 않습니다.
            </div>
          `;
        } else if (assetKey === "stock") {
          const sd = d.stock;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 주식투자 CIF 계산 과정</div>
            <div class="tt-row"><span>월간 총 CIF:</span><strong>${fmtKoreanMoneyHint(sd.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row" style="color: #f59e0b;"><span>├ 배당금 수령액:</span><strong>${fmtKoreanMoneyHint(sd.divMonthly)} / 월</strong></div>
            <div class="tt-row" style="color: #38bdf8;"><span>└ 주식 매도 인출액:</span><strong>${fmtKoreanMoneyHint(sd.sellMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
              * 인출 모드: <b>${sd.isAuto ? "목표 CIF 자동조절 (부족분 매도)" : sd.sellMode === "fixed" ? "매월 정액 매도" : sd.sellMode === "rate" ? "연 정률 매도" : "배당금만 수령"}</b><br/>
              * 연간 기준: 배당 ${fmtKoreanMoneyHint(sd.divMonthly * 12)}, 매도 ${fmtKoreanMoneyHint(sd.sellMonthly * 12)}
            </div>
          `;
        } else if (assetKey === "dc") {
          const ad = d.dc;
          const limitStr = ad.annualLimit === Infinity ? "무제한 (11년차 이상)" : `${fmtKoreanMoneyHint(ad.annualLimit)} / 년`;
          const divPart = `<div class="tt-row" style="color: #f59e0b;"><span>├ 배당/이자수익:</span><strong>${fmtKoreanMoneyHint(ad.divMonthly || 0)} / 월</strong></div>`;
          const sellPart = `<div class="tt-row" style="color: #38bdf8;"><span>├ 원금/지분 인출(매도)액:</span><strong>${fmtKoreanMoneyHint(ad.sellMonthly || Math.max(0, ad.totalMonthly - (ad.divMonthly || 0)))} / 월</strong></div>`;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 퇴직연금 DC CIF 계산 과정</div>
            <div class="tt-row"><span>월간 총 CIF:</span><strong>${fmtKoreanMoneyHint(ad.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row" style="color: #a5f3fc; font-size: 11px;"><span>구성 비중:</span><span>성장형 ${ad.growthRatio || 60}% (${ad.growthReturnRate || 5.0}%) / 배당형 ${ad.dividendRatio || 40}% (${ad.dividendReturnRate || 3.5}%)</span></div>
            ${divPart}
            ${sellPart}
            <div class="tt-row"><span>├ 연초 평가액:</span><strong>${fmtKoreanMoneyHint(ad.startBal)}</strong></div>
            <div class="tt-row" style="color: #10b981;"><span>├ 연간 수령한도:</span><strong>${limitStr}</strong></div>
            ${ad.capAnnualLimit
              ? `<div class="tt-row" style="color: #67e8f9; font-size: 11px;"><span>├ 사적연금 절세 한도:</span><strong>연금저축+IRP 합산 연 1,500만원(월 125만원) 캡 적용</strong></div>
                 <div class="tt-row" style="color: #a7f3d0; font-size: 11px;"><span>├ 당해년 합산 인출액:</span><strong>월 ${fmtKoreanMoneyHint(ad.sharedMonthlyTotal || ad.totalMonthly)} (연 ${fmtKoreanMoneyHint(ad.sharedAnnualTotal || ad.totalMonthly * 12)} / 1,500만원)</strong></div>`
              : ""
            }
            ${ad.isAuto
              ? `<div class="tt-row" style="color: #facc15;"><span>└ 목표 CIF 자동인출:</span><strong>${fmtKoreanMoneyHint(ad.fillMonthly)} / 월</strong></div>`
              : `<div class="tt-row" style="color: #38bdf8;"><span>└ 직접 설정 인출액:</span><strong>${fmtKoreanMoneyHint(ad.manualMonthly)} / 월 (${ad.mode === "period" ? "기간분할" : ad.mode === "fixed" ? "월정액" : ad.mode === "rate" ? "연정률" : "수익만"})</strong></div>`
            }
            <div class="tt-divider"></div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
              * 연간 인출 합계: <b>${fmtKoreanMoneyHint(ad.totalMonthly * 12)} / 년</b>
            </div>
          `;
        } else if (assetKey === "irp") {
          const ad = d.irp;
          const limitStr = ad.annualLimit === Infinity ? "무제한 (11년차 이상)" : `${fmtKoreanMoneyHint(ad.annualLimit)} / 년`;
          const divPart = ad.divMonthly > 0 ? `<div class="tt-row" style="color: #f59e0b;"><span>├ 운용 배당/이자수익:</span><strong>${fmtKoreanMoneyHint(ad.divMonthly)} / 월</strong></div>` : "";
          const sellPart = `<div class="tt-row" style="color: #38bdf8;"><span>├ 원금/지분 인출(매도)액:</span><strong>${fmtKoreanMoneyHint(Math.max(0, ad.totalMonthly - ad.divMonthly))} / 월</strong></div>`;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) IRP CIF 계산 과정</div>
            <div class="tt-row"><span>월간 총 CIF:</span><strong>${fmtKoreanMoneyHint(ad.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            ${divPart}
            ${sellPart}
            <div class="tt-row"><span>├ 연초 평가액:</span><strong>${fmtKoreanMoneyHint(ad.startBal)}</strong></div>
            <div class="tt-row" style="color: #10b981;"><span>├ 연간 수령한도:</span><strong>${limitStr}</strong></div>
            ${ad.capAnnualLimit
              ? `<div class="tt-row" style="color: #67e8f9; font-size: 11px;"><span>├ 사적연금 절세 한도:</span><strong>연금저축+IRP 합산 연 1,500만원(월 125만원) 캡 적용</strong></div>
                 <div class="tt-row" style="color: #a7f3d0; font-size: 11px;"><span>├ 당해년 합산 인출액:</span><strong>월 ${fmtKoreanMoneyHint(ad.sharedMonthlyTotal || ad.totalMonthly)} (연 ${fmtKoreanMoneyHint(ad.sharedAnnualTotal || ad.totalMonthly * 12)} / 1,500만원)</strong></div>`
              : ""
            }
            ${ad.isAuto
              ? `<div class="tt-row" style="color: #facc15;"><span>└ 목표 CIF 자동인출:</span><strong>${fmtKoreanMoneyHint(ad.fillMonthly)} / 월</strong></div>`
              : `<div class="tt-row" style="color: #38bdf8;"><span>└ 직접 설정 인출액:</span><strong>${fmtKoreanMoneyHint(ad.manualMonthly)} / 월 (${ad.mode === "period" ? "기간분할" : ad.mode === "fixed" ? "월정액" : ad.mode === "rate" ? "연정률" : "수익만"})</strong></div>`
            }
            <div class="tt-divider"></div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
              * 연간 인출 합계: <b>${fmtKoreanMoneyHint(ad.totalMonthly * 12)} / 년</b>
            </div>
          `;
        } else if (assetKey === "ps") {
          const ad = d.ps;
          const limitStr = ad.annualLimit === Infinity ? "무제한 (11년차 이상)" : `${fmtKoreanMoneyHint(ad.annualLimit)} / 년`;
          const divPart = `<div class="tt-row" style="color: #f59e0b;"><span>├ 배당/이자수익:</span><strong>${fmtKoreanMoneyHint(ad.divMonthly || 0)} / 월</strong></div>`;
          const sellPart = `<div class="tt-row" style="color: #38bdf8;"><span>├ 원금/지분 인출(매도)액:</span><strong>${fmtKoreanMoneyHint(ad.sellMonthly || Math.max(0, ad.totalMonthly - (ad.divMonthly || 0)))} / 월</strong></div>`;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 연금저축 CIF 계산 과정</div>
            <div class="tt-row"><span>월간 총 CIF:</span><strong>${fmtKoreanMoneyHint(ad.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row" style="color: #ddd6fe; font-size: 11px;"><span>구성 비중:</span><span>성장형 ${ad.growthRatio || 60}% (${ad.growthReturnRate || 5.0}%) / 배당형 ${ad.dividendRatio || 40}% (${ad.dividendReturnRate || 3.5}%)</span></div>
            ${divPart}
            ${sellPart}
            <div class="tt-row"><span>├ 연초 평가액:</span><strong>${fmtKoreanMoneyHint(ad.startBal)}</strong></div>
            <div class="tt-row" style="color: #10b981;"><span>├ 연간 수령한도:</span><strong>${limitStr}</strong></div>
            ${ad.capAnnualLimit
              ? `<div class="tt-row" style="color: #67e8f9; font-size: 11px;"><span>├ 사적연금 절세 한도:</span><strong>연금저축+IRP 합산 연 1,500만원(월 125만원) 캡 적용</strong></div>
                 <div class="tt-row" style="color: #a7f3d0; font-size: 11px;"><span>├ 당해년 합산 인출액:</span><strong>월 ${fmtKoreanMoneyHint(ad.sharedMonthlyTotal || ad.totalMonthly)} (연 ${fmtKoreanMoneyHint(ad.sharedAnnualTotal || ad.totalMonthly * 12)} / 1,500만원)</strong></div>`
              : ""
            }
            ${ad.isAuto
              ? `<div class="tt-row" style="color: #facc15;"><span>└ 목표 CIF 자동인출:</span><strong>${fmtKoreanMoneyHint(ad.fillMonthly)} / 월</strong></div>`
              : `<div class="tt-row" style="color: #38bdf8;"><span>└ 직접 설정 인출액:</span><strong>${fmtKoreanMoneyHint(ad.manualMonthly)} / 월 (${ad.mode === "period" ? "기간분할" : ad.mode === "fixed" ? "월정액" : ad.mode === "rate" ? "연정률" : "수익만"})</strong></div>`
            }
            <div class="tt-divider"></div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
              * 연간 인출 합계: <b>${fmtKoreanMoneyHint(ad.totalMonthly * 12)} / 년</b>
            </div>
          `;
        } else if (assetKey === "priv") {
          const ad = d.priv;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 개인연금 CIF 산정 상세</div>
            <div class="tt-row"><span>월간 확정 수령액:</span><strong>${fmtKoreanMoneyHint(ad.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row"><span>├ 수령 개시 나이:</span><strong>${ad.startAge}세</strong></div>
            <div class="tt-row"><span>├ 확정 수령 기간:</span><strong>${ad.payoutYears}년 동안</strong></div>
            <div class="tt-row"><span>├ 약정 월 수령액:</span><strong>${fmtKoreanMoneyHint(ad.monthlyPayout)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
              * ${ad.isTaxFree ? "10년 이상 유지 비과세 연금보험 (세금·건보료 완전 제외)" : "일반 과세 연금보험"}<br/>
              * 연간 확정 수령액: <b>${fmtKoreanMoneyHint(ad.totalMonthly * 12)} / 년</b>
            </div>
          `;
        } else if (assetKey === "np") {
          const ad = d.np;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 국민연금 수령액 산정 과정</div>
            <div class="tt-row"><span>월간 수령액:</span><strong>${fmtKoreanMoneyHint(ad.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row"><span>├ 기준 개시나이:</span><strong>65세 (설정 개시: ${ad.startAge}세)</strong></div>
            <div class="tt-row"><span>├ 기준 월 예상액:</span><strong>${fmtKoreanMoneyHint(ad.baseAmount)} / 월</strong></div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 5px; line-height: 1.4;">
              * 조기/연기 규칙 및 매년 물가상승률이 누적 반영된 실수령 예상액입니다.
            </div>
          `;
        } else if (assetKey === "housingRm") {
          const ad = d.housingRm;
          contentHtml = `
            <div class="tt-title">${r.age}세 (${r.year}년) 주택연금 CIF 산정 과정</div>
            <div class="tt-row"><span>월간 수령액:</span><strong>${fmtKoreanMoneyHint(ad.totalMonthly)} / 월</strong></div>
            <div class="tt-divider"></div>
            <div class="tt-row"><span>├ 가입 여부:</span><strong>${ad.useRm ? `가입 (${ad.startAge}세 개시)` : "미가입"}</strong></div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 5px; line-height: 1.4;">
              * 한국주택금융공사(HF) 지급률표 기준 종신정액 수령액 (비과세 현금흐름)
            </div>
          `;
        }

        tooltip.innerHTML = contentHtml;
        tooltip.style.display = "block";
        positionTooltip(e);
      });

      cell.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });

    // 세금 셀 호버 시 어떤 CIF에서 세금이 어떻게 부과되었는지 상세 breakdown 툴팁 바인딩
    const taxCells = document.querySelectorAll("#simTableBody .tax-cell");
    taxCells.forEach((cell) => {
      const age = Number(cell.dataset.age);
      const r = simResult.yearlyRecords.find((item) => item.age === age);
      if (!r) return;

      const tb = r.taxBreakdown || {};
      cell.addEventListener("mousemove", (e) => {
        const fmtPart = (val) => val > 0.0001 ? fmtKoreanMoneyHint(val) : "0원";
        const fmtAnn = (val) => val > 0.0001 ? fmtKoreanMoneyHint(val * 12) : "0원";

        tooltip.innerHTML = `
          <div class="tt-title">${r.age}세 (${r.year}년) 세금 세부 부과 내역</div>
          <div class="tt-row" style="color: #fda4af; font-size: 13px;"><span>월간 총 세금:</span><strong>-${fmtKoreanMoneyHint(r.tax)} / 월</strong></div>
          <div class="tt-row" style="color: #94a3b8; font-size: 11px;"><span>└ 연간 환산 총 세액:</span><strong>-${fmtKoreanMoneyHint(r.tax * 12)} / 년</strong></div>
          <div class="tt-divider"></div>
          <div style="font-size: 11.5px; font-weight: 700; color: #cbd5e1; margin-bottom: 4px;">[원천별 세금 부과 내역 (월 기준 / 연 환산)]</div>
          
          <div class="tt-row" style="opacity: ${(tb.salaryTax || 0) > 0.0001 ? "1" : "0.5"}; color: #5eead4;">
            <span>├ 근로소득세 (근로소득공제·세액공제 반영):</span>
            <strong>${fmtPart(tb.salaryTax || 0)} (${fmtAnn(tb.salaryTax || 0)})</strong>
          </div>

          <div class="tt-row" style="opacity: ${tb.npTax > 0.0001 ? "1" : "0.5"};">
            <span>├ 국민연금 소득세 (공적연금소득공제 반영):</span>
            <strong>${fmtPart(tb.npTax)} (${fmtAnn(tb.npTax)})</strong>
          </div>

          <div class="tt-row" style="opacity: ${tb.dcTotal > 0.0001 ? "1" : "0.5"};">
            <span>├ 퇴직연금 DC (퇴직소득세 ${tb.dcPenalty > 0 ? "+한도초과16.5%" : "감면적용"}):</span>
            <strong>${fmtPart(tb.dcTotal)} (${fmtAnn(tb.dcTotal)})</strong>
          </div>

          <div class="tt-row" style="opacity: ${tb.irpTotal > 0.0001 ? "1" : "0.5"};">
            <span>├ IRP (퇴직소득세 ${tb.irpPenalty > 0 ? "+한도초과16.5%" : "감면적용"}):</span>
            <strong>${fmtPart(tb.irpTotal)} (${fmtAnn(tb.irpTotal)})</strong>
          </div>

          <div class="tt-row" style="opacity: ${tb.psTotal > 0.0001 ? "1" : "0.5"};">
            <span>├ 연금저축 (${r.chosenTaxRule}):</span>
            <strong>${fmtPart(tb.psTotal)} (${fmtAnn(tb.psTotal)})</strong>
          </div>

          <div class="tt-row" style="opacity: ${tb.stockTotal > 0.0001 ? "1" : "0.5"};">
            <span>├ 주식투자 (배당소득세 15.4% ${tb.stockCapGainTax > 0 ? "+해외양도세22%" : ""}):</span>
            <strong>${fmtPart(tb.stockTotal)} (${fmtAnn(tb.stockTotal)})</strong>
          </div>

          <div class="tt-row" style="opacity: 0.5;">
            <span>├ 개인연금:</span>
            <strong>0원 (10년 이상 비과세)</strong>
          </div>

          <div class="tt-row" style="opacity: 0.5;">
            <span>└ 거주주택(주택연금):</span>
            <strong>0원 (대출 역모기지 비과세)</strong>
          </div>

          <div class="tt-divider"></div>
          <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
            * 사적연금 과세 판정: <b>${r.chosenTaxRule}</b><br/>
            ${r.taxSavedAnnual > 0.001 ? `* 분리/종합 자동비교로 연간 <b>${fmtKoreanMoneyHint(r.taxSavedAnnual)}</b> 절세됨` : ""}
          </div>
        `;
        tooltip.style.display = "block";
        positionTooltip(e);
      });

      cell.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });
  }

  // =========================================================================
  // 전체 시뮬레이션 재계산 및 화면 갱신
  // =========================================================================

  let renderRafId = null;
  function performRenderNow() {
    renderRafId = null;
    latestSimResult = window.SimulatorEngine.runSimulation(currentState);
    renderKpisAndTable(latestSimResult);
    drawCifChart(latestSimResult);
    drawBalanceChart(latestSimResult);
  }

  function recalculateAndRender(immediate = false) {
    if (immediate) {
      if (renderRafId) cancelAnimationFrame(renderRafId);
      performRenderNow();
      return;
    }
    if (renderRafId) return;
    renderRafId = requestAnimationFrame(performRenderNow);
  }

  // =========================================================================
  // 상단 버튼 및 이벤트 리스너 초기화
  // =========================================================================

  function initEventListeners() {
    document
      .getElementById("btnSavePreset")
      .addEventListener("click", handleSavePreset);

    document
      .getElementById("presetNameInput")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleSavePreset();
      });

    // 명목가치 / 현재가치 토글
    const valToggle = document.getElementById("valueModeToggle");
    valToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      currentState.meta.valueMode = btn.dataset.mode;
      syncTopSegmentButtons();
      recalculateAndRender();
      scheduleAutoSave();
    });

    // 연단위 / 월단위 토글
    const intToggle = document.getElementById("intervalModeToggle");
    intToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      currentState.meta.chartInterval = btn.dataset.interval;
      syncTopSegmentButtons();
      recalculateAndRender();
      scheduleAutoSave();
    });

    // 보조 차트 거주주택 시세 포함 체크박스
    const chkHouse = document.getElementById("chkShowHouseInBalanceChart");
    chkHouse.addEventListener("change", () => {
      showHouseInBalanceChart = chkHouse.checked;
      if (latestSimResult) drawBalanceChart(latestSimResult);
    });

    // 상태 파일(.json) 내보내기
    const btnCsv = document.getElementById("btnExportCsv");
    if (btnCsv) {
      btnCsv.addEventListener("click", () => {
        const table = document.querySelector(".sim-table");
        if (!table) return;
        const esc = (t) => '"' + t.replace(/\s+/g, " ").trim().replace(/"/g, '""') + '"';
        const rows = [...table.querySelectorAll("tr")].map((tr) =>
          [...tr.children].map((c) => esc(c.textContent)).join(",")
        );
        const blob = new Blob(["\ufeff" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cif_yearly_table.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    }

    document.getElementById("btnExportJson").addEventListener("click", () => {
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        lastState: {
          updatedAt: new Date().toISOString(),
          state: currentState,
        },
        presets: savedPresets,
      };
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `노후현금흐름_시뮬레이터_백업_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSaveStatus("JSON 상태 파일 내보내기 완료");
    });

    // 상태 파일(.json) 불러오기
    const fileInput = document.getElementById("fileImportJson");
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        if (parsed.lastState || parsed.state || parsed.meta) {
          const st = parsed.lastState
            ? parsed.lastState.state || parsed.lastState
            : parsed.state || parsed;
          currentState = mergeWithDefaultState(st);
        }
        if (Array.isArray(parsed.presets) && parsed.presets.length > 0) {
          savedPresets = parsed.presets;
        }

        if (serverAvailable) {
          try {
            const res = await fetch("/api/presets/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lastState: currentState,
                presets: savedPresets,
              }),
            });
            if (res.ok) {
              const d = await res.json();
              if (d.presets) savedPresets = d.presets;
            }
          } catch (_) { }
        }

        rebuildAllControls();
        recalculateAndRender();
        scheduleAutoSave();
        setSaveStatus("JSON 파일에서 상태 복원 완료");
      } catch (err) {
        alert("JSON 파일 형식이 올바르지 않습니다: " + err.message);
      } finally {
        fileInput.value = "";
      }
    });

    // 기본값 초기화
    document
      .getElementById("btnResetDefault")
      .addEventListener("click", () => {
        if (
          !confirm(
            "현재 조절한 변수들을 기본 초기값으로 되돌리시겠습니까? (저장해둔 프리셋 목록은 유지됩니다.)"
          )
        ) {
          return;
        }
        currentState = window.SimulatorEngine.createDefaultState();
        rebuildAllControls();
        recalculateAndRender();
        scheduleAutoSave();
        setSaveStatus("기본 초기값으로 복원됨");
      });

    // 창 크기 조절 시 캔버스 다시 그리기
    window.addEventListener("resize", () => {
      if (latestSimResult) {
        drawCifChart(latestSimResult);
        drawBalanceChart(latestSimResult);
      }
    });

    bindChartTooltips();
  }

  // 앱 시작
  window.addEventListener("DOMContentLoaded", async () => {
    await bootstrapStateAndPresets();
    rebuildAllControls();
    initEventListeners();
    recalculateAndRender();
  });
})();

