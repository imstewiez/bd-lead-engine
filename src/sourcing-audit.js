import fs from "node:fs/promises";
import path from "node:path";
import { filterAndDedupeLeads, filterWorkingLeads, hasActionableContact } from "./exporter.js";
import { countBySource, sourceBucket } from "./mql5-limit.js";
import { qualifyLead } from "./qualification.js";
import { getRootDir, readDb } from "./store.js";
import { nowIso } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const HARVESTERS = ["source-harvester", "source-harvester-social", "source-harvester-specialist", "source-harvester-ecosystem"];

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return { error: error.message };
  }
}

function pct(value, total) {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total || 1)) * 1000) / 10;
}

function addStats(target, stats = {}) {
  for (const key of ["searches", "raw", "qualified", "saved", "discarded", "duplicates", "errors", "providerErrors"]) {
    target[key] = Number(target[key] || 0) + Number(stats[key] || 0);
  }
}

function summarizeWorkers(statuses = {}) {
  const totals = { searches: 0, raw: 0, qualified: 0, saved: 0, discarded: 0, duplicates: 0, errors: 0, providerErrors: 0 };
  const byWorker = {};
  const bySource = {};
  const reasons = {};

  for (const worker of HARVESTERS) {
    const status = statuses[worker] || null;
    const sourceStats = status?.progress?.sourceStats || {};
    const workerTotals = { searches: 0, raw: 0, qualified: 0, saved: 0, discarded: 0, duplicates: 0, errors: 0, providerErrors: 0, message: status?.progress?.message || status?.status || "missing" };

    for (const [source, stats] of Object.entries(sourceStats)) {
      bySource[source] ||= { searches: 0, raw: 0, qualified: 0, saved: 0, discarded: 0, duplicates: 0, errors: 0, providerErrors: 0 };
      addStats(bySource[source], stats);
      addStats(workerTotals, stats);
      addStats(totals, stats);
      for (const [reason, count] of Object.entries(stats.reasons || {})) {
        reasons[reason] = Number(reasons[reason] || 0) + Number(count || 0);
      }
    }
    byWorker[worker] = workerTotals;
  }

  return {
    totals: {
      ...totals,
      rawPerSearch: totals.searches ? Math.round((totals.raw / totals.searches) * 100) / 100 : 0,
      savedPerSearch: totals.searches ? Math.round((totals.saved / totals.searches) * 100) / 100 : 0,
      providerErrorsPerSearch: totals.searches ? Math.round((totals.providerErrors / totals.searches) * 100) / 100 : 0
    },
    byWorker,
    bySource,
    reasons
  };
}

function tierCounts(leads = []) {
  const counts = { a1Hot: 0, a2Strong: 0, bNurture: 0, cResearch: 0 };
  for (const lead of leads) {
    const tier = qualifyLead(lead).icpTier;
    if (tier === "A1 Hot") counts.a1Hot += 1;
    else if (tier === "A2 Strong") counts.a2Strong += 1;
    else if (tier === "B Nurture") counts.bNurture += 1;
    else counts.cResearch += 1;
  }
  return counts;
}

function sampleLeads(leads = []) {
  return leads.slice(0, 10).map((lead) => ({
    name: lead.name || lead.title || "",
    url: lead.url || "",
    sourceBucket: sourceBucket(lead),
    score: lead.score || 0,
    priority: lead.priority || "",
    segment: lead.segment || "",
    bestContactType: lead.bestContactType || "",
    bestChannel: qualifyLead(lead).bestChannel
  }));
}

function recommendations({ counts, search, cleaner }) {
  const out = [];
  if (search.totals.searches >= 4 && search.totals.rawPerSearch < 1) {
    out.push("Low search yield: public search providers are returning very few usable results per query.");
  }
  if (search.totals.providerErrors > Math.max(8, search.totals.raw * 2)) {
    out.push("Provider error pressure is high: consider using a paid search API before increasing query volume.");
  }
  if (counts.raw >= 500 && counts.qualifiedRatio < 5) {
    out.push("Strict qualified ratio is below 5%: keep strict export gates, but improve sourcing inputs instead of loosening quality blindly.");
  }
  if (counts.workingRatio < 8) {
    out.push("Working list is thin: review source queries and add higher-intent source packs before scaling outreach.");
  }
  if (cleaner?.lastRun?.removed) {
    out.push(`Cleaner removed ${cleaner.lastRun.removed} noisy records in the latest run.`);
  }
  if (!out.length) out.push("No critical sourcing bottleneck detected in the current snapshot.");
  return out;
}

async function main() {
  const db = await readDb();
  const raw = db.leads || [];
  const qualified = filterAndDedupeLeads(raw);
  const working = filterWorkingLeads(raw);
  const contactable = working.filter(hasActionableContact);

  const statuses = {};
  for (const worker of [...HARVESTERS, "lead-cleaner", "qualified-exporter", "enrichment-worker"]) {
    statuses[worker] = await readJson(path.join(dataDir, `${worker}-status.json`));
  }

  const search = summarizeWorkers(statuses);
  const counts = {
    raw: raw.length,
    qualified: qualified.length,
    working: working.length,
    contactable: contactable.length,
    qualifiedRatio: pct(qualified.length, raw.length),
    workingRatio: pct(working.length, raw.length),
    contactableWorkingRatio: pct(contactable.length, working.length),
    tiers: tierCounts(working),
    rawBySource: countBySource(raw),
    workingBySource: countBySource(working),
    qualifiedBySource: countBySource(qualified)
  };

  const audit = {
    ok: true,
    updatedAt: nowIso(),
    counts,
    search,
    cleaner: statuses["lead-cleaner"] || null,
    exporter: statuses["qualified-exporter"] || null,
    enrichment: statuses["enrichment-worker"] || null,
    recommendations: recommendations({ counts, search, cleaner: statuses["lead-cleaner"] }),
    samples: {
      qualified: sampleLeads(qualified),
      working: sampleLeads(working)
    }
  };

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, "sourcing-audit.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(audit, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
