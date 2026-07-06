# BD Lead Engine Cloud Report

Updated: 2026-07-06T05:48:23.138Z
Health: OK

## Funnel
Raw: 778
Qualified: 56
Working: 78
Contactable: 61
Sales-ready: 28
A1 Hot: 28
A2 Strong: 7

## Quality
Platform contact leaks: 1
High-value without real contact: 167
Sales-ready by bucket: {"x":7,"myfxbook":6,"web":5,"mql5":4,"instagram":2,"tiktok":2,"specialist":1,"telegram":1}
Qualified by bucket: {"linkedin":17,"instagram":11,"x":9,"myfxbook":6,"web":5,"mql5":4,"tiktok":2,"specialist":1,"telegram":1}

## Sourcing / Workers
Provider errors: 144
Stale workers: engine-control
Issues: none

## Smart Enrichment
Phase: smart-enriching
Processed: 5
Stored: 5
Errors: 0
Current: BizzinPodcast
Last: Instagram photos and videos
Last best contact: https://www.instagram.com/goldtraderpauls/

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
