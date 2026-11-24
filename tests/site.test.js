// 사이트 무결성: 모든 HTML의 내부 링크·스크립트·스타일 파일과 #앵커가 실제로 존재하는지 확인합니다.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DOCS = path.join(__dirname, "..", "docs");
const pages = fs.readdirSync(DOCS).filter((f) => f.endsWith(".html"));
const read = (f) => fs.readFileSync(path.join(DOCS, f), "utf-8");
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

function refs(html) {
  return [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|data:|javascript:)/.test(u));
}

test("모든 페이지의 내부 링크와 리소스가 존재한다", () => {
  const broken = [];
  for (const f of pages) {
    const html = read(f);
    for (const ref of refs(html)) {
      const [rawPath, hash] = ref.split("#");
      const file = rawPath.split("?")[0] || f; // "#id"만 있는 링크는 자기 자신
      const target = path.join(DOCS, file);
      if (!fs.existsSync(target)) { broken.push(`${f} → ${ref} (파일 없음)`); continue; }
      if (hash && file.endsWith(".html") && !ids(read(file)).has(hash)) broken.push(`${f} → ${ref} (앵커 없음)`);
    }
  }
  assert.deepStrictEqual(broken, []);
});

test("상단 메뉴(nav.js)의 모든 항목이 실제 페이지를 가리킨다", () => {
  const nav = read("nav.js");
  const hrefs = [...nav.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 8);
  for (const h of hrefs) assert.ok(fs.existsSync(path.join(DOCS, h)), `${h} 없음`);
});

test("모든 페이지에 제목·언어·뷰포트 메타와 면책/메뉴가 있다", () => {
  for (const f of pages) {
    const html = read(f);
    assert.match(html, /<html lang="ko"/, `${f}: lang`);
    assert.match(html, /<title>[^<]{3,}<\/title>/, `${f}: title`);
    assert.match(html, /name="viewport"/, `${f}: viewport`);
    assert.match(html, /id="siteNav"/, `${f}: 메뉴`);
  }
});

test("모든 페이지가 <head> 안에서 접속 코드 게이트(assets/site.js)를 불러온다", () => {
  for (const f of pages) {
    const html = read(f);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    assert.ok(head.includes('src="assets/site.js"'), `${f}: site.js 없음`);
    // 게이트는 다른 스크립트·스타일보다 먼저 실행되어야 깜빡임 없이 가려집니다.
    const gate = head.indexOf("assets/site.js");
    const firstStyle = head.indexOf("<link");
    assert.ok(firstStyle === -1 || gate < firstStyle, `${f}: site.js가 스타일보다 앞이어야 함`);
  }
});

test("개인 식별 정보(작성자 이름)가 사이트에 없다", () => {
  for (const f of fs.readdirSync(DOCS).filter((x) => /\.(html|js|css|json)$/.test(x))) {
    assert.ok(!read(f).includes("\uc720\uc2b9\ud601"), `${f}에 작성자 이름이 있음`);
  }
});
