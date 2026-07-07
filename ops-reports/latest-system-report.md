# BD Lead Engine Cloud Report

Updated: 2026-07-07T00:05:32.903Z
Health: OK

## Funnel
Raw: 546
Qualified: 57
Working: 85
Contactable: 66
Sales-ready: 21
A1 Hot: 28
A2 Strong: 14

## Quality
Platform contact leaks: 13
High-value without real contact: 161
Sales-ready by bucket: {"mql5":7,"specialist":5,"web":3,"myfxbook":3,"tiktok":2,"instagram":1}
Qualified by bucket: {"linkedin":23,"specialist":11,"instagram":7,"mql5":7,"web":3,"myfxbook":3,"tiktok":2,"x":1}

## Sourcing / Workers
Provider errors: 90
Stale workers: engine-control
Issues: none

## Smart Enrichment
Phase: smart-enriching
Processed: 154
Stored: 154
Errors: 0
Current: users forex gold investorFX Blue
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
