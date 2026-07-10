# BD Lead Engine Cloud Report

Updated: 2026-07-10T16:05:23.623Z
Health: OK

## Funnel
Raw: 165
Qualified: 41
Working: 71
Contactable: 53
Sales-ready: 10
A1 Hot: 19
A2 Strong: 8

## Quality
Platform contact leaks: 1
High-value without real contact: 35
Sales-ready by bucket: {"mql5":4,"web":2,"x":2,"tiktok":2}
Qualified by bucket: {"linkedin":25,"mql5":5,"x":3,"tiktok":2,"web":2,"instagram":2,"myfxbook":2}

## Sourcing / Workers
Provider errors: 0
Stale workers: cloud-logger-worker, engine-control, smart-enrichment-worker, supervisor
Issues: warning:smart-enrichment-worker_stale_status, warning:cloud-logger-worker_stale_status

## Smart Enrichment
Phase: smart-enriching
Processed: 70
Stored: 70
Errors: 0
Current: MGMFOREX-BTC Forex Trading System by Forex Trader manager…
Last: Forex Manager Forex Trading System by Forex Trader thierrybl

## Recent Errors
### qualified-exporter
- [qualified-exporter] 2026-07-05T22:54:39.472Z SyntaxError: Unterminated string in JSON at position 521902 (line 9214 column 21)
-     at JSON.parse (<anonymous>)
-     at readDb (file:///C:/Users/steve/bd-lead-engine/src/store.js:31:17)
-     at async exportLeads (file:///C:/Users/steve/bd-lead-engine/src/exporter.js:379:14)
-     at async runOnce (file:///C:/Users/steve/bd-lead-engine/src/qualified-exporter.js:26:18)
-     at async file:///C:/Users/steve/bd-lead-engine/src/qualified-exporter.js:43:5
### ui-snapshot-worker
- [ui-snapshot] Error: EPERM: operation not permitted, rename 'C:\Users\steve\bd-lead-engine\public\ui-dashboard.json.31880.1783310997093.tmp' -> 'C:\Users\steve\bd-lead-engine\public\ui-dashboard.json'
-     at async Object.rename (node:internal/fs/promises:781:10)
-     at async writeJsonAtomic (file:///C:/Users/steve/bd-lead-engine/src/ui-snapshot.js:123:3)
-     at async buildUiSnapshot (file:///C:/Users/steve/bd-lead-engine/src/ui-snapshot.js:150:3)
-     at async loop (file:///C:/Users/steve/bd-lead-engine/src/ui-snapshot.js:159:24)

_Generated automatically by `src/cloud-logger.js`._
