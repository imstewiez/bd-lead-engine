import fs from "node:fs/promises";
import path from "node:path";
import { exportLeads } from "./exporter.js";
import { rankLeadsCommercially } from "./intelligence.js";
import { sourceBucket } from "./mql5-limit.js";
import { getDbPath, getRootDir } from "./store.js";
import { domainOf, nowIso, platformFromUrl, unique } from "./utils.js";
import { cleanEmails, cleanForms, cleanLinks, cleanPhoneNumbers } from "./contact-cleaner.js";

const rootDir = getRootDir();
const dbPath = getDbPath();
const dataDir = path.dirname(dbPath);
const defaultLegacyDir = path.resolve(rootDir, "..", "Documents", "Codex", "2026-07-02", "se", "outputs", "bd-lead-engine", "data");
const explicitSources = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const sourceDirs = unique([dataDir, defaultLegacyDir, ...explicitSources]);

const ARRAY_FIELDS = [
  "emails",
  "forms",
  "socialLinks",
  "contactLinks",
  "websiteLinks",
  "relatedLinks",
  "contactSources",
  "phoneNumbers",
  "decisionMakers",
  "languages",
  "evidence",
  "runIds"
];

function stamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function candidateFiles(dir) {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => /(?:^|\\)(?:leads(?:\.backup-[^\\]+|-recovery-backup-[^\\]+)?\.json|leads\.json\.\d+\.\d+\.tmp)$/i.test(file));
}

async function readLeadDb(file) {
  try {
    const raw = await fs.readFile(file, "utf8");
    const db = JSON.parse(raw);
    return {
      file,
      leads: Array.isArray(db.leads) ? db.leads : [],
      runs: Array.isArray(db.runs) ? db.runs : [],
      updatedAt: db.updatedAt || ""
    };
  } catch (error) {
    return { file, leads: [], runs: [], error: error.message };
  }
}

