import fs from "node:fs/promises";
import path from "node:path";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { domainOf, nowIso } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");

function isSpecialistPlatform(lead = {}) {
  const domain = domainOf(lead.url || lead.domain || "");
  return /myfxbook\.com|mql5\.com|fxblue\.com|zulutrade\.com|darwinex\.com|signalstart\.com|tradingview\.com/i.test(domain);
}

function platformProfileKey(lead = {}) {
  const domain = domainOf(lead.url || lead.domain || "");
  try {
    const parts = new URL(lead.url || "").pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
    if (domain.includes("myfxbook.com") && parts[0] && parts[1]) return `${domain}:${parts.slice(0, 3).join(":")}`;
    if (domain.includes("mql5.com") && parts[1] && parts[2]) return `${domain}:${parts.slice(1, 3).join(":")}`;
    if (parts[0] && parts[1]) return `${domain}:${parts.slice(0, 2).join(":")}`;
  } catch {}
  return `${domain}:${lead.id || lead.url}`;
}

async function latestOriginalBackup() {
  const entries = await fs.readdir(dataDir).catch(() => []);
  const candidates = entries.filter((name) => /^leads-before-quality-repair-.*\.json$/i.test(name)).sort();
  if (!candidates.length) return "";
  return path.join(dataDir, candidates.at(-1));
}

function normalize(lead = {}) {
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
  const backup = await latestOriginalBackup();
  if (!backup) throw new Error("No leads-before-quality-repair backup found in data/");

  const currentDb = await readDb();
  const backupDb = JSON.parse(await fs.readFile(backup, "utf8"));
  const currentByKey = new Map((currentDb.leads || []).map((lead) => [lead.companyKey || lead.id, lead]));
  const specialists = [];
  const seen = new Set();

  for (const raw of backupDb.leads || []) {
    if (!isSpecialistPlatform(raw)) continue;
    const lead = normalize(raw);
    const key = platformProfileKey(lead);
    if (seen.has(key)) continue;
    seen.add(key);
    specialists.push({ ...lead, companyKey: `profile:${key}`, qualityStatus: "qualified" });
  }

  for (const lead of specialists) currentByKey.set(lead.companyKey || lead.id, lead);
  const restored = [...currentByKey.values()].sort((a, b) => Number(b.commercialScore || b.score || 0) - Number(a.commercialScore || a.score || 0));
  const stamp = nowIso().replace(/[:.]/g, "-");
  await fs.writeFile(path.join(dataDir, `leads-before-specialist-restore-${stamp}.json`), `${JSON.stringify(currentDb, null, 2)}\n`, "utf8");
  currentDb.leads = restored;
  currentDb.specialistRestore = { restoredAt: nowIso(), backup: path.basename(backup), restored: specialists.length };
  await writeDb(currentDb);
  console.log(`Restored ${specialists.length} specialist platform leads from ${path.basename(backup)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
