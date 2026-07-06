# AVENIQ lead quality playbook

## Objective

AVENIQ should treat a commercial opportunity as a company/entity, not as a random URL.

The workspace should prioritize:

- Prop firm companies with partnership or affiliate angle
- Trading education businesses
- Trading communities with clear audience
- Specialist trading profiles/platforms
- Capital allocators with trading/FX context
- Public company pages with clear commercial relevance

It should deprioritize or remove:

- Review/ranking/SEO pages
- Generic articles and explainers
- Job posts
- Directories without commercial signal
- Broker homepages/client portals
- Duplicate URLs that belong to the same company

## Repair command

Run this after pulling the update to clean the existing database:

```bash
npm run quality:repair
```

The command will:

1. Score every existing record with the commercial intelligence layer.
2. Remove low-fit records from the active workspace.
3. Group duplicates by company key.
4. Keep the best commercial record per company/entity.
5. Save backups inside `data/` before modifying `leads.json`.

## Backups created

The repair process creates:

- `data/leads-before-quality-repair-<timestamp>.json`
- `data/leads-rejected-<timestamp>.json`

So the cleanup is reversible.

## Quality model

Each record receives:

- `entityType`
- `companyName`
- `companyKey`
- `commercialScore`
- `commercialTier`
- `qualityStatus`
- `entitySignals`

The active workspace should focus on `qualityStatus = qualified` and commercial scores above the threshold.
