/* 간단 접속 코드 게이트 (정적 사이트용)
 *
 * 동작: 입력한 코드를 브라우저에서 SHA-256으로 해시해 config/access.json 의 digest 와 비교하고,
 *       일치하면 sessionStorage 에 접근 허용 상태(+ 설정 version)를 기록합니다.
 *       access.json 의 version 을 올리면 이전에 허용된 세션은 다시 코드를 입력해야 합니다.
 *
 * ⚠️ 정적 사이트의 간단한 접근 제한이며 민감정보 보호 목적이 아닙니다.
 *    해시가 클라이언트에 노출되므로(짧은 코드는 해시로 역추적 가능) 진짜 보안 경계로 사용하지 마세요.
 *    자바스크립트를 끄거나 file:// 로 직접 열면 적용되지 않습니다.
 *
 * 모든 페이지의 <head> 맨 앞에서 <script src="assets/site.js"></script> 로 불러옵니다.
 */
(function (global) {
  "use strict";

  var SESSION_KEY = "pension_access_v1";
  var CONFIG_PATH = "../config/access.json"; // site.js 위치(assets/) 기준 상대 경로

  // ---------------------------------------------------------------------------
  // SHA-256 (WebCrypto 우선, 없으면 순수 JS 구현으로 대체 — http 접속·구형 브라우저 대비)
  // ---------------------------------------------------------------------------
  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function sha256HexJs(str) {
    var msg = utf8Bytes(str);
    var bitLen = msg.length * 8;
    var padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
    padded.set(msg);
    padded[msg.length] = 0x80;
    var dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(padded.length - 4, bitLen >>> 0, false);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var off = 0; off < padded.length; off += 64) {
      var t;
      for (t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4, false);
      for (t = 16; t < 64; t++) {
        var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }

  /** 문자열의 SHA-256(소문자 16진수). 가능하면 WebCrypto, 아니면 순수 JS. */
  function sha256Hex(text) {
    var c = global.crypto;
    if (c && c.subtle && typeof c.subtle.digest === "function") {
      return c.subtle.digest("SHA-256", utf8Bytes(text)).then(function (buf) {
        var bytes = new Uint8Array(buf), out = "";
        for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
        return out;
      }, function () { return sha256HexJs(text); });
    }
    return Promise.resolve(sha256HexJs(text));
  }

  // ---------------------------------------------------------------------------
  // 검증 로직 (화면과 분리 — 단위 테스트 가능)
  // ---------------------------------------------------------------------------
  function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  /** 입력한 코드가 config.codes 의 어느 digest 와 일치하는지 확인합니다. 앞뒤 공백은 무시합니다. */
  function verifyCode(code, config) {
    var codes = (config && config.codes) || [];
    return sha256Hex(String(code == null ? "" : code).trim()).then(function (hex) {
      var ok = false;
      for (var i = 0; i < codes.length; i++) {
        if (safeEqual(hex, String(codes[i].digest || "").toLowerCase())) ok = true; // 모두 비교(조기 종료 없음)
      }
      return ok;
    });
  }

  function readSession(storage) {
    try {
      var raw = storage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  /** 이 세션이 현재 설정 version 으로 허용된 상태인지 */
  function isUnlockedFor(config, storage) {
    var s = readSession(storage);
    return !!(s && s.ok === true && config && s.version === config.version);
  }

  function markUnlocked(config, storage) {
    try { storage.setItem(SESSION_KEY, JSON.stringify({ ok: true, version: config.version, at: Date.now() })); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // 화면(DOM) — 브라우저에서만 동작
  // ---------------------------------------------------------------------------
  var hasDom = typeof document !== "undefined" && document.documentElement;
  var config = null;
  var failCount = 0;

  function injectStyle() {
    var css =
      "html.auth-locked{overflow:hidden !important}" +
      "html.auth-locked body>*:not(#authGate){visibility:hidden !important}" +
      "#authGate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;" +
      "background:#0f172a;color:#f8fafc;font-family:Pretendard,'Malgun Gothic',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
      "#authGate .ag-card{width:100%;max-width:380px;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:26px 22px;box-shadow:0 10px 40px rgba(0,0,0,.45)}" +
      "#authGate h1{font-size:19px;margin:0 0 6px}" +
      "#authGate p{font-size:13px;line-height:1.6;color:#cbd5e1;margin:0 0 14px}" +
      "#authGate label{display:block;font-size:12px;color:#94a3b8;margin-bottom:6px}" +
      "#authGate input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #475569;background:#0f172a;color:#f8fafc;font-size:15px}" +
      "#authGate input:focus{outline:2px solid #38bdf8;outline-offset:1px}" +
      "#authGate button{width:100%;margin-top:12px;padding:11px;border:0;border-radius:10px;background:#0ea5e9;color:#fff;font-size:15px;font-weight:700;cursor:pointer}" +
      "#authGate button:disabled{opacity:.6;cursor:default}" +
      "#authGate .ag-err{min-height:18px;margin-top:10px;font-size:12.5px;color:#fda4af}" +
      "#authGate .ag-note{margin:14px 0 0;font-size:11.5px;color:#94a3b8}";
    var st = document.createElement("style");
    st.id = "authStyle";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function lockPage() { document.documentElement.classList.add("auth-locked"); }
  function releasePage() {
    document.documentElement.classList.remove("auth-locked");
    var g = document.getElementById("authGate");
    if (g && g.parentNode) g.parentNode.removeChild(g);
    // 잠긴 동안 크기를 못 잰 요소(캔버스 등)가 있을 수 있어 레이아웃 갱신을 알림
    try { global.dispatchEvent(new Event("resize")); } catch (_) {}
  }

  function whenBodyReady(fn) {
    if (document.body) fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  function showGate(message) {
    whenBodyReady(function () {
      if (document.getElementById("authGate")) return;
      var g = document.createElement("div");
      g.id = "authGate";
      g.setAttribute("role", "dialog");
      g.setAttribute("aria-modal", "true");
      g.setAttribute("aria-labelledby", "agTitle");
      g.innerHTML =
        '<form class="ag-card" autocomplete="off">' +
        '<h1 id="agTitle">🔒 초대받은 분만 이용할 수 있습니다</h1>' +
        "<p>안내받은 접속 코드를 입력해 주세요.</p>" +
        '<label for="agCode">접속 코드</label>' +
        '<input id="agCode" name="code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" />' +
        '<div class="ag-err" role="alert" aria-live="assertive"></div>' +
        '<button type="submit">확인</button>' +
        '<p class="ag-note">간단한 접근 제한입니다. 허용 상태는 이 탭에서만 유지되며, 탭을 닫으면 다시 입력해야 합니다.</p>' +
        "</form>";
      document.body.appendChild(g);
      var form = g.querySelector("form");
      var input = g.querySelector("#agCode");
      var err = g.querySelector(".ag-err");
      var btn = g.querySelector("button");
      if (message) err.textContent = message;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (btn.disabled) return;
        var code = input.value;
        btn.disabled = true;
        unlock(code).then(function (ok) {
          if (ok) return; // 성공: unlock()이 화면을 풀어 줍니다
          failCount++;
          input.value = "";
          err.textContent = "코드가 올바르지 않습니다. 다시 확인해 주세요.";
          // 연속 실패 시 잠깐 대기 (무차별 입력을 늦추는 간단한 장치)
          var wait = failCount >= 3 ? Math.min(10, failCount) * 1000 : 0;
          setTimeout(function () { btn.disabled = false; input.focus(); }, wait);
          if (wait) err.textContent += " (" + Math.round(wait / 1000) + "초 후 다시 시도할 수 있습니다)";
        });
      });
      setTimeout(function () { input.focus(); }, 0);
    });
  }

  function loadConfig() {
    var base = (document.currentScript && document.currentScript.src) || (scriptSrc || "");
    var url = new URL(CONFIG_PATH, base || document.baseURI).href;
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("설정 파일을 불러오지 못했습니다 (" + r.status + ")");
      return r.json();
    });
  }

  var scriptSrc = hasDom && document.currentScript ? document.currentScript.src : "";

  /** 코드를 확인하고, 맞으면 sessionStorage 에 기록한 뒤 화면을 엽니다. 성공 여부(Promise<boolean>)를 반환합니다. */
  function unlock(code) {
    if (!config) return Promise.resolve(false);
    return verifyCode(code, config).then(function (ok) {
      if (ok) {
        markUnlocked(config, global.sessionStorage);
        if (hasDom) releasePage();
      }
      return ok;
    });
  }

  /** 접근 허용 상태를 지우고 다시 잠급니다. */
  function lock() {
    try { global.sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    if (hasDom) global.location.reload();
  }

  /** 페이지 로드 시 호출: 먼저 가리고, 설정을 읽어 허용 상태면 열고 아니면 입력창을 보여 줍니다. */
  function initAuth() {
    if (!hasDom) return;
    injectStyle();
    // 로컬 파일(file://)은 설정 파일을 읽을 수 없고 이미 파일을 가진 경우라 게이트를 적용하지 않습니다.
    if (global.location && global.location.protocol === "file:") return;
    lockPage();
    loadConfig().then(function (cfg) {
      config = cfg;
      if (isUnlockedFor(cfg, global.sessionStorage)) releasePage();
      else showGate();
    }).catch(function (e) {
      // 설정을 못 읽으면 열지 않고(fail-closed) 안내만 보여 줍니다.
      showGate("접속 설정을 확인하지 못했습니다. 잠시 후 새로고침해 주세요. (" + (e && e.message ? e.message : "오류") + ")");
    });
  }

  global.SiteAuth = {
    initAuth: initAuth,
    unlock: unlock,
    lock: lock,
    // 테스트용 내부 함수
    _test: { sha256Hex: sha256Hex, sha256HexJs: sha256HexJs, verifyCode: verifyCode, isUnlockedFor: isUnlockedFor, markUnlocked: markUnlocked, SESSION_KEY: SESSION_KEY },
  };

  initAuth();
})(typeof window !== "undefined" ? window : globalThis);
