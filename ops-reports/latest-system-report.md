# BD Lead Engine Cloud Report

Updated: 2026-07-06T05:03:18.235Z
Health: OK

## Funnel
Raw: 1226
Qualified: 99
Working: 127
Contactable: 105
Sales-ready: 39
A1 Hot: 42
A2 Strong: 17

## Quality
Platform contact leaks: 0
High-value without real contact: 226
Sales-ready by bucket: {"web":9,"x":7,"myfxbook":6,"mql5":5,"specialist":4,"instagram":3,"tiktok":2,"facebook_threads":1,"linkedin":1,"telegram":1}
Qualified by bucket: {"linkedin":43,"instagram":13,"web":10,"x":9,"facebook_threads":6,"myfxbook":6,"mql5":5,"specialist":4,"tiktok":2,"telegram":1}

## Sourcing / Workers
Provider errors: 557
Stale workers: engine-control
Issues: warning:duplicate_pressure

## Smart Enrichment
Phase: smart-enriching
Processed: 12
Stored: 12
Errors: 0
Current: ) / Posts / X
Last: Statement from CoW Protocol: Earlier today, a trader attempted to swap ...
Last best contact: luciameabe@gmail.com

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
