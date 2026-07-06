import fs from "node:fs/promises";
import path from "node:path";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");

function normalizeForWorkspace(lead = {}) {
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

function keepLead(lead = {}) {
  const scored = normalizeForWorkspace(lead);
  if (scored.qualityStatus === "rejected") return false;
  if (Number(scored.commercialScore || 0) < 42) return false;
  if (["review_or_seo", "job_posting", "directory_or_registry", "broker_page"].includes(scored.entityType)) return false;
  return true;
}

function groupByCompany(leads = []) {
  const grouped = new Map();
  for (const lead of leads.map(normalizeForWorkspace)) {
    const key = lead.companyKey || lead.id;
    const current = grouped.get(key);
    if (!current || Number(lead.commercialScore || 0) > Number(current.commercialScore || 0)) {
      grouped.set(key, lead);
    }
  }
  return [...grouped.values()].sort((a, b) => Number(b.commercialScore || 0) - Number(a.commercialScore || 0));
}

async function main() {
  const db = await readDb();
  const scored = db.leads.map(normalizeForWorkspace);
  const kept = groupByCompany(scored.filter(keepLead));
  const rejected = scored.filter((lead) => !keepLead(lead));
  const stamp = nowIso().replace(/[:.]/g, "-");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `leads-before-quality-repair-${stamp}.json`), `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(dataDir, `leads-rejected-${stamp}.json`), `${JSON.stringify(rejected, null, 2)}\n`, "utf8");

  db.leads = kept;
  db.qualityRepair = {
    repairedAt: nowIso(),
    before: scored.length,
    after: kept.length,
    rejected: rejected.length,
    groups: kept.length
  };
  await writeDb(db);

  console.log(`Quality repair complete: ${scored.length} -> ${kept.length} commercial company records (${rejected.length} rejected).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
