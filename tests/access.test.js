// 접속 코드 게이트(docs/assets/site.js, docs/config/access.json) 검증.
// 주의: 실제 접속 코드(평문)는 저장소에 두지 않으므로, 테스트는 임의의 테스트용 코드로 로직만 확인합니다.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const nodeCrypto = require("node:crypto");

const DOCS = path.join(__dirname, "..", "docs");
const siteSrc = fs.readFileSync(path.join(DOCS, "assets", "site.js"), "utf-8");
const config = JSON.parse(fs.readFileSync(path.join(DOCS, "config", "access.json"), "utf-8"));
const sha = (s) => nodeCrypto.createHash("sha256").update(s, "utf8").digest("hex");

function load(extra) {
  const sandbox = Object.assign({ console, TextEncoder, Promise, Uint8Array, DataView, Date, JSON, Math }, extra || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(siteSrc, sandbox);
  return sandbox.SiteAuth._test;
}

test("access.json: 해시만 저장하고 형식이 올바르다", () => {
  assert.ok(Number.isInteger(config.version) && config.version >= 1);
  assert.strictEqual(config.algorithm, "SHA-256");
  assert.ok(Array.isArray(config.codes) && config.codes.length >= 2, "접속 코드는 2개 이상");
  const seen = new Set();
  for (const c of config.codes) {
    assert.match(c.digest, /^[0-9a-f]{64}$/, "digest는 SHA-256 16진수 64자");
    assert.ok(!seen.has(c.digest), "digest 중복 없음");
    seen.add(c.digest);
    const keys = Object.keys(c).sort().join(",");
    assert.strictEqual(keys, "digest,label", "label과 digest 외 필드(평문 코드 등) 없음");
  }
  const raw = fs.readFileSync(path.join(DOCS, "config", "access.json"), "utf-8");
  assert.ok(!/password|plain|secret/i.test(raw.replace(/"note":[^\n]*/, "")), "평문 비밀번호 관련 필드 없음");
});

test("SHA-256: 순수 JS 구현이 표준 벡터·노드 결과와 일치 (한글·긴 입력 포함)", () => {
  const t = load();
  assert.strictEqual(t.sha256HexJs("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.strictEqual(t.sha256HexJs(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const samples = ["a", "접속코드", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000), "한글 + English 123 !@#"];
  for (const s of samples) assert.strictEqual(t.sha256HexJs(s), sha(s), `입력 길이 ${s.length}`);
});

test("SHA-256: WebCrypto 경로와 대체 경로가 같은 결과", async () => {
  const withSubtle = load({ crypto: nodeCrypto.webcrypto });
  const without = load();
  for (const s of ["abc", "테스트코드", "guest-code"]) {
    assert.strictEqual(await withSubtle.sha256Hex(s), sha(s));
    assert.strictEqual(await without.sha256Hex(s), sha(s));
  }
});

test("verifyCode: 일치하는 코드만 통과하고 앞뒤 공백은 무시한다", async () => {
  const t = load();
  const cfg = { version: 1, codes: [{ label: "a", digest: sha("test-code-one") }, { label: "b", digest: sha("test-code-two") }] };
  assert.strictEqual(await t.verifyCode("test-code-one", cfg), true);
  assert.strictEqual(await t.verifyCode("  test-code-two \n", cfg), true);
  assert.strictEqual(await t.verifyCode("test-code-ONE", cfg), false, "대소문자 구분");
  assert.strictEqual(await t.verifyCode("", cfg), false);
  assert.strictEqual(await t.verifyCode(null, cfg), false);
  assert.strictEqual(await t.verifyCode("test-code-one", { version: 1, codes: [] }), false);
  assert.strictEqual(await t.verifyCode("test-code-one", null), false);
});

test("세션 기록: 같은 version일 때만 허용 상태, version을 올리면 다시 잠긴다", () => {
  const t = load();
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const v1 = { version: 1, codes: [] }, v2 = { version: 2, codes: [] };
  assert.strictEqual(t.isUnlockedFor(v1, storage), false, "처음에는 잠김");
  t.markUnlocked(v1, storage);
  assert.strictEqual(t.isUnlockedFor(v1, storage), true);
  assert.strictEqual(t.isUnlockedFor(v2, storage), false, "version 변경 시 재인증");
  store.set(t.SESSION_KEY, "{깨진 json");
  assert.strictEqual(t.isUnlockedFor(v1, storage), false, "손상된 기록은 잠김");
  store.set(t.SESSION_KEY, JSON.stringify({ ok: false, version: 1 }));
  assert.strictEqual(t.isUnlockedFor(v1, storage), false);
});

test("digest는 config 파일 밖(스크립트·페이지)에 복제되지 않는다", () => {
  for (const c of config.codes) {
    for (const f of ["assets/site.js", "nav.js", "index.html"]) {
      assert.ok(!fs.readFileSync(path.join(DOCS, f), "utf-8").includes(c.digest), `${f}에 digest 복제 없음`);
    }
  }
});
