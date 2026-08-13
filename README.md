# National Livestock Disease Intelligence — Live Data Hub

An animated, real-time visualisation of the National Livestock Disease Intelligence
Data Hub & Decision Support Centre. Data records spawn from seven surveillance
streams, flow through the processing engine (ingest → cluster → verify), pass the
government confirmation gate, get risk-scored at prediction, and fan out as farmer
advisories — while the dashboards, charts, risk board and event log update live.

## Run it

Just open `index.html` in any modern browser. **No build step, no internet, no
dependencies** — it runs entirely offline from these files.

If your browser blocks local file access for scripts, serve the folder:

```bash
python3 -m http.server 8080     # then open http://localhost:8080
```

## What you are looking at

The whole picture maps onto the source architecture:

- **Left — 1. Data Ingestion & Capturing.** Seven source nodes (Active, Passive,
  Sentinel, Genomic Lab, Newspaper, Literature, Environmental). Each emits colour-
  coded records; the colour tells you which stream a record came from.
- **Centre — 2. Intelligent Processing & Clustering Engine.** Records snake through
  three chambers: *Ingest & Standardise* (clean/dedupe), *Cluster & Hotspot*
  (spatial–temporal grouping — watch for hotspot pulses), and *Verify & Fraud*
  (a slice of records is dropped here with a red burst).
- **3. Government Confirmation.** Verified signals reach the gate; the ✓ pulses as an
  official is alerted and field response is gated on confirmation.
- **4. Prediction & Risk.** Confirmed signals update a deterministic 90-day SEIR
  compartment model (susceptible, exposed, infectious and recovered), including an
  uncertainty ribbon around the infectious forecast. A NADRES-style illustrative
  logistic risk score then colours an India state/UT GIS map. The record recolours to its risk
  level; genomic records increment *Samples Sequenced*.
- **5. Output & Advisory.** Records burst out as advisories (SMS / app / push) and
  update the dashboards.

The **right panel** is the NADRES dashboard: four live KPI counters, a self-feeding
**Recent Alerts** table, and a **stage inspector** (click any node in the flow to read
what it does). The **footer** carries disease-wise and state-wise bar charts, a
state-level **risk board**, and a streaming **event log**.

## Controls

| Control | Action |
|---|---|
| **⚠ Inject outbreak** (`O`) | spikes the record rate and biases risk upward for a burst — watch the board and counters react |
| **1× / 2× / 4×** | simulation speed |
| **❚❚ Pause / ▶ Resume** (`Space`) | freeze or resume the flow |
| click a stage | open its description in the inspector |

## Files

```
index.html          layout + panels
css/app.css          all styling (offline, system fonts)
js/data.js           content: sources, stages, diseases, states, log lines
js/india-map.js      offline India/state geometry for the simulated risk map
js/engine.js         the canvas flow simulation (records, stages, events)
js/dashboard.js      KPIs, alerts table, charts, risk board, event log
js/app.js            controls, clock, boot (loaded last)
```

Scripts are plain classic scripts on a small global namespace (`HUB`, `FLOW`, `DASH`)
so everything works from `file://` without a server or bundler.

## Editing content

Almost everything lives in `js/data.js`:

- `SOURCES` — add or rename a stream; `weight` biases how often it emits, `color`
  drives the packet colour, `sample:true` marks a genomic stream.
- `STAGES` — the title / subtitle / description shown in the inspector.
- `DISEASES`, `STATES`, `RISK` — feed the alerts table, charts and risk board.
- `LOG` — the sentence templates for the live event log.

Tuning the simulation (rates, fraud %, dwell times) lives at the top of
`js/engine.js` — `baseRate`, the `0.12` fraud chance in `onReach`, and the per-stage
`dwell` values.

## Notes

- Everything is a live simulation with random draws, so no two runs look the same and
  the numbers drift the way a real feed would. It is an illustrative model of the flow,
  not connected to live NADES/NADRES data.
- The external India outline is adapted from Survey of India's official 1:16M
  *Outline of India* (permitted for individual/internal/educational/research/website
  use; Survey of India retains copyright). Internal state/UT geometry is adapted
  from public-domain Natural Earth 5.1.1 Admin-1 data and fitted to that outline.
  SEIR parameters and NADRES-style risk values are illustrative simulation outputs,
  not official forecasts or veterinary guidance.
- `prefers-reduced-motion` is respected — particle counts drop and processing dwells
  collapse for a calmer view.
