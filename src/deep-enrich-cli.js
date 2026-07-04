import { classifyResult } from "./classify.js";
import { deepEnrichResult } from "./deep.js";
import { exportLeads } from "./exporter.js";
import { addRun, readDb, upsertLeads } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.split("="))
    .filter(([key]) => key?.startsWith("--"))
    .map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"])
);

const limit = Number(args.get("limit") || 100);
const onlyMissing = args.get("onlyMissing") !== "false";
const exportEvery = Number(args.get("exportEvery") || 5);
const maxContactPages = Number(args.get("maxContactPages") || 4);
const maxExternalWebsites = Number(args.get("maxExternalWebsites") || 3);
const runId = `deep_${Date.now()}`;
const startedAt = nowIso();
const db = await readDb();
const candidates = db.leads
  .filter((lead) => {
    if (!onlyMissing) return true;
    return !(
      (lead.emails || []).length ||
      (lead.forms || []).length ||
      (lead.contactLinks || []).length ||
      (lead.socialLinks || []).length
    );
  })
  .sort((a, b) => (b.score || 0) - (a.score || 0))
  .slice(0, limit);

console.log(`[deep] Starting enrichment for ${candidates.length} leads`);

const totals = {
  created: [],
  updated: [],
  processed: 0
};

for (const [index, lead] of candidates.entries()) {
  console.log(`[deep] ${index + 1}/${candidates.length}: ${lead.name}`);
  const enriched = await deepEnrichResult(lead, {
    searchContacts: true,
    maxContactPages,
    maxExternalWebsites
  });
  const classified = classifyResult(
    {
      ...lead,
      ...enriched,
      id: lead.id
    },
    lead.sourceIntent || lead.leadType || "partner"
  );
  const nextLead = {
    ...lead,
    ...classified,
    stage: lead.stage,
    notes: lead.notes
  };
  const stored = await upsertLeads([nextLead], runId);
  totals.created.push(...stored.created);
  totals.updated.push(...stored.updated);
  totals.processed += 1;
  if (exportEvery > 0 && totals.processed % exportEvery === 0) {
    const exported = await exportLeads();
    console.log(
      `[deep] Exported checkpoint: qualified=${exported.exported}; contactable=${exported.contactable}; total=${exported.total}`
    );
  }
  await sleep(500);
}

const exported = await exportLeads();
const finishedAt = nowIso();
await addRun({
  id: runId,
  startedAt,
  finishedAt,
  settings: { type: "deep-enrich", limit, onlyMissing, maxContactPages, maxExternalWebsites },
  totalQueries: 0,
  rawResults: candidates.length,
  leadsFound: totals.processed,
  created: totals.created.length,
  updated: totals.updated.length,
  errors: []
});

console.log(
  `[deep] Complete: ${totals.created.length} new, ${totals.updated.length} updated; exported=${exported.exported}; contactable=${exported.contactable}`
);
