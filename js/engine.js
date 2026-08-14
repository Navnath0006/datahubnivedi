/* =========================================================================
   engine.js — the live pipeline.
   Data records spawn from the 7 sources, snake through the processing
   engine (ingest -> cluster -> verify), pass the govt gate, get risk-scored
   at prediction, and fan out as advisories. Every meaningful moment is
   dispatched as an event so the dashboard can react. Pure canvas, no deps.
   ========================================================================= */
window.FLOW = (function () {
  "use strict";

  var C = {
    ink: "#E8EEFA", muted: "#8FA0C8", panel: "rgba(14,22,48,0.92)",
    edge: "rgba(120,150,220,0.20)", edgeLit: "rgba(120,150,220,0.5)",
    engine: "#22D3EE", gate: "#A855F7", pred: "#10B981", out: "#60A5FA",
    drop: "#EF4444", grid: "rgba(120,150,220,0.06)"
  };

  var cv, ctx, host, W = 0, H = 0, dpr = 1;
  var nodes = {}, packets = [], sparks = [], pulses = [];
  var raf = null, last = 0, running = false, reduced = false;
  var spawnAcc = 0, speed = 1, baseRate = 4.2, surge = 0;
  var listeners = {};
  var focusId = null;
  var counts = { ingested: 0, dropped: 0, alerts: 0, samples: 0 };
  var prediction = {
    evidence: 0.42, context: "National baseline", r0: 2.1,
    curves: null, lastBuild: 0, dirty: true,
    mapRisk: {}, hotspots: []
  };
  var RISK_SCORE = { very_low: 0.16, low: 0.32, moderate: 0.52, high: 0.73, very_high: 0.91 };

  /* --------------------------------------------------------- pub/sub */
  function on(ev, fn){ (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, payload){ (listeners[ev] || []).forEach(function(fn){ fn(payload); }); }

  /* ------------------------------------------------------------- init */
  function init(canvasId) {
    cv = document.getElementById(canvasId);
    if (!cv) return;
    host = cv.parentElement;
    ctx = cv.getContext("2d");
    reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    initPredictionModels();
    resize();
    window.addEventListener("resize", resize);
    cv.addEventListener("click", onClick);
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    if (!cv || !host) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = host.clientWidth || 900;
    var h = host.clientHeight || 560;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = w; H = h;
    layout();
  }

  /* --------------------------------------------------------- layout */
  function layout() {
    nodes = {};
    var S = HUB.SOURCES;
    var sx = W * 0.015, sw = W * 0.152;
    var top = H * 0.075, bot = H * 0.955, span = bot - top;
    var gap = Math.min(10, span * 0.012);
    /* Every stream gets the same slot regardless of how many sub-sources it
       lists; the longer lists wrap into columns rather than growing taller. */
    var slot = span / S.length, sh = slot - gap;
    S.forEach(function (src, i) {
      var y = top + i * slot;
      nodes[src.id] = { id: src.id, kind: "source", x: sx, y: y, w: sw, h: sh,
        cx: sx + sw, cy: y + sh / 2, color: src.color, title: src.n, src: src };
    });

    /* engine container + 3 chambers */
    var ex = W * 0.285, ew = W * 0.20;
    var eTop = H * 0.10, eBot = H * 0.93;
    nodes.ENGINE_BOX = { kind: "box", x: ex, y: eTop, w: ew, h: eBot - eTop };
    var chH = (eBot - eTop) * 0.24;
    var slots = [0.11, 0.42, 0.73];
    [["ING", C.engine], ["CLU", C.engine], ["VER", C.engine]].forEach(function (p, i) {
      var y = eTop + (eBot - eTop) * slots[i];
      nodes[p[0]] = { id: p[0], kind: "proc", x: ex + ew * 0.08, y: y, w: ew * 0.84, h: chH,
        cx: ex + ew / 2, cy: y + chH / 2, color: p[1] };
    });

    function block(id, fx, color, label, widthRatio, heightRatio) {
      var w = W * (widthRatio || 0.115);
      var h = H * (heightRatio || 0.20);
      var x = W * fx, y = H * 0.5 - h / 2;
      nodes[id] = { id: id, kind: "block", x: x, y: y, w: w, h: h,
        cx: x + w / 2, cy: y + h / 2, color: color, title: label };
    }
    block("GATE", 0.55,  C.gate, "GOVT GATE");
    /* Prediction holds two stacked model views, so it gets a wider/taller shell.
       Its centre stays aligned with the old card to preserve packet routing. */
    block("PRED", 0.675, C.pred, "PREDICTION", 0.19, 0.72);
    block("OUT",  0.875, C.out,  "ADVISORY");
  }

  /* ------------------------------------------------------- packets */
  function weightedSource() {
    var total = 0; HUB.SOURCES.forEach(function (s) { total += s.weight; });
    var r = Math.random() * total;
    for (var i = 0; i < HUB.SOURCES.length; i++) { r -= HUB.SOURCES[i].weight; if (r <= 0) return HUB.SOURCES[i]; }
    return HUB.SOURCES[0];
  }

  function spawn() {
    var src = weightedSource();
    var dis = HUB.pick(HUB.DISEASES), st = HUB.pick(HUB.STATES);
    packets.push({
      route: [src.id, "ING", "CLU", "VER", "GATE", "PRED", "OUT"],
      seg: 0, t: 0, color: src.color, src: src, dis: dis, st: st,
      speed: 0.55 + Math.random() * 0.25, r: 3.4, dwell: 0, processedAt: {},
      sample: !!src.sample, verified: true, risk: null, dead: false
    });
    counts.ingested++;
    if (Math.random() < 0.22) emit("log", { kind: "ingest", text: HUB.LOG.ingest(src) });
  }

  function nodeCenter(id) { var n = nodes[id]; return n ? { x: n.cx, y: n.cy } : { x: 0, y: 0 }; }
  function dist(a, b) { var dx = b.x - a.x, dy = b.y - a.y; return Math.sqrt(dx * dx + dy * dy) || 1; }

  function step(dt) {
    for (var i = packets.length - 1; i >= 0; i--) {
      var q = packets[i];

      /* processing dwell at a node */
      if (q.dwell > 0) { q.dwell -= dt; continue; }

      var aId = q.route[q.seg], bId = q.route[q.seg + 1];
      if (!bId) { arriveOutput(q); packets.splice(i, 1); continue; }
      var a = nodeCenter(aId), b = nodeCenter(bId);
      q.t += (q.speed * speed * 120 * dt) / dist(a, b);

      if (q.t >= 1) {
        q.t = 0; q.seg++;
        var reached = q.route[q.seg];
        onReach(q, reached);
        if (q.dead) { packets.splice(i, 1); continue; }
      }
      q.x = a.x + (b.x - a.x) * q.t;
      q.y = a.y + (b.y - a.y) * q.t;
    }

    for (var s = sparks.length - 1; s >= 0; s--) {
      var sp = sparks[s]; sp.life -= dt * 2.2; sp.x += sp.vx * dt; sp.y += sp.vy * dt;
      if (sp.life <= 0) sparks.splice(s, 1);
    }
    for (var p = pulses.length - 1; p >= 0; p--) {
      pulses[p].t += dt * 1.8; if (pulses[p].t >= 1) pulses.splice(p, 1);
    }
  }

  function onReach(q, id) {
    if (id === "ING") { q.dwell = reduced ? 0 : 0.25 / speed; burst(nodes.ING.cx, nodes.ING.cy, C.engine, 4); }
    else if (id === "CLU") {
      q.dwell = reduced ? 0 : 0.28 / speed;
      burst(nodes.CLU.cx, nodes.CLU.cy, C.engine, 4);
      if (Math.random() < 0.16) { pulse(nodes.CLU, C.engine); emit("hotspot", { dis: q.dis, st: q.st }); }
    }
    else if (id === "VER") {
      q.dwell = reduced ? 0 : 0.26 / speed;
      /* fraud detection: a slice is dropped here */
      if (Math.random() < 0.12) {
        q.dead = true; counts.dropped++;
        burst(nodes.VER.cx, nodes.VER.cy, C.drop, 10);
        emit("drop", {}); emit("log", { kind: "fraud", text: HUB.LOG.fraud() });
      }
    }
    else if (id === "GATE") {
      q.dwell = reduced ? 0 : 0.22 / speed;
      pulse(nodes.GATE, C.gate);
      if (Math.random() < 0.4) emit("log", { kind: "confirm", text: HUB.LOG.confirm(q.st) });
    }
    else if (id === "PRED") {
      q.dwell = reduced ? 0 : 0.24 / speed;
      pulse(nodes.PRED, C.pred);
      q.riskScore = predictRisk(q);
      q.risk = riskFromScore(q.riskScore);
      q.color = q.risk.color;
      counts.alerts++;
      assimilatePrediction(q);
      emit("alert", { dis: q.dis, st: q.st, risk: q.risk });
      emit("log", { kind: "alert", text: HUB.LOG.alert(q.dis, q.st, q.risk) });
      if (q.sample) { counts.samples++; emit("sample", {}); if (Math.random()<0.5) emit("log",{kind:"sample",text:HUB.LOG.sample()}); }
    }
  }

  function arriveOutput(q) {
    pulse(nodes.OUT, C.out);
    burst(nodes.OUT.cx + nodes.OUT.w / 2, nodes.OUT.cy, q.color || C.out, 8);
    emit("output", { risk: q.risk });
    if (Math.random() < 0.3) emit("log", { kind: "sms", text: HUB.LOG.sms() });
  }

  function initPredictionModels() {
    prediction.mapRisk = {};
    // Only monitored states receive a score; the remaining map areas stay no-data.
    HUB.STATES.forEach(function (state) {
      prediction.mapRisk[state.name] = RISK_SCORE[state.base] || 0.20;
    });
    rebuildEpidemicModel();
  }

  /* Illustrative logistic risk model: historical state baseline is combined
     with source strength, verified genomic evidence and the live surge signal. */
  function predictRisk(q) {
    var sourceSignal = {
      active: 0.11, passive: 0.05, sentinel: 0.10, genomic: 0.13,
      news: 0.02, lit: 0.01, env: 0.08
    }[q.src.id] || 0.04;
    var baseline = prediction.mapRisk[q.st.name];
    if (baseline == null) baseline = RISK_SCORE[q.st.base] || 0.20;
    var diseaseSignal = (HUB.DISEASES.indexOf(q.dis) % 4) * 0.015;
    var noise = (Math.random() - 0.5) * 0.36;
    var logit = -2.20 + baseline * 4.0 + sourceSignal * 3.0 +
      diseaseSignal * 2.0 + surge * 1.65 + noise;
    return clamp(1 / (1 + Math.exp(-logit)), 0.05, 0.98);
  }

  function riskFromScore(score) {
    if (score >= 0.85) return HUB.riskByKey("very_high");
    if (score >= 0.68) return HUB.riskByKey("high");
    if (score >= 0.48) return HUB.riskByKey("moderate");
    if (score >= 0.28) return HUB.riskByKey("low");
    return HUB.riskByKey("very_low");
  }

  function assimilatePrediction(q) {
    var old = prediction.mapRisk[q.st.name];
    if (old == null) old = 0.20;
    prediction.mapRisk[q.st.name] = old * 0.68 + q.riskScore * 0.32;
    prediction.evidence = prediction.evidence * 0.88 + q.riskScore * 0.12;
    prediction.context = q.dis.name + " · " + q.st.name;
    prediction.hotspots.unshift({ state: q.st.name, score: q.riskScore, born: performance.now() });
    prediction.hotspots = prediction.hotspots.slice(0, 4);
    prediction.dirty = true;
  }

  function assimilateOutbreak(dis, st) {
    prediction.context = dis.name + " · " + st.name + " surge";
    prediction.evidence = Math.max(0.82, prediction.evidence);
    prediction.mapRisk[st.name] = Math.max(0.88, prediction.mapRisk[st.name] || 0);
    prediction.hotspots.unshift({ state: st.name, score: 0.94, born: performance.now() });
    prediction.hotspots = prediction.hotspots.slice(0, 4);
    prediction.dirty = true;
    rebuildEpidemicModel();
  }

  /* Deterministic SEIR compartment model, solved with a mass-conserving
     quarter-day flow step. Curves are cached; drawing never re-solves it. */
  function rebuildEpidemicModel() {
    prediction.r0 = 1.75 + prediction.evidence * 1.15;
    var initial = {
      e: 0.0030 + prediction.evidence * 0.0035,
      i: 0.0015 + prediction.evidence * 0.0025,
      r: 0
    };
    initial.s = 1 - initial.e - initial.i;
    var base = runSEIR(prediction.r0, initial);
    var low = runSEIR(Math.max(1.1, prediction.r0 - 0.24), initial);
    var high = runSEIR(prediction.r0 + 0.24, initial);
    base.iLow = []; base.iHigh = [];
    for (var i = 0; i < base.i.length; i++) {
      base.iLow.push(Math.min(base.i[i], low.i[i], high.i[i]));
      base.iHigh.push(Math.max(base.i[i], low.i[i], high.i[i]));
    }
    var peak = 0, peakDay = 0;
    base.i.forEach(function (v, day) { if (v > peak) { peak = v; peakDay = day; } });
    base.peak = peak; base.peakDay = peakDay;
    prediction.curves = base;
    prediction.lastBuild = performance.now ? performance.now() : Date.now();
    prediction.dirty = false;
  }

  function runSEIR(r0, initial) {
    var state = { s: initial.s, e: initial.e, i: initial.i, r: initial.r };
    var result = { s: [], e: [], i: [], r: [] };
    var dt = 0.25, sigma = 1 / 4, gamma = 1 / 7, beta = r0 * gamma;
    for (var stepNo = 0; stepNo <= 90 / dt; stepNo++) {
      if (stepNo % 4 === 0) {
        result.s.push(state.s); result.e.push(state.e);
        result.i.push(state.i); result.r.push(state.r);
      }
      var exposed = Math.min(state.s, beta * state.s * state.i * dt);
      var infectious = Math.min(state.e, sigma * state.e * dt);
      var recovered = Math.min(state.i, gamma * state.i * dt);
      state.s -= exposed;
      state.e += exposed - infectious;
      state.i += infectious - recovered;
      state.r += recovered;
    }
    return result;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function burst(x, y, col, n) {
    n = reduced ? Math.min(3, n) : n;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.28, sp = 30 + Math.random() * 70;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col: col });
    }
  }
  function pulse(node, col) { pulses.push({ node: node, col: col, t: 0 }); }

  /* ----------------------------------------------------------- draw */
  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function txt(t, x, y, col, size, align, weight) {
    ctx.fillStyle = col; ctx.textAlign = align || "left"; ctx.textBaseline = "middle";
    ctx.font = (weight || "") + " " + (size || 10) + "px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(t, x, y);
  }
  function hasIconItems(src) {
    return !!(src && src.items && src.items[0] && src.items[0].icon);
  }
  /* Trim a label to `max` px, ending in an ellipsis. Assumes ctx.font is
     already set to the size it will be drawn at. */
  function fit(s, max) {
    if (ctx.measureText(s).width <= max) return s;
    var t = s;
    while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
    return t + "…";
  }
  /* Faint icon + label rows listing a stream's sub-sources inside its node.
     Deliberately low-contrast: the node title stays the readable element. */
  function drawSourceItems(n, items, alpha) {
    var padL = 10, listTop = n.y + 21, listBot = n.y + n.h - 5;
    var avail = listBot - listTop;
    /* Stay single-column while the rows are still legible; a long list wraps
       into a second column rather than shrinking the whole node's type. */
    var cols = (items.length > 5 && avail / items.length < 9) ? 2 : 1;
    var rows = Math.ceil(items.length / cols);
    var row = Math.min(18, avail / rows);
    var colW = (n.w - padL - 6) / cols;
    var fs = Math.max(5.6, Math.min(9.2, row * 0.6));
    var y0 = listTop + Math.max(0, (avail - row * rows) / 2);
    items.forEach(function (it, i) {
      var x = n.x + padL + Math.floor(i / rows) * colW;
      var cy = y0 + row * ((i % rows) + 0.5);
      var tx = x + fs * 1.5;
      ctx.globalAlpha = alpha * 0.55;
      txt(it.icon, x, cy, C.ink, fs * 1.1, "left", "400");
      ctx.globalAlpha = alpha * 0.6;
      ctx.font = "400 " + fs + "px 'Segoe UI', system-ui, sans-serif";
      txt(fit(it.short || it.label, x + colW - 4 - tx), tx, cy, C.ink, fs, "left", "400");
    });
    ctx.globalAlpha = alpha;
  }
  function connector(aId, bId, lit, time) {
    var a = nodeCenter(aId), b = nodeCenter(bId);
    var ax = nodes[aId].x + nodes[aId].w, ay = a.y, bx = nodes[bId].x, by = b.y;
    ctx.strokeStyle = lit ? C.edgeLit : C.edge;
    ctx.lineWidth = lit ? 1.5 : 1;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -(time * 0.03) % 11;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    var mx = (ax + bx) / 2;
    ctx.bezierCurveTo(mx, ay, mx, by, bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw(time) {
    ctx.clearRect(0, 0, W, H);

    /* faint grid */
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (var gx = 0; gx < W; gx += 34) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy < H; gy += 34) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    /* connectors: sources -> ING */
    HUB.SOURCES.forEach(function (s) { connector(s.id, "ING", focusId === s.id, time); });
    connector("ING", "CLU", true, time);
    connector("CLU", "VER", true, time);
    connector("VER", "GATE", true, time);
    connector("GATE", "PRED", true, time);
    connector("PRED", "OUT", true, time);

    /* engine container */
    var eb = nodes.ENGINE_BOX;
    ctx.fillStyle = "rgba(34,211,238,0.04)";
    ctx.strokeStyle = "rgba(34,211,238,0.35)"; ctx.lineWidth = 1.25;
    rr(eb.x, eb.y, eb.w, eb.h, 12); ctx.fill(); ctx.stroke();
    txt("INTELLIGENT PROCESSING & CLUSTERING ENGINE", eb.x + eb.w / 2, eb.y - 12, C.engine, 10.5, "center", "700");
    txt("2", eb.x + 14, eb.y + 14, C.engine, 13, "left", "800");

    /* source nodes */
    HUB.SOURCES.forEach(function (n0) {
      var n = nodes[n0.id], dim = focusId && focusId !== n.id;
      ctx.globalAlpha = dim ? 0.4 : 1;
      ctx.fillStyle = C.panel; ctx.strokeStyle = n.color; ctx.lineWidth = 1.25;
      rr(n.x, n.y, n.w, n.h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = n.color;
      rr(n.x, n.y, 4, n.h, 2); ctx.fill();
      /* Room for a list at all? Title moves up to make space for the rows. */
      if (hasIconItems(n.src) && n.h > 44) {
        txt(n.title, n.x + 11, n.y + 11, C.ink, 11, "left", "600");
        drawSourceItems(n, n.src.items, dim ? 0.4 : 1);
      } else {
        txt(n.title, n.x + 12, n.y + n.h * 0.5, C.ink, Math.min(12, n.h * 0.32), "left", "600");
      }
      ctx.globalAlpha = 1;
    });
    txt("1  DATA INGESTION & CAPTURING", nodes.active.x, nodes.active.y - 14, C.muted, 10.5, "left", "700");

    /* processing chambers */
    [["ING","INGEST & STANDARDISE"],["CLU","CLUSTER & HOTSPOT"],["VER","VERIFY & FRAUD"]].forEach(function (p) {
      var n = nodes[p[0]];
      var glowing = pulses.some(function (pl) { return pl.node === n; });
      ctx.fillStyle = "rgba(34,211,238,0.08)";
      ctx.strokeStyle = glowing ? "#7DE9F7" : "rgba(34,211,238,0.5)";
      ctx.lineWidth = glowing ? 2 : 1;
      rr(n.x, n.y, n.w, n.h, 7); ctx.fill(); ctx.stroke();
      txt(p[1], n.cx, n.cy, "#CFF6FB", Math.min(11, n.h * 0.3), "center", "700");
      /* scanning line */
      if (!reduced) {
        var sxp = n.x + ((time * 0.06) % n.w);
        ctx.strokeStyle = "rgba(125,233,247,0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sxp, n.y + 3); ctx.lineTo(sxp, n.y + n.h - 3); ctx.stroke();
      }
    });

    /* downstream blocks */
    drawBlock("GATE", "3", "GOVT CONFIRMATION", "alert · gate · action");
    drawPredictionBlock(time);
    drawBlock("OUT",  "5", "OUTPUT & ADVISORY", "SMS · app · dashboard");

    /* gate check-mark */
    var g = nodes.GATE;
    ctx.strokeStyle = "#C9A9F5"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    var gx0 = g.cx - 8, gy0 = g.cy + 20;
    ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx0 + 6, gy0 + 6); ctx.lineTo(gx0 + 16, gy0 - 8); ctx.stroke();
    ctx.lineCap = "butt";

    /* pulses (rings) */
    pulses.forEach(function (pl) {
      var n = pl.node, rad = (n.w * 0.6) * pl.t;
      ctx.globalAlpha = 1 - pl.t; ctx.strokeStyle = pl.col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.cx, n.cy, rad + 10, 0, 6.28); ctx.stroke();
      ctx.globalAlpha = 1;
    });

    /* packets */
    packets.forEach(function (q) {
      if (q.x == null) return;
      var dim = focusId && q.route.indexOf(focusId) === -1;
      ctx.globalAlpha = dim ? 0.35 : 1;
      var grd = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 8);
      grd.addColorStop(0, q.color); grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(q.x, q.y, 8, 0, 6.28); ctx.fill();
      ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.28); ctx.fill();
      ctx.globalAlpha = 1;
    });

    /* sparks */
    sparks.forEach(function (sp) {
      ctx.globalAlpha = Math.max(0, sp.life); ctx.fillStyle = sp.col;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.8, 0, 6.28); ctx.fill(); ctx.globalAlpha = 1;
    });

    /* live in-flight readout */
    txt(packets.length + " records in flight", W - 12, 16, C.muted, 11, "right", "600");
  }

  function drawBlock(id, num, title, sub) {
    var n = nodes[id];
    var glowing = pulses.some(function (pl) { return pl.node === n; });
    ctx.fillStyle = C.panel; ctx.strokeStyle = glowing ? lighten(n.color) : n.color;
    ctx.lineWidth = glowing ? 2.2 : 1.4;
    rr(n.x, n.y, n.w, n.h, 10); ctx.fill(); ctx.stroke();
    txt(num, n.x + 12, n.y + 16, n.color, 13, "left", "800");
    txt(title, n.cx, n.cy - 6, C.ink, 12, "center", "700");
    txt(sub, n.cx, n.cy + 12, C.muted, 9.5, "center", "500");
  }

  /* Component 4 has two complementary layers: mathematical disease/case
     simulations first, followed by AI/ML risk prediction on a GIS surface. */
  function drawPredictionBlock(time) {
    var n = nodes.PRED;
    var glowing = pulses.some(function (pl) { return pl.node === n; });
    var pad = Math.max(7, Math.min(10, n.w * 0.05));
    var headerH = Math.max(31, Math.min(38, n.h * 0.10));
    var gap = Math.max(6, Math.min(9, n.h * 0.025));
    var panelX = n.x + pad, panelW = n.w - pad * 2;
    var panelY = n.y + headerH;
    var panelH = (n.h - headerH - pad - gap) / 2;

    ctx.fillStyle = C.panel;
    ctx.strokeStyle = glowing ? lighten(n.color) : n.color;
    ctx.lineWidth = glowing ? 2.2 : 1.4;
    rr(n.x, n.y, n.w, n.h, 10); ctx.fill(); ctx.stroke();

    txt("4", n.x + 11, n.y + 16, n.color, 13, "left", "800");
    fitTxt("PREDICTION & RISK", n.cx, n.y + 17, C.ink, 11.5, "center", "700", n.w - 42, 8.5);

    if (panelH < 44 || panelW < 78) {
      fitTxt("SEIR SIMULATION · NADRES INDIA GIS", n.cx, n.cy + 8, "#6EE7B7", 8, "center", "600", n.w - 18, 6);
      return;
    }
    drawModelPanel(panelX, panelY, panelW, panelH, time);
    drawRiskPanel(panelX, panelY + panelH + gap, panelW, panelH, time);
  }

  function drawInsetPanel(x, y, w, h) {
    ctx.fillStyle = "rgba(16,185,129,0.075)";
    ctx.strokeStyle = "rgba(52,211,153,0.34)";
    ctx.lineWidth = 1;
    rr(x, y, w, h, 8); ctx.fill(); ctx.stroke();
  }

  function drawModelPanel(x, y, w, h, time) {
    drawInsetPanel(x, y, w, h);
    if (prediction.dirty && time - prediction.lastBuild > 650) rebuildEpidemicModel();

    var tx = x + 10;
    var titleSize = h < 100 ? 6.9 : 8.3;
    var lineGap = h < 100 ? 9 : 11;
    drawChartIcon(tx, y + 13, C.pred);
    fitTxt("MATHEMATICAL MODEL SIMULATION", tx + 20, y + 11, C.ink, titleSize, "left", "700", w - 34, 5.8);
    var modelMeta = prediction.curves ?
      "SEIR · 90 DAYS · R₀ " + prediction.r0.toFixed(1) + " · PEAK D" + prediction.curves.peakDay :
      "SEIR · 90-DAY FORECAST";
    fitTxt(modelMeta, tx + 20, y + 11 + lineGap, "#6EE7B7", titleSize, "left", "600", w - 34, 5.7);

    var plotX = x + 9;
    var plotY = y + Math.max(34, 17 + lineGap * 2);
    var plotW = w - 18;
    var plotH = h - (plotY - y) - 8;
    if (plotH < 17) return;

    ctx.fillStyle = "rgba(3,42,36,0.72)";
    rr(plotX, plotY, plotW, plotH, 6); ctx.fill();
    drawSEIRChart(plotX, plotY, plotW, plotH);
  }

  function drawRiskPanel(x, y, w, h, time) {
    drawInsetPanel(x, y, w, h);

    var tx = x + 10;
    var titleSize = h < 100 ? 6.9 : 8.3;
    var lineGap = h < 100 ? 9 : 11;
    drawGisIcon(tx, y + 13, C.pred);
    fitTxt("NADRES AI / ML RISK", tx + 20, y + 11, C.ink, titleSize, "left", "700", w - 34, 5.8);
    fitTxt("INDIA GIS FORECAST · SIMULATED", tx + 20, y + 11 + lineGap, "#6EE7B7", titleSize, "left", "600", w - 34, 5.7);

    var mapX = x + 9;
    var mapY = y + Math.max(34, 17 + lineGap * 2);
    var mapW = w - 18;
    var mapH = h - (mapY - y) - 8;
    if (mapH < 17) return;

    ctx.fillStyle = "rgba(3,25,43,0.78)";
    rr(mapX, mapY, mapW, mapH, 6); ctx.fill();
    drawIndiaRiskMap(mapX, mapY, mapW, mapH, time);
  }

  function fitTxt(t, x, y, col, size, align, weight, maxWidth, minSize) {
    var s = size;
    ctx.font = (weight || "") + " " + s + "px 'Segoe UI', system-ui, sans-serif";
    while (s > minSize && ctx.measureText(t).width > maxWidth) {
      s -= 0.5;
      ctx.font = (weight || "") + " " + s + "px 'Segoe UI', system-ui, sans-serif";
    }
    txt(t, x, y, col, s, align, weight);
  }

  function drawChartIcon(x, y, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.lineTo(x + 15, y + 7); ctx.stroke();
    ctx.strokeStyle = "#F87171"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x + 2, y + 4); ctx.lineTo(x + 6, y + 1); ctx.lineTo(x + 9, y + 3); ctx.lineTo(x + 14, y - 5); ctx.stroke();
  }

  function drawGisIcon(x, y, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.strokeRect(x, y - 7, 15, 14);
    ctx.beginPath(); ctx.moveTo(x + 5, y - 7); ctx.lineTo(x + 5, y + 7);
    ctx.moveTo(x + 10, y - 7); ctx.lineTo(x + 10, y + 7);
    ctx.moveTo(x, y - 2); ctx.lineTo(x + 15, y - 2);
    ctx.moveTo(x, y + 3); ctx.lineTo(x + 15, y + 3); ctx.stroke();
    ctx.fillStyle = "#F59E0B";
    ctx.beginPath(); ctx.arc(x + 10, y - 2, 2.2, 0, 6.28); ctx.fill();
  }

  function drawSEIRChart(x, y, w, h) {
    var curves = prediction.curves;
    if (!curves) return;
    var legendH = h > 46 ? 10 : 2;
    var bottom = h > 52 ? 10 : 3;
    var left = w > 112 && h > 55 ? 17 : 4;
    var gx = x + left, gy = y + legendH + 2;
    var gw = w - left - 4, gh = h - legendH - bottom - 4;
    if (gw < 20 || gh < 12) return;

    ctx.save();
    rr(x, y, w, h, 6); ctx.clip();
    ctx.strokeStyle = "rgba(148,163,184,0.13)"; ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(function (v) {
      var py = gy + gh - v * gh;
      ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx + gw, py); ctx.stroke();
      if (left > 4) txt(Math.round(v * 100) + "%", gx - 3, py, "#7182A8", 5.5, "right", "500");
    });
    [0, 0.5, 1].forEach(function (v) {
      var px = gx + v * gw;
      ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px, gy + gh); ctx.stroke();
    });

    /* Uncertainty ribbon: infection path under R0 ± 0.24. */
    ctx.fillStyle = "rgba(248,113,113,0.13)";
    ctx.beginPath();
    curves.iHigh.forEach(function (v, i) {
      var px = gx + i / (curves.iHigh.length - 1) * gw;
      var py = gy + gh - v * gh;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    for (var i = curves.iLow.length - 1; i >= 0; i--) {
      ctx.lineTo(gx + i / (curves.iLow.length - 1) * gw, gy + gh - curves.iLow[i] * gh);
    }
    ctx.closePath(); ctx.fill();

    drawModelSeries(curves.s, gx, gy, gw, gh, "#60A5FA", []);
    drawModelSeries(curves.i, gx, gy, gw, gh, "#F87171", []);
    drawModelSeries(curves.r, gx, gy, gw, gh, "#34D399", [4, 2]);

    if (legendH > 2) {
      var roomy = gw > 175;
      drawSeriesKey(gx, y + 6, roomy ? "SUS" : "S", "#60A5FA");
      drawSeriesKey(gx + gw * 0.28, y + 6, roomy ? "INF" : "I", "#F87171");
      drawSeriesKey(gx + gw * 0.55, y + 6, roomy ? "REC" : "R", "#34D399");
      fitTxt("peak " + (curves.peak * 100).toFixed(1) + "%", gx + gw, y + 6, "#FCA5A5", 6, "right", "600", gw * 0.34, 5);
    }
    if (bottom > 3) {
      txt("0", gx, y + h - 4, "#7182A8", 5.5, "center", "500");
      txt("45", gx + gw / 2, y + h - 4, "#7182A8", 5.5, "center", "500");
      txt("90d", gx + gw, y + h - 4, "#7182A8", 5.5, "center", "500");
    }
    ctx.restore();
  }

  function drawModelSeries(values, x, y, w, h, color, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, Math.min(2, h * 0.035));
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.setLineDash(dash || []);
    ctx.beginPath();
    values.forEach(function (v, i) {
      var px = x + i / (values.length - 1) * w;
      var py = y + h - clamp(v, 0, 1) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke(); ctx.setLineDash([]);
  }

  function drawSeriesKey(x, y, label, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 7, y); ctx.stroke();
    txt(label, x + 9, y, color, 5.8, "left", "700");
  }

  function drawIndiaRiskMap(x, y, w, h, time) {
    var map = window.INDIA_MAP;
    if (!map) {
      fitTxt("INDIA MAP DATA UNAVAILABLE", x + w / 2, y + h / 2, C.muted, 7, "center", "600", w - 12, 5.5);
      return;
    }
    var legendH = h > 48 ? 11 : 0;
    var mapAreaH = h - legendH - 3;
    var scale = Math.min((w - 8) / map.width, (mapAreaH - 4) / map.height);
    var mapW = map.width * scale, mapH = map.height * scale;
    var ox = x + (w - mapW) / 2;
    var oy = y + 2 + (mapAreaH - mapH) / 2;

    ctx.save();
    rr(x, y, w, h, 6); ctx.clip();
    traceMapRings(map.outline, ox, oy, scale);
    ctx.fillStyle = "rgba(15,61,58,0.92)"; ctx.fill();

    map.states.forEach(function (state) {
      traceMapRings(state.rings, ox, oy, scale);
      var score = prediction.mapRisk[state.name];
      ctx.globalAlpha = score == null ? 0.78 : 0.82;
      ctx.fillStyle = score == null ? "#263552" : riskFromScore(score).color; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(7,11,24,0.72)"; ctx.lineWidth = 0.45; ctx.stroke();
    });

    traceMapRings(map.outline, ox, oy, scale);
    ctx.strokeStyle = "rgba(167,243,208,0.82)"; ctx.lineWidth = Math.max(0.65, scale * 4.2); ctx.stroke();

    prediction.hotspots = prediction.hotspots.filter(function (hot) { return time - hot.born < 12000; });
    prediction.hotspots.forEach(function (hot, i) {
      var state = map.states.filter(function (s) { return s.name === hot.state; })[0];
      if (!state) return;
      var px = ox + state.point[0] * scale, py = oy + state.point[1] * scale;
      var age = clamp((time - hot.born) / 12000, 0, 1);
      var pulseSize = reduced ? 2.5 : 2.8 + Math.sin(time * 0.004 + i) * 0.8;
      var color = riskFromScore(hot.score).color;
      var grd = ctx.createRadialGradient(px, py, 0, px, py, pulseSize * 3);
      grd.addColorStop(0, color + "EE"); grd.addColorStop(1, color + "00");
      ctx.globalAlpha = 1 - age * 0.65;
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, pulseSize * 3, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(px, py, 1.1, 0, 6.28); ctx.fill();
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    if (legendH) drawMapLegend(x, y + h - legendH, w, legendH);
  }

  function traceMapRings(rings, ox, oy, scale) {
    ctx.beginPath();
    rings.forEach(function (ring) {
      if (ring.length < 6) return;
      ctx.moveTo(ox + ring[0] * scale, oy + ring[1] * scale);
      for (var i = 2; i < ring.length; i += 2) {
        ctx.lineTo(ox + ring[i] * scale, oy + ring[i + 1] * scale);
      }
      ctx.closePath();
    });
  }

  function drawMapLegend(x, y, w, h) {
    var keys = ["very_low", "low", "moderate", "high", "very_high"];
    var labels = ["VL", "L", "M", "H", "VH"];
    var totalW = Math.min(w - 21, 106), itemW = totalW / keys.length;
    var start = x + (w - totalW) / 2;
    ctx.fillStyle = "#263552"; rr(x + 4, y + 3, 6, 6, 2); ctx.fill();
    txt("ND", x + 12, y + 6, "#8FA0C8", 5.4, "left", "600");
    keys.forEach(function (key, i) {
      var px = start + i * itemW;
      ctx.fillStyle = HUB.riskByKey(key).color;
      rr(px, y + 3, 6, 6, 2); ctx.fill();
      txt(labels[i], px + 8, y + 6, "#8FA0C8", 5.4, "left", "600");
    });
  }
  function lighten(hex) {
    var m = { "#A855F7": "#D8B4FE", "#10B981": "#6EE7B7", "#60A5FA": "#BFDBFE" };
    return m[hex] || "#FFFFFF";
  }

  function onClick(e) {
    var rect = cv.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var hit = null;
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id]; if (n.kind === "box") return;
      if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) hit = id;
    });
    focusId = (hit === focusId) ? null : hit;
    emit("focus", { id: focusId, node: hit ? nodes[hit] : null });
  }

  /* ----------------------------------------------------------- loop */
  function loop(now) {
    if (!running) { raf = requestAnimationFrame(loop); draw(now); return; }
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    spawnAcc += dt * (baseRate + surge * 6) * speed;
    while (spawnAcc >= 1) { spawn(); spawnAcc -= 1; }
    if (surge > 0) surge = Math.max(0, surge - dt * 0.15);
    step(dt);
    draw(now);
    emit("tick", counts);
    raf = requestAnimationFrame(loop);
  }

  /* -------------------------------------------------------- external */
  function pause() { running = false; }
  function resume() { running = true; last = performance.now(); }
  function toggle() { running = !running; if (running) last = performance.now(); return running; }
  function setSpeed(v) { speed = v; }
  function injectOutbreak() {
    surge = 1;
    var st = HUB.pick(HUB.STATES), dis = HUB.pick(HUB.DISEASES);
    assimilateOutbreak(dis, st);
    emit("log", { kind: "surge", text: "⚠ OUTBREAK SURGE · " + dis.name + " reports spiking in " + st.name });
    emit("hotspot", { dis: dis, st: st });
  }
  function getCounts() { return counts; }

  return { init: init, on: on, pause: pause, resume: resume, toggle: toggle,
           setSpeed: setSpeed, injectOutbreak: injectOutbreak, getCounts: getCounts,
           getPredictionState: function(){ return prediction; },
           isRunning: function(){ return running; } };
})();
