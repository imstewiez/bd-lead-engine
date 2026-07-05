import fs from "node:fs/promises";
import path from "node:path";
import { classifyResult } from "./classify.js";
import { cleanForms, cleanPhoneNumbers } from "./contact-cleaner.js";
import { exportLeads } from "./exporter.js";
import { commercialScoreForLead } from "./intelligence.js";
import { sourceBucket } from "./mql5-limit.js";
import { cleanDecisionContactLinks, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { deepEnrichResult } from "./smart-deep.js";
import { getRootDir, readDb, updateLead, upsertLeads } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "contact-gap-worker-status.json");
const stopPath = path.join(dataDir, "contact-gap-worker-stop");

const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
const delayMs = Math.max(1000, Number(args.get("delayMs") || 4500));
const idleMs = Math.max(5000, Number(args.get("idleMs") || 12000));
const maxTrailQueries = Math.max(8, Math.min(Number(args.get("maxTrailQueries") || 30), 32));
const trailLimit = Math.max(4, Math.min(Number(args.get("trailLimit") || 12), 14));
const maxContactPages = Math.max(4, Math.min(Number(args.get("maxContactPages") || 10), 12));

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

function ageHours(value = "") {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3600000) : Infinity;
}

function realContactParts(lead = {}) {
  const cleaned = stripPlatformOwnedContacts(lead);
  const best = pickBestContact(cleaned);
  const emails = filterDecisionMakerEmails(cleaned);
  const phones = cleanPhoneNumbers(cleaned.phoneNumbers || []);
  const forms = cleanForms(cleaned.forms || []);
  const directLinks = cleanDecisionContactLinks([best.bestContact, cleaned.bestContact, ...(cleaned.contactLinks || []), ...(cleaned.socialLinks || [])]);
  const platformEmail = (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
  const bestIsReal = Boolean(best.bestContact && best.bestContactType !== "website" && !isPlatformProfileUrl(best.bestContact));
  return { cleaned, best, emails, phones, forms, directLinks, platformEmail, bestIsReal };
}

function hasRealContact(lead = {}) {
  const parts = realContactParts(lead);
  return !parts.platformEmail && (parts.emails.length > 0 || parts.phones.length > 0 || parts.forms.length > 0 || parts.directLinks.length > 0 || parts.bestIsReal);
}

function hasPlatformBestContact(lead = {}) {
  return Boolean(lead.bestContact && isPlatformProfileUrl(lead.bestContact));
}

function isWebsiteOnly(lead = {}) {
  if (hasRealContact(lead)) return false;
  const { cleaned, best } = realContactParts(lead);
  return best.bestContactType === "website" || (cleaned.websiteLinks || []).some((url) => !isPlatformProfileUrl(url));
}

function isImportantGap(lead = {}) {
  if (!lead.id || !lead.url) return false;
  if (lead.deepStatus === "running" && ageHours(lead.deepStartedAt) < 1) return false;
  if (lead.contactGapDoneAt && ageHours(lead.contactGapDoneAt) < 1) return false;
  const bucket = sourceBucket(lead);
  const commercial = commercialScoreForLead(lead);
  const specialist = isPlatformProfileUrl(lead.url) || ["myfxbook", "mql5", "specialist"].includes(bucket) || /zulutrade|fxblue|darwinex|signalstart|collective2/i.test(`${lead.platform || ""} ${lead.url || ""}`);
  const priorityGap = !hasRealContact(lead) && (commercial >= 72 || lead.priority === "A" || specialist);
  return hasPlatformBestContact(lead) || isWebsiteOnly(lead) || priorityGap;
}

function gapScore(lead = {}) {
  let score = commercialScoreForLead(lead);
  if (!hasRealContact(lead)) score += 100;
  if (hasPlatformBestContact(lead)) score += 70;
  if (isWebsiteOnly(lead)) score += 45;
  if (isPlatformProfileUrl(lead.url)) score += 40;
  if (lead.priority === "A") score += 25;
  if (["myfxbook", "mql5", "specialist"].includes(sourceBucket(lead))) score += 25;
  return score;
}

function pickNext(leads = []) {
  return leads.filter(isImportantGap).sort((a, b) => gapScore(b) - gapScore(a) || ageHours(b.contactGapDoneAt) - ageHours(a.contactGapDoneAt))[0];
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

  await writeStatus({ status: "running", phase: "enriching-gap", processed, stored, errors, current: { id: lead.id, name: lead.name, url: lead.url, bucket: sourceBucket(lead), score: gapScore(lead) }, lastResult });
  try {
    await updateLead(lead.id, { deepStatus: "running", deepStartedAt: nowIso(), contactGapStartedAt: nowIso() });
    const cleaned = stripPlatformOwnedContacts(lead);
    const enriched = await deepEnrichResult(cleaned, { searchContacts: true, maxTrailQueries, trailLimit, maxContactPages, maxExternalWebsites: 8 });
    const classified = classifyResult({ ...cleaned, ...enriched, contactGapDoneAt: nowIso() }, enriched.sourceIntent || enriched.leadType || "partner");
    const finalLead = { ...classified, deepStatus: "done", contactGapWorker: true, contactGapDoneAt: nowIso(), lastDeepEnrichedAt: nowIso() };
    const result = await upsertLeads([finalLead], `contact_gap_${Date.now()}`);
    await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
    processed += 1;
    stored += result.created.length + result.updated.length;
    lastResult = { id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), bestContact: finalLead.bestContact || "", contactLinks: (finalLead.contactLinks || []).length, websites: (finalLead.websiteLinks || []).length, hasRealContact: hasRealContact(finalLead), at: nowIso() };
  } catch (error) {
    errors += 1;
    lastResult = { id: lead.id, name: lead.name || lead.url, bucket: sourceBucket(lead), error: error.message, at: nowIso() };
    await updateLead(lead.id, { deepStatus: "error", contactGapError: error.message, contactGapDoneAt: nowIso() }).catch(() => {});
  }
  await sleep(delayMs);
}

await writeStatus({ status: "stopped", phase: "stopped", processed, stored, errors, lastResult });
