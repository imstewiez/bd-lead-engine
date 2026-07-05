import fs from "node:fs/promises";
import path from "node:path";
import { classifyResult } from "./classify.js";
import { exportLeads } from "./exporter.js";
import { commercialScoreForLead } from "./intelligence.js";
import { sourceBucket } from "./mql5-limit.js";
import { isPlatformProfileUrl } from "./platform-enrichment.js";
import { isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { deepEnrichResult } from "./smart-deep.js";
import { getRootDir, readDb, updateLead, upsertLeads } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "smart-enrichment-worker-status.json");
const stopPath = path.join(dataDir, "smart-enrichment-worker-stop");

const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
const delayMs = Math.max(1000, Number(args.get("delayMs") || 7000));
const idleMs = Math.max(5000, Number(args.get("idleMs") || 15000));
const maxTrailQueries = Math.max(8, Math.min(Number(args.get("maxTrailQueries") || 24), 28));
const trailLimit = Math.max(4, Math.min(Number(args.get("trailLimit") || 10), 14));
const maxContactPages = Math.max(4, Math.min(Number(args.get("maxContactPages") || 8), 12));
const HIGH_VALUE_SOCIAL_BUCKETS = new Set(["telegram", "instagram", "x", "tiktok", "facebook_threads", "discord"]);

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

async function stopRequested() {
  try {
    await fs.access(stopPath);
    return true;
  } catch {
    return false;
  }
}

function ageHours(dateLike = "") {
  const parsed = Date.parse(dateLike || "");
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3600000) : Infinity;
}

function hasDecisionContact(lead = {}) {
  const platformEmail = (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
  const directBest = Boolean(lead.bestContact && lead.bestContactType !== "email");
  const directLinks = (lead.contactLinks || []).length > 0;
  const makerLinks = (lead.decisionMakerLinks || []).length > 0 || (lead.decisionMakers || []).length > 0;
  return !platformEmail && (directBest || directLinks || makerLinks || Number(lead.contactConfidence || 0) >= 85);
}

function needsSmartTrail(lead = {}) {
  if (!lead.id || !lead.url) return false;
  const bucket = sourceBucket(lead);
  const commercialScore = commercialScoreForLead(lead);
  const isSpecialistPlatform = isPlatformProfileUrl(lead.url) || ["myfxbook", "mql5", "specialist"].includes(bucket) || /zulutrade|fxblue|darwinex|signalstart|collective2/i.test(`${lead.platform || ""} ${lead.url || ""}`);
  const isHighValueSocial = HIGH_VALUE_SOCIAL_BUCKETS.has(bucket) && (commercialScore >= 72 || lead.priority === "A");
  if (!isSpecialistPlatform && !isHighValueSocial) return false;
  if (lead.deepStatus === "running" && ageHours(lead.deepStartedAt) < 1) return false;
  if (lead.smartTrailDoneAt && ageHours(lead.smartTrailDoneAt) < 6) return false;
  return !hasDecisionContact(lead) || Number(lead.contactConfidence || 0) < 80;
}

function pickNext(leads = []) {
  return leads
    .filter(needsSmartTrail)
    .sort((a, b) => Number(b.priority === "A") - Number(a.priority === "A") || commercialScoreForLead(b) - commercialScoreForLead(a) || ageHours(b.smartTrailDoneAt) - ageHours(a.smartTrailDoneAt))[0];
}

let processed = 0;
let stored = 0;
let errors = 0;
let lastResult = null;
await fs.rm(stopPath, { force: true }).catch(() => {});
await writeStatus({ status: "running", phase: "started", processed, stored, errors });

while (!(await stopRequested())) {
  const db = await readDb();
  const lead = pickNext(db.leads || []);
  if (!lead) {
    await writeStatus({ status: "running", phase: "idle", processed, stored, errors, total: db.leads?.length || 0, lastResult });
    await sleep(idleMs);
    continue;
  }

  await writeStatus({ status: "running", phase: "smart-enriching", processed, stored, errors, current: { id: lead.id, name: lead.name, url: lead.url, platform: lead.platform, bucket: sourceBucket(lead) }, lastResult });
  try {
    await updateLead(lead.id, { deepStatus: "running", smartTrailStartedAt: nowIso() });
    const cleaned = stripPlatformOwnedContacts(lead);
    const enriched = await deepEnrichResult(cleaned, { searchContacts: true, maxTrailQueries, trailLimit, maxContactPages, maxExternalWebsites: 8 });
    const classified = classifyResult({ ...cleaned, ...enriched, smartTrailDoneAt: nowIso() }, enriched.sourceIntent || enriched.leadType || "partner");
    const finalLead = { ...classified, deepStatus: "done", smartTrailWorker: true, smartTrailDoneAt: nowIso(), lastDeepEnrichedAt: nowIso() };
    const result = await upsertLeads([finalLead], `smart_enrichment_${Date.now()}`);
    await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
    processed += 1;
    stored += result.created.length + result.updated.length;
    lastResult = { id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), bestContact: finalLead.bestContact || "", contactLinks: (finalLead.contactLinks || []).length, websites: (finalLead.websiteLinks || []).length, related: (finalLead.relatedLinks || []).length, at: nowIso() };
  } catch (error) {
    errors += 1;
    lastResult = { id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), error: error.message, at: nowIso() };
    await updateLead(lead.id, { deepStatus: "error", smartTrailError: error.message, smartTrailDoneAt: nowIso() }).catch(() => {});
  }
  await sleep(delayMs);
}

await writeStatus({ status: "stopped", phase: "stopped", processed, stored, errors, lastResult });
