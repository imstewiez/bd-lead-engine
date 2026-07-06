import fs from "node:fs/promises";
import path from "node:path";
import { classifyResult } from "./classify.js";
import { cleanForms, cleanPhoneNumbers } from "./contact-cleaner.js";
import { exportLeads } from "./exporter.js";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { commercialScoreForLead } from "./intelligence.js";
import { sourceBucket } from "./mql5-limit.js";
import { isBlockedCommercialLead } from "./noise-policy.js";
import { cleanDecisionContactLinks, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
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
const HIGH_VALUE_SOCIAL_BUCKETS = new Set(["telegram", "instagram", "x", "tiktok", "discord"]);

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

async function stopRequested() { try { await fs.access(stopPath); return true; } catch { return false; } }
function ageHours(dateLike = "") { const parsed = Date.parse(dateLike || ""); return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3600000) : Infinity; }
function normalized(lead = {}) { return enhanceCommercialLead(lead); }
function leadText(lead = {}) { return [lead.name, lead.companyName, lead.title, lead.snippet, lead.url, lead.platform, lead.segment, lead.entityType].filter(Boolean).join(" ").toLowerCase(); }

function hasDecisionContact(lead = {}) {
  const stripped = stripPlatformOwnedContacts(lead);
  const best = pickBestContact(stripped);
  const platformEmail = (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
  const emails = filterDecisionMakerEmails(stripped);
  const phones = cleanPhoneNumbers(stripped.phoneNumbers || []);
  const forms = cleanForms(stripped.forms || []);
  const directLinks = cleanDecisionContactLinks([stripped.bestContact, ...(stripped.contactLinks || []), ...(stripped.socialLinks || [])]);
  const bestIsReal = Boolean(best.bestContact && best.bestContactType !== "website" && !isPlatformProfileUrl(best.bestContact));
  return !platformEmail && (emails.length > 0 || phones.length > 0 || forms.length > 0 || directLinks.length > 0 || bestIsReal || Number(stripped.contactConfidence || 0) >= 90);
}

function isAllowedSmartTarget(lead = {}) {
  const item = normalized(lead);
  const text = leadText(item);
  if (!item.id || !item.url) return false;
  if (isBlockedCommercialLead(item)) return false;
  if (/youtube\.com|youtu\.be|facebook\.com\/public|\/profiles?|gateway\.discord\.gg|discadia\.com|jobs?\b|careers?/i.test(`${item.url || ""} ${text}`)) return false;
  if (/\b(?:posts x|instagram photos and videos|dashboard|login|sign in|examplefx blue statistics|forex factory$)\b/i.test(text)) return false;
  const bucket = sourceBucket(item);
  const commercialScore = commercialScoreForLead(item);
  const isSpecialistPlatform = isPlatformProfileUrl(item.url) || ["myfxbook", "mql5", "specialist"].includes(bucket) || /zulutrade|fxblue|darwinex|signalstart|collective2/i.test(`${item.platform || ""} ${item.url || ""}`);
  const hasTradingIdentity = /\b(?:forex|xauusd|gold|copy trading|signals?|pamm|mam|introducing broker|forex affiliate|trading academy|telegram|whatsapp)\b/i.test(text);
  const isHighValueSocial = HIGH_VALUE_SOCIAL_BUCKETS.has(bucket) && commercialScore >= 76 && hasTradingIdentity;
  return isSpecialistPlatform || isHighValueSocial;
}

function needsSmartTrail(lead = {}) {
  const item = normalized(lead);
  if (!isAllowedSmartTarget(item)) return false;
  if (item.deepStatus === "running" && ageHours(item.deepStartedAt) < 1) return false;
  if (item.smartTrailDoneAt && ageHours(item.smartTrailDoneAt) < 8) return false;
  return !hasDecisionContact(item) || Number(item.contactConfidence || 0) < 80;
}

function pickNext(leads = []) {
  return leads.filter(needsSmartTrail).sort((a, b) => Number(b.priority === "A") - Number(a.priority === "A") || commercialScoreForLead(b) - commercialScoreForLead(a) || ageHours(b.smartTrailDoneAt) - ageHours(a.smartTrailDoneAt))[0];
}

let processed = 0, stored = 0, rejected = 0, errors = 0, lastResult = null;
await fs.rm(stopPath, { force: true }).catch(() => {});
await writeStatus({ status: "running", phase: "started", processed, stored, rejected, errors });

while (!(await stopRequested())) {
  const db = await readDb();
  const lead = pickNext(db.leads || []);
  if (!lead) {
    await writeStatus({ status: "running", phase: "idle", processed, stored, rejected, errors, total: db.leads?.length || 0, lastResult });
    await sleep(idleMs);
    continue;
  }

  await writeStatus({ status: "running", phase: "smart-enriching", processed, stored, rejected, errors, current: { id: lead.id, name: lead.name, url: lead.url, platform: lead.platform, bucket: sourceBucket(lead) }, lastResult });
  try {
    await updateLead(lead.id, { deepStatus: "running", smartTrailStartedAt: nowIso() });
    const cleaned = stripPlatformOwnedContacts(lead);
    const enriched = await deepEnrichResult(cleaned, { searchContacts: true, maxTrailQueries, trailLimit, maxContactPages, maxExternalWebsites: 8 });
    const finalLead = normalized({ ...classifyResult({ ...cleaned, ...enriched, smartTrailDoneAt: nowIso() }, enriched.sourceIntent || enriched.leadType || "partner"), deepStatus: "done", smartTrailWorker: true, smartTrailDoneAt: nowIso(), lastDeepEnrichedAt: nowIso() });
    if (isBlockedCommercialLead(finalLead)) {
      rejected += 1;
      await updateLead(lead.id, { deepStatus: "rejected", qualityStatus: "rejected", smartTrailDoneAt: nowIso(), rejectionReasons: ["commercial noise policy"] });
      lastResult = { status: "rejected", id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), at: nowIso() };
    } else {
      const result = await upsertLeads([finalLead], `smart_enrichment_${Date.now()}`);
      await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
      stored += result.created.length + result.updated.length;
      lastResult = { status: "stored", id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), bestContact: finalLead.bestContact || "", contactLinks: (finalLead.contactLinks || []).length, websites: (finalLead.websiteLinks || []).length, related: (finalLead.relatedLinks || []).length, hasDecisionContact: hasDecisionContact(finalLead), at: nowIso() };
    }
    processed += 1;
  } catch (error) {
    errors += 1;
    lastResult = { status: "error", id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), error: error.message, at: nowIso() };
    await updateLead(lead.id, { deepStatus: "error", smartTrailError: error.message, smartTrailDoneAt: nowIso() }).catch(() => {});
  }
  await sleep(delayMs);
}

await writeStatus({ status: "stopped", phase: "stopped", processed, stored, rejected, errors, lastResult });
