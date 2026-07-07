import fs from "node:fs/promises";
import path from "node:path";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { cleanLeadContacts, pruneReasons, shouldPruneLead } from "./lead-prune-policy.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

const dataDir = path.join(getRootDir(), "data");
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dryRun=true");

function normalizeLead(lead = {}) {
  const cleaned = cleanLeadContacts(lead);
  const scored = enhanceCommercialLead(cleaned);
  return {
    ...scored,
    name: scored.companyName || scored.name,
    title: scored.companyName || scored.title || scored.name,
    priority: scored.commercialTier || scored.priority,
    displayScore: scored.commercialScore,
    stage: scored.stage || "new"
  };
}

function reasonCounts(archived = []) {
  const counts = new Map();
  for (const item of archived) {
    for (const reason of item.pruneReasons || []) counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

async function main() {
  const db = await readDb();
  const before = (db.leads || []).map(normalizeLead);
  const kept = [];
  const archived = [];

  for (const lead of before) {
    const reasons = pruneReasons(lead);
    const next = { ...lead, pruneReasons: reasons };
    if (shouldPruneLead(lead)) archived.push(next);
    else kept.push({ ...lead, pruneReasons: [] });
  }

  const stamp = nowIso().replace(/[:.]/g, "-");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `leads-before-cleanup-${stamp}.json`), `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(dataDir, `leads-archived-cleanup-${stamp}.json`), `${JSON.stringify(archived, null, 2)}\n`, "utf8");

  if (!dryRun) {
    db.leads = kept.sort((a, b) => Number(b.commercialScore || b.score || 0) - Number(a.commercialScore || a.score || 0));
    db.cleanup = {
      cleanedAt: nowIso(),
      policy: "lead-prune-policy-v1",
      before: before.length,
      after: kept.length,
      archived: archived.length,
      reasonCounts: reasonCounts(archived)
    };
    await writeDb(db);
  }

  console.log(`Cleanup ${dryRun ? "dry-run " : ""}complete: ${before.length} -> ${kept.length} active leads (${archived.length} archived).`);
  console.log(JSON.stringify({ archived: archived.length, kept: kept.length, reasonCounts: reasonCounts(archived) }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
