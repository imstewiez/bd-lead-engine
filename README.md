# BD Lead Engine

Local lead discovery and outbound cockpit for Business Development.

## Run

```powershell
npm.cmd install
npm.cmd start
```

Open:

```text
http://localhost:8787
```

## CLI scan

```powershell
npm.cmd run scan -- --region=global --maxQueries=32 --limitPerQuery=8
```

## Autopilot

Run continuous deep sourcing with automatic CSV/JSON export:

```powershell
npm.cmd run autopilot -- --maxQueries=24 --limitPerQuery=12 --delayMs=5000 --maxContactPages=4
```

Outputs are updated after each cycle:

```text
autopilot-leads.csv
autopilot-leads.json
data/autopilot-status.json
data/autopilot.log
```

While the server is running, download the working CSV at:

```text
http://localhost:8787/autopilot-leads.csv
```

Optional search API keys improve LinkedIn-public and broad web discovery:

```powershell
$env:BRAVE_SEARCH_API_KEY="..."
$env:SERPAPI_KEY="..."
npm.cmd start
```

## Production enrichment workflow

The deep enrichment flow is profile-first: source profile/page, then source-discovered website or linkhub, then strict identity-matched search trail only when no actionable contact exists. This prevents unrelated public-search pages from polluting a lead with random forms or contact links.

See the production playbook:

```text
docs/LEAD_ENGINE_PRODUCTION_PLAYBOOK.md
```

## What it does

- Searches public web results across partner and recruitment queries.
- Separates partner/revenue leads from broker-talent recruitment leads.
- Enriches public websites where possible.
- Scores leads from A to D.
- Generates PT/ES/EN outbound copy for manual sending.
- Exports CSV/JSON.

The LinkedIn path uses public search results only. It does not log in, scrape private data, or automate messaging.
