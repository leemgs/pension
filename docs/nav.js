/* 공통 상단 메뉴: 모든 페이지에서 <nav id="siteNav"></nav> 자리에 삽입됩니다. */
(function () {
  var items = [
    { href: "index.html", label: "📊 시뮬레이터" },
    { href: "scenarios.html", label: "🗂️ 시나리오" },
    { href: "compare.html", label: "⚖️ 비교" },
    { href: "guide.html", label: "📖 사용 가이드" },
    { href: "manual.html", label: "📘 사용자 매뉴얼" },
    { href: "assumptions.html", label: "📐 가정·세법 기준" },
    { href: "links.html", label: "🔗 참고 링크" },
  ];
  var cur = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var el = document.getElementById("siteNav");
  if (!el) return;
  el.className = "site-nav";
  el.setAttribute("aria-label", "주 메뉴");
  el.innerHTML = items
    .map(function (it) {
      var on = it.href === cur ? ' class="active" aria-current="page"' : "";
      return '<a href="' + it.href + '"' + on + ">" + it.label + "</a>";
    })
    .join("");
})();
