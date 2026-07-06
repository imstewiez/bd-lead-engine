import fs from "node:fs/promises";
import path from "node:path";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { isBlockedCommercialLead } from "./noise-policy.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

const dataDir = path.join(getRootDir(), "data");

function normalizeLead(lead = {}) {
  const scored = enhanceCommercialLead(lead);
  return {
    ...scored,
    name: scored.companyName || scored.name,
    title: scored.companyName || scored.title || scored.name,
    priority: scored.commercialTier || scored.priority,
    displayScore: scored.commercialScore,
    stage: scored.stage || "new"
  };
}

async function main() {
  const db = await readDb();
  const before = (db.leads || []).map(normalizeLead);
  const kept = [];
  const archived = [];

  for (const lead of before) {
    if (isBlockedCommercialLead(lead)) archived.push(lead);
    else kept.push(lead);
  }

  const stamp = nowIso().replace(/[:.]/g, "-");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `leads-before-cleanup-${stamp}.json`), `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(dataDir, `leads-archived-cleanup-${stamp}.json`), `${JSON.stringify(archived, null, 2)}\n`, "utf8");

  db.leads = kept.sort((a, b) => Number(b.commercialScore || b.score || 0) - Number(a.commercialScore || a.score || 0));
  db.cleanup = { cleanedAt: nowIso(), before: before.length, after: kept.length, archived: archived.length };
  await writeDb(db);
  console.log(`Cleanup complete: ${before.length} -> ${kept.length} active leads (${archived.length} archived).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
