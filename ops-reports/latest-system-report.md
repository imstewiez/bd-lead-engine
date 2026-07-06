# BD Lead Engine Cloud Report

Updated: 2026-07-06T14:59:06.734Z
Health: OK

## Funnel
Raw: 512
Qualified: 41
Working: 64
Contactable: 47
Sales-ready: 16
A1 Hot: 23
A2 Strong: 11

## Quality
Platform contact leaks: 3
High-value without real contact: 147
Sales-ready by bucket: {"mql5":5,"web":3,"myfxbook":3,"tiktok":2,"specialist":1,"telegram":1,"instagram":1}
Qualified by bucket: {"linkedin":18,"instagram":7,"mql5":5,"web":3,"myfxbook":3,"tiktok":2,"specialist":1,"telegram":1,"x":1}

## Sourcing / Workers
Provider errors: 144
Stale workers: engine-control
Issues: none

## Smart Enrichment
Phase: smart-enriching
Processed: 12
Stored: 12
Errors: 0
Current: Forex Fund Manager Forex System by Forex Trader supportfx
Last: ZuluTrade Social Platform
Last best contact: pocketfxcopy@gmail.com

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
