/* =========================================================================
   app.js — wiring. Boots the flow engine + dashboard, hooks the toolbar
   controls, runs the live clock. Loaded last.
   ========================================================================= */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }

  document.addEventListener("DOMContentLoaded", function () {
    FLOW.init("flowCanvas");
    DASH.init({
      kAlerts: "kAlerts", kHigh: "kHigh", kDis: "kDis", kSamp: "kSamp",
      log: "logStream", table: "alertTable",
      dchart: "dChart", schart: "sChart", risk: "riskBoard", focus: "focusPanel"
    });

    /* legends */
    var srcLeg = $("srcLegend");
    if (srcLeg) HUB.SOURCES.forEach(function (s) {
      var i = document.createElement("span"); i.className = "leg";
      i.innerHTML = '<i style="background:' + s.color + '"></i>' + s.n;
      srcLeg.appendChild(i);
    });
    var riskLeg = $("riskLegend");
    if (riskLeg) HUB.RISK.forEach(function (r) {
      var i = document.createElement("span"); i.className = "leg";
      i.innerHTML = '<i style="background:' + r.color + '"></i>' + r.label;
      riskLeg.appendChild(i);
    });

    /* controls */
    var playBtn = $("playBtn");
    playBtn.addEventListener("click", function () {
      var on = FLOW.toggle();
      playBtn.innerHTML = on ? "❚❚ Pause" : "▶ Resume";
      playBtn.classList.toggle("paused", !on);
      $("statusDot").classList.toggle("off", !on);
      $("statusText").textContent = on ? "LIVE" : "PAUSED";
    });

    var speeds = [["1×", 1], ["2×", 2], ["4×", 4]];
    var speedWrap = $("speedWrap");
    speeds.forEach(function (s, i) {
      var b = document.createElement("button");
      b.className = "seg" + (i === 0 ? " on" : "");
      b.textContent = s[0];
      b.addEventListener("click", function () {
        FLOW.setSpeed(s[1]);
        [].forEach.call(speedWrap.children, function (c) { c.classList.remove("on"); });
        b.classList.add("on");
      });
      speedWrap.appendChild(b);
    });

    $("surgeBtn").addEventListener("click", function () {
      FLOW.injectOutbreak();
      var b = $("surgeBtn");
      if (b.animate) b.animate([{ transform: "scale(1)" }, { transform: "scale(0.94)" }, { transform: "scale(1)" }], { duration: 220 });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === " ") { e.preventDefault(); playBtn.click(); }
      else if (e.key === "o" || e.key === "O") { $("surgeBtn").click(); }
    });

    /* live clock */
    function tickClock() {
      var d = new Date();
      $("clock").textContent =
        String(d.getHours()).padStart(2, "0") + ":" +
        String(d.getMinutes()).padStart(2, "0") + ":" +
        String(d.getSeconds()).padStart(2, "0");
      setTimeout(tickClock, 1000);
    }
    tickClock();
  });
})();
