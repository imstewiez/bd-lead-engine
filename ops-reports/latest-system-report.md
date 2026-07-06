# BD Lead Engine Cloud Report

Updated: 2026-07-06T22:03:53.637Z
Health: OK

## Funnel
Raw: 543
Qualified: 52
Working: 79
Contactable: 60
Sales-ready: 21
A1 Hot: 28
A2 Strong: 14

## Quality
Platform contact leaks: 2
High-value without real contact: 158
Sales-ready by bucket: {"mql5":7,"specialist":6,"web":3,"myfxbook":2,"tiktok":2,"instagram":1}
Qualified by bucket: {"linkedin":23,"instagram":8,"mql5":7,"specialist":6,"web":3,"tiktok":2,"myfxbook":2,"x":1}

## Sourcing / Workers
Provider errors: 63
Stale workers: engine-control
Issues: none

## Smart Enrichment
Phase: smart-enriching
Processed: 74
Stored: 74
Errors: 0
Current: Instagram
Last: users forex gold investorFX Blue
Last best contact: accounts@fxbluelabs.com

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