function safeUrl(value = "") {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function profileKey(url = "") {
  const parsed = safeUrl(url);
  if (!parsed) return "";
  const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  if ((domain === "linkedin.com" || domain.endsWith(".linkedin.com")) && parts.length >= 2) return `linkedin:${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
  if ((domain === "instagram.com" || domain.endsWith(".instagram.com")) && parts[0]) return `instagram:${parts[0].toLowerCase()}`;
  if ((domain === "x.com" || domain === "twitter.com") && parts[0]) return `x:${parts[0].toLowerCase()}`;
  if ((domain === "t.me" || domain === "telegram.me") && parts[0]) return `telegram:${parts[0].toLowerCase()}`;
  if ((domain === "youtube.com" || domain.endsWith(".youtube.com")) && parts[0]) return `youtube:${parts.slice(0, 2).join("/").toLowerCase()}`;
  if ((domain === "mql5.com" || domain.endsWith(".mql5.com")) && parts.length >= 3) return `mql5:${parts.slice(0, 4).join("/").toLowerCase()}`;
  return "";
}

function urlKey(url = "") {
  const parsed = safeUrl(url);
  if (!parsed) return "";
  parsed.hash = "";
  parsed.search = "";
  const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathname = parsed.pathname.replace(/\/$/, "").toLowerCase();
  return domain ? `url:${domain}${pathname}` : "";
}

function weakNameKey(lead = {}) {
  const domain = domainOf(lead.url || lead.domain || "");
  const name = String(lead.name || lead.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!domain || !name || name.length < 7) return "";
  return `name:${domain}:${name.slice(0, 120)}`;
}

function keysForLead(lead = {}) {
  const links = unique([
    lead.url,
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.websiteLinks || []),
    ...(lead.relatedLinks || [])
  ]);
  const keys = [
    lead.id ? `id:${lead.id}` : "",
    ...cleanEmails(lead.emails || []).map((email) => `email:${email}`),
    ...links.flatMap((link) => [profileKey(link), urlKey(link)]),
    weakNameKey(lead)
  ].filter(Boolean);
  return unique(keys);
}

function scoreForMerge(lead = {}) {
  return (
    Number(lead.commercialScore || 0) * 3 +
    Number(lead.score || 0) +
    cleanEmails(lead.emails || []).length * 25 +
    cleanForms(lead.forms || []).length * 15 +
    cleanLinks([...(lead.socialLinks || []), ...(lead.contactLinks || []), lead.url]).length * 6 +
    cleanLinks(lead.websiteLinks || []).length * 5 +
    (lead.decisionMakers || []).length * 8 +
    String(lead.snippet || "").length / 80
  );
}

function mergeArrays(field, a = [], b = []) {
  if (field === "emails") return cleanEmails([...a, ...b]);
  if (field === "phoneNumbers") return cleanPhoneNumbers([...a, ...b]);
  if (field.endsWith("Links") || field === "contactSources" || field === "relatedLinks") return cleanLinks([...a, ...b], { allowYouTubeChannels: true, allowShorteners: true });
  if (field === "forms") return cleanForms([...a, ...b]);
  return unique([...a, ...b]);
}

function betterTextValue(primary, secondary, field) {
  const a = primary[field];
  const b = secondary[field];
  if (!a) return b;
  if (!b) return a;
  if (["snippet", "audience", "contactQuality"].includes(field)) return String(b).length > String(a).length ? b : a;
  return a;
}

function mergeLead(existing, incoming) {
  const current = scoreForMerge(existing) >= scoreForMerge(incoming) ? existing : incoming;
  const other = current === existing ? incoming : existing;
  const merged = { ...other, ...current };

  for (const field of ARRAY_FIELDS) {
    merged[field] = mergeArrays(field, existing[field] || [], incoming[field] || []);
  }

  for (const field of ["name", "title", "snippet", "country", "domain", "platform", "source", "query", "segment", "leadType", "priority", "contactQuality", "audience"]) {
    merged[field] = betterTextValue(current, other, field);
  }

  merged.stage = existing.stage && existing.stage !== "new" ? existing.stage : incoming.stage || existing.stage || "new";
  merged.notes = existing.notes || incoming.notes || "";
  merged.score = Math.max(Number(existing.score || 0), Number(incoming.score || 0));
  merged.contactConfidence = Math.max(Number(existing.contactConfidence || 0), Number(incoming.contactConfidence || 0));
  merged.firstSeen = [existing.firstSeen, incoming.firstSeen].filter(Boolean).sort()[0] || nowIso();
  merged.lastSeen = [existing.lastSeen, incoming.lastSeen, existing.updatedAt, incoming.updatedAt].filter(Boolean).sort().pop() || nowIso();
  merged.sourceBucket = merged.sourceBucket || sourceBucket(merged);
  merged.platform = merged.platform || platformFromUrl(merged.url || "") || "Web";
  return merged;
}

function normalizeLead(lead = {}) {
  const normalized = {
    ...lead,
    stage: lead.stage || "new",
    notes: lead.notes || "",
    firstSeen: lead.firstSeen || lead.createdAt || nowIso(),
    lastSeen: lead.lastSeen || lead.updatedAt || nowIso(),
    platform: lead.platform || platformFromUrl(lead.url || "") || "Web",
    sourceBucket: lead.sourceBucket || sourceBucket(lead)
  };
  for (const field of ARRAY_FIELDS) {
    normalized[field] = mergeArrays(field, [], lead[field] || []);
  }
  return normalized;
}

function mergeRuns(runs = []) {
  const seen = new Set();
  return runs
    .filter((run) => run && (run.id || run.startedAt))
    .sort((a, b) => String(b.startedAt || b.finishedAt || "").localeCompare(String(a.startedAt || a.finishedAt || "")))
    .filter((run) => {
      const key = run.id || `${run.startedAt}:${run.finishedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  const files = unique((await Promise.all(sourceDirs.map(candidateFiles))).flat());
  if (!files.length) throw new Error(`No lead DB files found in ${sourceDirs.join(", ")}`);

  const currentBackup = path.join(dataDir, `leads.recovery-backup-${stamp()}.json`);
  if (await exists(dbPath)) await fs.copyFile(dbPath, currentBackup);

  const dbs = await Promise.all(files.map(readLeadDb));
  const keyToIndex = new Map();
  const merged = [];
  const allRuns = [];
  let readCount = 0;

  for (const db of dbs) {
    allRuns.push(...db.runs);
    for (const rawLead of db.leads) {
      readCount += 1;
      const lead = normalizeLead(rawLead);
      const keys = keysForLead(lead);
      const existingIndex = keys.map((key) => keyToIndex.get(key)).find((index) => index !== undefined);
      if (existingIndex === undefined) {
        merged.push(lead);
        const index = merged.length - 1;
        for (const key of keys) keyToIndex.set(key, index);
        continue;
      }
      merged[existingIndex] = mergeLead(merged[existingIndex], lead);
      for (const key of keysForLead(merged[existingIndex])) keyToIndex.set(key, existingIndex);
    }
  }

  const ranked = rankLeadsCommercially(merged).map((lead) => ({
    ...lead,
    sourceBucket: lead.sourceBucket || sourceBucket(lead),
    platform: lead.platform || platformFromUrl(lead.url || "") || "Web"
  }));
  const output = {
    leads: ranked,
    runs: mergeRuns(allRuns),
    updatedAt: nowIso(),
    recoveredAt: nowIso(),
    recovery: {
      sourceDirs,
      files,
      readCount,
      mergedCount: ranked.length,
      currentBackup
    }
  };

  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.recovery.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, dbPath);
  const exportResult = await exportLeads();

  const bySource = ranked.reduce((acc, lead) => {
    const bucket = sourceBucket(lead);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    backup: currentBackup,
    filesRead: files.length,
    rawRead: readCount,
    recoveredRaw: ranked.length,
    exportedQualified: exportResult.exported,
    contactable: exportResult.contactable,
    social: exportResult.social,
    bySource
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
