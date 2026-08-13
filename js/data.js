/* =========================================================================
   data.js — every piece of content the live hub renders.
   Mirrors the National Livestock Disease Intelligence architecture:
   7 surveillance sources -> processing engine -> gov gate -> prediction
   -> farmer advisories & dashboards. Edit here, not in the engines.
   ========================================================================= */
window.HUB = (function () {
  "use strict";

  /* The seven data-ingestion streams (section 1, A–G).
     `weight` biases how often each stream emits a record. */
  var SOURCES = [
    { id: "active",  n: "Active Surveillance",        color: "#34D399", weight: 3,
      items: ["Field Investigation", "Outbreak Investigation", "Quarantine Monitoring", "Movement Monitoring"] },
    { id: "passive", n: "Passive Surveillance",       color: "#60A5FA", weight: 5,
      items: ["NADEN report", "1962 Toll-Free call", "CADDES app", "PDDES", "Pashu Sakhi", "Para-Vet", "Vet Doctor", "Chatbot"] },
    { id: "sentinel",n: "Sentinel Surveillance",      color: "#2DD4BF", weight: 2,
      items: ["Sentinel Village", "Sentinel Farm", "Sentinel Animal", "Event-based Sampling"] },
    { id: "genomic", n: "Genomic Lab",                color: "#A78BFA", weight: 2, sample: true,
      items: ["NGS Sequencing", "Variant ID", "Strain Typing", "Genomic Record"] },
    { id: "news",    n: "Newspaper Surveillance",     color: "#FBBF24", weight: 1,
      items: ["News item", "Media Report", "Bulletin"] },
    { id: "lit",     n: "Literature Surveillance",    color: "#818CF8", weight: 1,
      items: ["Journal Article", "Research Paper", "Technical Report"] },
    { id: "env",     n: "Environmental & Ecological", color: "#A3E635", weight: 3,
      items: ["Meteorological", "Satellite/Remote Sensing", "Land Use", "Vector & Wildlife", "Soil & Pasture", "Water Quality", "Rainfall", "Humidity"] }
  ];

  /* Processing / downstream stages (sections 2–5), keyed by node id.
     Used for on-canvas labels and the click-inspector. */
  var STAGES = {
    ING:  { title: "Data Ingestion & Standardisation", sub: "clean · normalise · deduplicate",
            detail: "Raw records from every stream are cleaned, put into a common schema, and de-duplicated so the same outbreak reported twice is counted once." },
    CLU:  { title: "Clustering & Hotspot Detection", sub: "spatial–temporal analysis",
            detail: "Standardised records are grouped in space and time. When enough correlate, a hotspot is raised for a disease in a state." },
    VER:  { title: "Verification & Fraud Detection", sub: "call / info authenticity",
            detail: "Each candidate signal is checked for authenticity. Duplicate calls and unverifiable reports are dropped before anything reaches an official." },
    GATE: { title: "Government Confirmation", sub: "officials alerted · action gated",
            detail: "A real-time alert reaches the responsible official. Field response is gated on confirmation — the ✓ only clears once govt confirms." },
    PRED: { title: "Prediction & Risk", sub: "SEIR simulation · NADRES AI/ML risk · India GIS",
            detail: "Confirmed signals update a 90-day SEIR disease trajectory and an illustrative NADRES-style logistic risk model. The simulated state-level forecast is rendered on an India GIS map; genomic records add strain, virulence and drug-resistance context." },
    OUT:  { title: "Output & Advisory", sub: "SMS · app · push · dashboards",
            detail: "Risk-scored guidance fans out to farmers via SMS, mobile notifications and push alerts, and updates the national dashboards in real time." }
  };

  var RISK = [
    { key: "very_high", label: "Very High", color: "#991B1B" },
    { key: "high",      label: "High",      color: "#EF4444" },
    { key: "moderate",  label: "Moderate",  color: "#F59E0B" },
    { key: "low",       label: "Low",       color: "#FCD34D" },
    { key: "very_low",  label: "Very Low",  color: "#22C55E" }
  ];
  function riskByKey(k){ return RISK.filter(function(r){return r.key===k;})[0]; }

  /* States for the risk board + alert locations, with a baseline lean. */
  var STATES = [
    { name: "Rajasthan",      base: "high" },
    { name: "Gujarat",        base: "moderate" },
    { name: "Uttar Pradesh",  base: "high" },
    { name: "Maharashtra",    base: "moderate" },
    { name: "Madhya Pradesh", base: "moderate" },
    { name: "Punjab",         base: "low" },
    { name: "Kerala",         base: "low" },
    { name: "Karnataka",      base: "low" },
    { name: "Tamil Nadu",     base: "very_low" },
    { name: "Bihar",          base: "moderate" },
    { name: "West Bengal",    base: "low" },
    { name: "Assam",          base: "moderate" }
  ];

  var DISEASES = [
    { name: "Lumpy Skin Disease", species: "Cattle" },
    { name: "Foot & Mouth Disease", species: "Cattle" },
    { name: "Avian Influenza", species: "Poultry" },
    { name: "Brucellosis", species: "Cattle" },
    { name: "PPR", species: "Goat" },
    { name: "Classical Swine Fever", species: "Pig" },
    { name: "Bluetongue", species: "Sheep" }
  ];

  var ENABLERS = [
    ["AI / ML Intelligence", "Advanced analytics for early detection & forecasting"],
    ["Real-time Decision Support", "Timely information for quick, informed action"],
    ["Multi-stakeholder Collaboration", "Centre, State, field staff, experts & farmers"],
    ["Evidence-based Policy", "Data-driven strategies for animal-health security"],
    ["Livelihoods & Health", "Reduced disease impact and economic loss"]
  ];

  var PRINCIPLES = ["One Health Approach", "Early Detection", "Timely Response",
                    "Risk Mitigation", "Data-driven Governance", "Sustainable Livestock Sector"];

  /* Log-line builders — each takes context and returns a human sentence. */
  function pick(a){ return a[(Math.random()*a.length)|0]; }
  var LOG = {
    ingest: function(src){ return "Record ingested · " + pick(src.items) + " → " + pick(STATES).name; },
    hotspot: function(dis, st){ return "Hotspot detected · " + dis.name + " cluster in " + st.name; },
    fraud: function(){ return "Fraud check failed · duplicate/unverifiable report dropped"; },
    alert: function(dis, st, risk){ return "ALERT SENT · " + dis.name + " · " + st.name + " · " + risk.label + " risk"; },
    confirm: function(st){ return "Govt confirmed · field response dispatched to " + st.name; },
    sms: function(){ return "SMS advisory dispatched to " + (800 + ((Math.random()*4000)|0)).toLocaleString() + " farmers"; },
    sample: function(){ return "Genomic record sequenced · strain & resistance markers updated"; }
  };

  return {
    SOURCES: SOURCES, STAGES: STAGES, RISK: RISK, STATES: STATES,
    DISEASES: DISEASES, ENABLERS: ENABLERS, PRINCIPLES: PRINCIPLES,
    LOG: LOG, riskByKey: riskByKey, pick: pick
  };
})();
