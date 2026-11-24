/* 시나리오 비교 페이지 */
(function () {
  "use strict";
  var E = window.SimulatorEngine, A = window.SimulatorAnalysis;
  var KEY_LAST = "fi_cif_simulator_last_state_v1", KEY_PRESETS = "fi_cif_simulator_presets_v1";
  var COLORS = ["#38bdf8", "#f59e0b", "#a855f7", "#10b981", "#f43f5e", "#e2e8f0"];

  function merge(base, over) {
    if (over === null || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over).forEach(function (k) {
      out[k] = base && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
    });
    return out;
  }
  function full(state) {
    var st = JSON.parse(JSON.stringify(state));
    if (st.taxConfig) E.migrateTaxConfig(st.taxConfig); // 예전 저장본은 당시 요율 유지
    return merge(E.createDefaultState(), st);
  }

  async function loadScenarios() {
    var presets = null, last = null;
    try {
      if (location.protocol !== "file:") {
        var r = await fetch("/api/bootstrap", { cache: "no-store" });
        if (r.ok) { var d = await r.json(); if (d && d.ok) { presets = d.presets; last = d.lastState; } }
      }
    } catch (_) {}
    try {
      if (!presets) { var p = JSON.parse(localStorage.getItem(KEY_PRESETS) || "null"); if (Array.isArray(p) && p.length) presets = p; }
      if (!last) last = JSON.parse(localStorage.getItem(KEY_LAST) || "null");
    } catch (_) {}
    var emb = window.__PORTABLE_STORAGE__;
    if (emb) { if (!presets && Array.isArray(emb.presets) && emb.presets.length) presets = emb.presets; if (!last) last = emb.lastState; }
    if (!presets) presets = E.getSamplePresets();
    var list = [];
    if (last && last.state) list.push({ name: "▶ 현재 작업 중인 상태", state: last.state });
    presets.forEach(function (p) { list.push({ name: p.name, state: p.state }); });
    if (window.SimulatorCases) {
      window.SimulatorCases.list.forEach(function (c) { list.push({ name: "📘 가이드: " + c.title, state: c.build(E), caseId: c.id }); });
    }
    return list;
  }


  function svgChart(series, getY, unit) {
    var W = 520, H = 280, L = 44, R = 10, T = 12, B = 28;
    var xs = [], ymax = 0;
    series.forEach(function (s) { s.rec.forEach(function (r) { xs.push(r.age); ymax = Math.max(ymax, getY(r)); }); });
    if (!xs.length) return "";
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    ymax = ymax * 1.08 || 1;
    var X = function (a) { return L + ((a - x0) / (x1 - x0 || 1)) * (W - L - R); };
    var Y = function (v) { return T + (1 - v / ymax) * (H - T - B); };
    var g = "";
    for (var i = 0; i <= 4; i++) {
      var v = (ymax / 4) * i, y = Y(v);
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" stroke="#334155" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#94a3b8">' + v.toFixed(ymax > 50 ? 0 : 1) + "</text>";
    }
    for (var a = Math.ceil(x0 / 5) * 5; a <= x1; a += 5) {
      g += '<text x="' + X(a) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#94a3b8">' + a + "세</text>";
    }
    series.forEach(function (s) {
      var pts = s.rec.map(function (r) { return X(r.age).toFixed(1) + "," + Y(getY(r)).toFixed(1); }).join(" ");
      g += '<polyline fill="none" stroke="' + s.color + '" stroke-width="2.2" points="' + pts + '"/>';
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + unit + '">' + g + "</svg>";
  }

  var scenarios = [], results = {};

  function render() {
    var checked = Array.prototype.map.call(document.querySelectorAll("#picks input:checked"), function (c) { return +c.value; });
    var msg = document.getElementById("cmpMsg");
    var box = document.getElementById("cmpTableBox");
    if (checked.length < 2) {
      msg.textContent = "비교할 시나리오를 2개 이상 선택하세요.";
      box.innerHTML = ""; document.getElementById("chartNet").innerHTML = ""; document.getElementById("chartBal").innerHTML = ""; document.getElementById("cmpLegend").innerHTML = "";
      return;
    }
    msg.textContent = "";
    var rows = checked.slice(0, 6).map(function (i, n) {
      if (!results[i]) results[i] = A.summarizeScenario(E, full(scenarios[i].state));
      return { name: scenarios[i].name, color: COLORS[n % COLORS.length], r: results[i] };
    });
    var metrics = [
      ["월평균 세후 실수령", "avgNet", 1, 2], ["65세 월 실수령", "age65Net", 1, 2], ["75세 월 실수령", "age75Net", 1, 2],
      ["월평균 세금·보험료 등", "avgCost", -1, 2], ["총 세금 합계(전 기간)", "totalTax", -1, 2], ["실효 차감률(%)", "effRate", -1, 1],
      ["종료 금융자산", "finalFinancial", 1, 0], ["종료 순자산", "finalNetWorth", 1, 0],
      ["소득 공백(년)", "gapYears", -1, 0],
    ];
    var html = '<table class="sim-table cmp-table"><thead><tr><th>지표</th>' +
      rows.map(function (x) { return '<th style="color:' + x.color + '">' + x.name.replace(/</g, "&lt;") + "</th>"; }).join("") + "</tr></thead><tbody>";
    metrics.forEach(function (m) {
      var vals = rows.map(function (x) { return x.r[m[1]]; });
      var best = m[2] > 0 ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
      var allSame = vals.every(function (v) { return Math.abs(v - vals[0]) < 1e-9; });
      html += "<tr><td>" + m[0] + "</td>" + vals.map(function (v) {
        return '<td class="' + (!allSame && Math.abs(v - best) < 1e-9 ? "best" : "") + '">' + v.toFixed(m[3]) + "</td>";
      }).join("") + "</tr>";
    });
    html += "<tr><td>금융자산 소진</td>" + rows.map(function (x) { return "<td>" + (x.r.depletionAge ? x.r.depletionAge + "세" : "유지") + "</td>"; }).join("") + "</tr>";
    html += "</tbody></table>";
    box.innerHTML = html;
    var ser = rows.map(function (x) { return { rec: x.r.sim.yearlyRecords, color: x.color }; });
    document.getElementById("chartNet").innerHTML = svgChart(ser, function (r) { return r.netCif; }, "월 실수령액");
    document.getElementById("chartBal").innerHTML = svgChart(ser, function (r) { return r.balances.financialTotal; }, "금융자산 잔액");
    document.getElementById("cmpLegend").innerHTML = rows.map(function (x) {
      return '<span><i style="background:' + x.color + '"></i>' + x.name.replace(/</g, "&lt;") + "</span>";
    }).join("");
  }

  loadScenarios().then(function (list) {
    scenarios = list;
    var picks = document.getElementById("picks");
    list.forEach(function (s, i) {
      var l = document.createElement("label"); l.className = "pick";
      var c = document.createElement("input"); c.type = "checkbox"; c.value = i;
      var want = new URLSearchParams(location.search).get("cases");
      if (want) { c.checked = !!s.caseId && want.split(",").indexOf(s.caseId) !== -1; } else
      c.checked = list.length > 3 ? (i >= (list[0].name.indexOf("▶") === 0 ? 1 : 0) && i < (list[0].name.indexOf("▶") === 0 ? 4 : 3)) : true;
      c.addEventListener("change", render);
      l.appendChild(c); l.appendChild(document.createTextNode(" " + s.name));
      picks.appendChild(l);
    });
    render();
  });
})();
