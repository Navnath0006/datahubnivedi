/* =========================================================================
   dashboard.js — the right-hand + lower panels (section 5B).
   Subscribes to FLOW events and renders live: KPI counters, recent-alerts
   table, disease/state bar charts, a state risk board, and an event log.
   ========================================================================= */
window.DASH = (function () {
  "use strict";

  function el(t, c, h){ var e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; }

  /* KPI counters with smooth tweening */
  var kpis = {
    alerts:   { node: null, val: 1256, target: 1256 },
    highRisk: { node: null, val: 278,  target: 278 },
    diseases: { node: null, val: 98,   target: 98 },
    samples:  { node: null, val: 45,   target: 45 }
  };
  var diseaseTally = {}, stateTally = {}, stateRisk = {};
  var logHost, tableHost, dChartHost, sChartHost, riskHost, focusHost;

  function init(ids) {
    kpis.alerts.node   = document.getElementById(ids.kAlerts);
    kpis.highRisk.node = document.getElementById(ids.kHigh);
    kpis.diseases.node = document.getElementById(ids.kDis);
    kpis.samples.node  = document.getElementById(ids.kSamp);
    logHost    = document.getElementById(ids.log);
    tableHost  = document.getElementById(ids.table);
    dChartHost = document.getElementById(ids.dchart);
    sChartHost = document.getElementById(ids.schart);
    riskHost   = document.getElementById(ids.risk);
    focusHost  = document.getElementById(ids.focus);

    HUB.DISEASES.forEach(function (d) { diseaseTally[d.name] = 2 + ((Math.random()*8)|0); });
    HUB.STATES.forEach(function (s) { stateTally[s.name] = 1 + ((Math.random()*6)|0); stateRisk[s.name] = s.base; });

    buildCharts();
    buildRisk();
    wire();
    tweenLoop();
    resetFocus();
  }

  function wire() {
    FLOW.on("tick", function (c) {
      kpis.alerts.target   = 1256 + c.alerts;
      kpis.samples.target  = 45 + c.samples;
    });
    FLOW.on("alert", function (p) {
      if (p.risk.key === "high" || p.risk.key === "very_high") kpis.highRisk.target += 1;
      diseaseTally[p.dis.name] = (diseaseTally[p.dis.name] || 0) + 1;
      stateTally[p.st.name] = (stateTally[p.st.name] || 0) + 1;
      escalate(p.st.name, p.risk.key);
      addAlertRow(p);
      refreshCharts();
      refreshRisk();
    });
    FLOW.on("hotspot", function (p) { flashRisk(p.st.name); });
    FLOW.on("sample", function () { /* counter handled via tick */ });
    FLOW.on("log", function (p) { pushLog(p.text, p.kind); });
    FLOW.on("focus", function (p) { showFocus(p.node); });

    /* diseases-monitored drifts up occasionally, feels alive */
    setInterval(function () {
      if (!FLOW.isRunning()) return;
      if (Math.random() < 0.25) kpis.diseases.target += 1;
    }, 4000);
  }

  /* ----------------------------------------------------- KPI tween */
  function tweenLoop() {
    Object.keys(kpis).forEach(function (k) {
      var o = kpis[k]; if (!o.node) return;
      if (o.val !== o.target) {
        o.val += (o.target - o.val) * 0.12;
        if (Math.abs(o.target - o.val) < 0.6) o.val = o.target;
        o.node.textContent = Math.round(o.val).toLocaleString();
      }
    });
    requestAnimationFrame(tweenLoop);
  }

  /* --------------------------------------------------- alerts table */
  function addAlertRow(p) {
    if (!tableHost) return;
    var risk = p.risk;
    var row = el("div", "trow");
    row.style.borderLeftColor = risk.color;
    row.innerHTML =
      '<span class="tc tc-dis">' + p.dis.name + '</span>' +
      '<span class="tc tc-sp">' + p.dis.species + '</span>' +
      '<span class="tc tc-loc">' + p.st.name + '</span>' +
      '<span class="tc tc-sev" style="color:' + risk.color + '">' + risk.label + '</span>';
    tableHost.insertBefore(row, tableHost.firstChild);
    while (tableHost.children.length > 7) tableHost.removeChild(tableHost.lastChild);
    row.animate ? row.animate([{ opacity: 0, transform: "translateX(8px)" }, { opacity: 1, transform: "none" }], { duration: 260 }) : 0;
  }

  /* -------------------------------------------------------- charts */
  function buildCharts() {
    if (dChartHost) {
      dChartHost.innerHTML = "";
      HUB.DISEASES.slice(0, 6).forEach(function (d) {
        var b = el("div", "bar");
        b.dataset.name = d.name;
        b.innerHTML = '<span class="bar-fill"></span><span class="bar-lab">' + shortDis(d.name) + '</span>';
        dChartHost.appendChild(b);
      });
    }
    if (sChartHost) {
      sChartHost.innerHTML = "";
      HUB.STATES.slice(0, 8).forEach(function (s) {
        var b = el("div", "bar");
        b.dataset.name = s.name;
        b.innerHTML = '<span class="bar-fill s"></span><span class="bar-lab">' + shortState(s.name) + '</span>';
        sChartHost.appendChild(b);
      });
    }
    refreshCharts();
  }
  function refreshCharts() {
    if (dChartHost) {
      var max = Math.max.apply(null, HUB.DISEASES.map(function (d) { return diseaseTally[d.name] || 1; }));
      [].forEach.call(dChartHost.children, function (b) {
        var v = diseaseTally[b.dataset.name] || 0;
        b.querySelector(".bar-fill").style.height = Math.max(4, (v / max) * 100) + "%";
        b.querySelector(".bar-fill").title = v + " alerts";
      });
    }
    if (sChartHost) {
      var maxs = Math.max.apply(null, HUB.STATES.map(function (s) { return stateTally[s.name] || 1; }));
      [].forEach.call(sChartHost.children, function (b) {
        var v = stateTally[b.dataset.name] || 0;
        b.querySelector(".bar-fill").style.height = Math.max(4, (v / maxs) * 100) + "%";
      });
    }
  }

  /* ---------------------------------------------------- risk board */
  var RANK = { very_low: 0, low: 1, moderate: 2, high: 3, very_high: 4 };
  function escalate(state, riskKey) {
    if (RANK[riskKey] > RANK[stateRisk[state] || "very_low"]) stateRisk[state] = riskKey;
  }
  function buildRisk() {
    if (!riskHost) return;
    riskHost.innerHTML = "";
    HUB.STATES.forEach(function (s) {
      var c = el("div", "rcell");
      c.dataset.name = s.name;
      c.innerHTML = '<span class="rcell-n">' + s.name + '</span>';
      riskHost.appendChild(c);
    });
    refreshRisk();
  }
  function refreshRisk() {
    if (!riskHost) return;
    [].forEach.call(riskHost.children, function (c) {
      var r = HUB.riskByKey(stateRisk[c.dataset.name] || "very_low");
      c.style.background = r.color + "22";
      c.style.borderColor = r.color;
      c.style.color = "#E8EEFA";
    });
  }
  function flashRisk(state) {
    if (!riskHost) return;
    [].forEach.call(riskHost.children, function (c) {
      if (c.dataset.name === state && c.animate) {
        c.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 500 });
      }
    });
  }

  /* ------------------------------------------------------ event log */
  var LOG_ICON = { ingest: "▸", hotspot: "◉", fraud: "✕", alert: "▲", confirm: "✓", sms: "✉", sample: "🧬", surge: "⚠" };
  var LOG_COL  = { ingest: "muted", hotspot: "cyan", fraud: "red", alert: "purple", confirm: "green", sms: "blue", sample: "violet", surge: "amber" };
  function pushLog(text, kind) {
    if (!logHost) return;
    var line = el("div", "logline " + (LOG_COL[kind] || "muted"));
    var t = new Date();
    var stamp = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0") + ":" + String(t.getSeconds()).padStart(2, "0");
    line.innerHTML = '<span class="log-t">' + stamp + '</span><span class="log-i">' + (LOG_ICON[kind] || "·") + '</span><span class="log-x">' + text + '</span>';
    logHost.insertBefore(line, logHost.firstChild);
    while (logHost.children.length > 40) logHost.removeChild(logHost.lastChild);
  }

  /* --------------------------------------------------- focus panel */
  function resetFocus() {
    if (!focusHost) return;
    focusHost.innerHTML = '<div class="focus-h">Stage inspector</div>' +
      '<p class="focus-p">Click any stage in the flow to read what it does. Data records move left to right; ' +
      'colour marks the source stream, then the risk level once an alert is confirmed.</p>';
  }
  function showFocus(node) {
    if (!focusHost) return;
    if (!node) { resetFocus(); return; }
    var info = HUB.STAGES[node.id];
    if (!info) {
      var src = HUB.SOURCES.filter(function (s) { return s.id === node.id; })[0];
      if (!src) { resetFocus(); return; }
      focusHost.innerHTML = '<div class="focus-h" style="color:' + src.color + '">' + src.n + '</div>' +
        '<p class="focus-p">Ingestion stream. Feeds: ' + src.items.join(", ") + '.</p>';
      return;
    }
    focusHost.innerHTML = '<div class="focus-h">' + info.title + '</div>' +
      '<div class="focus-sub">' + info.sub + '</div>' +
      '<p class="focus-p">' + info.detail + '</p>';
  }

  /* ------------------------------------------------------ helpers */
  function shortDis(n) {
    return { "Lumpy Skin Disease": "LSD", "Foot & Mouth Disease": "FMD", "Avian Influenza": "AI",
             "Brucellosis": "Bruc", "PPR": "PPR", "Classical Swine Fever": "CSF", "Bluetongue": "BT" }[n] || n;
  }
  function shortState(n) {
    return { "Uttar Pradesh": "UP", "Madhya Pradesh": "MP", "Maharashtra": "MH", "Rajasthan": "RJ",
             "Gujarat": "GJ", "Punjab": "PB", "Kerala": "KL", "Karnataka": "KA", "Tamil Nadu": "TN",
             "West Bengal": "WB", "Bihar": "BR", "Assam": "AS" }[n] || n.slice(0, 3);
  }

  return { init: init };
})();
