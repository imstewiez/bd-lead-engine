import fs from "node:fs/promises";
import path from "node:path";
import { classifyResult } from "./classify.js";
import { cleanEmails, cleanForms, cleanLinks, cleanPhoneNumbers } from "./contact-cleaner.js";
import { deepEnrichResult } from "./deep.js";
import { exportLeads, isWorkingLead } from "./exporter.js";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { hasSearchableLeadSignal, hasStrictTradingIcp, leadRejectionReasons } from "./lead-quality.js";
import { commercialScoreForLead } from "./intelligence.js";
import { sourceBucket } from "./mql5-limit.js";
import { isBlockedCommercialLead } from "./noise-policy.js";
import { isPlatformProfileUrl } from "./platform-enrichment.js";
import { getRootDir, readDb, updateLead, upsertLeads } from "./store.js";
import { normalizeWhitespace, nowIso, platformFromUrl, sleep, unique } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "enrichment-worker-status.json");
const logPath = path.join(dataDir, "enrichment-worker.log");
const stopPath = path.join(dataDir, "enrichment-worker-stop");

const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
function numberArg(name, fallback) { const parsed = Number(args.get(name) || process.env[name.toUpperCase()] || fallback); return Number.isFinite(parsed) ? parsed : fallback; }

const options = {
  delayMs: Math.max(500, numberArg("delayMs", 2500)),
  idleMs: Math.max(3000, numberArg("idleMs", 8000)),
  staleHours: Math.max(0.25, numberArg("staleHours", 6)),
  hotStaleHours: Math.max(0.1, numberArg("hotStaleHours", 1)),
  contactlessStaleHours: Math.max(0.1, numberArg("contactlessStaleHours", 1)),
  rotationHours: Math.max(0.25, numberArg("rotationHours", 2)),
  maxContactPages: Math.max(1, Math.min(numberArg("maxContactPages", 6), 14)),
  maxExternalWebsites: Math.max(0, Math.min(numberArg("maxExternalWebsites", 4), 10)),
  maxTrailQueries: Math.max(2, Math.min(numberArg("maxTrailQueries", 14), 28)),
  trailLimit: Math.max(2, Math.min(numberArg("trailLimit", 6), 14))
};

const PRIORITY_BUCKETS = new Set(["linkedin", "instagram", "x", "telegram", "discord", "tiktok", "myfxbook", "mql5", "specialist", "forum", "recruitment"]);

async function appendLog(message) { await fs.mkdir(dataDir, { recursive: true }); await fs.appendFile(logPath, `${nowIso()} ${message}\n`, "utf8"); console.log(message); }
async function writeStatus(status) { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8"); }
async function stopRequested() { try { await fs.access(stopPath); return true; } catch { return false; } }
async function clearStopFile() { await fs.rm(stopPath, { force: true }).catch(() => {}); }
function ageHours(dateLike = "") { const parsed = Date.parse(dateLike || ""); return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / (60 * 60 * 1000)) : Infinity; }

function leadText(lead = {}) {
  return normalizeWhitespace([lead.name, lead.companyName, lead.title, lead.snippet, lead.url, lead.domain, lead.platform, lead.sourceIntent, lead.entityType, lead.segment, ...(lead.evidence || []), ...(lead.websiteLinks || []), ...(lead.socialLinks || []), ...(lead.contactLinks || [])].filter(Boolean).join(" ")).toLowerCase();
}

function isObviousEnrichmentNoise(lead = {}) {
  if (isBlockedCommercialLead(enhanceCommercialLead(lead))) return true;
  const text = leadText(lead);
  return /world health summit|microsoft store|google play|apps no google play|xbox|support trading with charm|ko-fi shop|^view @telegram\b|t\.me\/telegram\b|telegram\.org\b|tradingview\.com\/(?:chart|markets|symbols)|forexfactory\.com\/(?:calendar|news|market|scanner)|\bforex factory\b(?!.*(?:thread|member|profile|contact|telegram|whatsapp|introducing broker|affiliate|partnership))/.test(text);
}

function hasFreshRunningStatus(lead) { if (lead.deepStatus !== "running") return false; const started = Date.parse(lead.deepStartedAt || ""); return Number.isFinite(started) && Date.now() - started < 60 * 60 * 1000; }
function contactCompleteness(lead) { let score = 0; if ((lead.emails || []).length) score += 30; if ((lead.phoneNumbers || []).length) score += 20; if ((lead.forms || []).length) score += 20; if ((lead.websiteLinks || []).length) score += 10; if ((lead.decisionMakers || []).length) score += 20; if ((lead.decisionMakerLinks || []).length) score += 15; if ((lead.contactLinks || []).length) score += 10; if (lead.bestContact) score += 25; return score; }
function refreshHoursFor(lead) { const commercialScore = commercialScoreForLead(lead); if (contactCompleteness(lead) < 35) return options.contactlessStaleHours; if (commercialScore >= 78 || lead.priority === "A") return options.hotStaleHours; return options.staleHours; }
function hardReasons(lead) { return leadRejectionReasons(lead).filter((reason) => reason !== "missing strict forex/CFD/trading ICP signal"); }

function hasMinimumEnrichmentSignal(lead) {
  if (isWorkingLead(lead)) return true;
  if (hasStrictTradingIcp(lead)) return true;
  if (hasSearchableLeadSignal(lead)) return true;
  const text = leadText(lead);
  return /myfxbook\.com\/(?:members|portfolio)|mql5\.com\/en\/(?:signals|users)|fxblue\.com\/users|zulutrade\.com\/trader|darwinex\.com\/darwin|signalstart\.com\/analysis|collective2\.com/.test(text);
}

function isEligibleForEnrichment(lead) {
  const normalized = enhanceCommercialLead(lead);
  if (!normalized?.id || !normalized.url) return false;
  if (/youtube\.com|youtu\.be|facebook\.com\/public|\/profiles?/i.test(String(normalized.url))) return false;
  if (isBlockedCommercialLead(normalized)) return false;
  if (!hasStrictTradingIcp(normalized) && !hasMinimumEnrichmentSignal(normalized)) return false;
  if (normalized.segment === "Broker Site" && normalized.leadType !== "recruitment") return false;
  if (hasFreshRunningStatus(normalized)) return false;
  if (isObviousEnrichmentNoise(normalized)) return false;
  if (hardReasons(normalized).length) return false;
  return hasMinimumEnrichmentSignal(normalized);
}

function enrichmentDueReason(lead) { if (!isEligibleForEnrichment(lead)) return ""; if (!lead.lastDeepEnrichedAt) return "never"; const age = ageHours(lead.lastDeepEnrichedAt); const scheduledHours = refreshHoursFor(lead); if (age >= scheduledHours) return contactCompleteness(lead) < 35 ? "contactless_due" : "scheduled_due"; if (age >= options.rotationHours) return "rotation_due"; return ""; }
function platformRank(lead) { const bucket = sourceBucket(lead); if (["linkedin", "instagram", "x", "telegram", "discord", "tiktok"].includes(bucket)) return 0; if (["forum", "recruitment"].includes(bucket)) return 1; if (["myfxbook", "tradingview", "specialist"].includes(bucket)) return 2; if (bucket === "mql5") return 3; return 5; }
function duePriority(reason = "") { if (reason === "contactless_due") return 0; if (reason === "never") return 1; if (reason === "scheduled_due") return 2; if (reason === "rotation_due") return 3; return 9; }

function enrichmentQueueStats(leads = []) {
  const stats = { eligible: 0, dueNow: 0, never: 0, contactlessDue: 0, scheduledDue: 0, rotationDue: 0, recentlyEnriched1h: 0, recentlyEnriched24h: 0, blockedRunning: 0, blockedNoise: 0, oldestDeepAgeHours: 0 };
  for (const lead of leads) {
    if (hasFreshRunningStatus(lead)) stats.blockedRunning += 1;
    if (isBlockedCommercialLead(enhanceCommercialLead(lead))) stats.blockedNoise += 1;
    if (!isEligibleForEnrichment(lead)) continue;
    stats.eligible += 1;
    const age = ageHours(lead.lastDeepEnrichedAt);
    if (Number.isFinite(age)) { if (age <= 1) stats.recentlyEnriched1h += 1; if (age <= 24) stats.recentlyEnriched24h += 1; stats.oldestDeepAgeHours = Math.max(stats.oldestDeepAgeHours, Math.round(age * 10) / 10); }
    const reason = enrichmentDueReason(lead);
    if (!reason) continue;
    stats.dueNow += 1;
    if (reason === "never") stats.never += 1;
    if (reason === "contactless_due") stats.contactlessDue += 1;
    if (reason === "scheduled_due") stats.scheduledDue += 1;
    if (reason === "rotation_due") stats.rotationDue += 1;
  }
  return stats;
}

function pickNextLead(leads) {
  return leads.map((lead) => ({ lead, dueReason: enrichmentDueReason(lead) })).filter((item) => item.dueReason).sort((a, b) => {
    const leadA = a.lead, leadB = b.lead;
    const completenessA = contactCompleteness(leadA), completenessB = contactCompleteness(leadB);
    const commercialA = commercialScoreForLead(leadA), commercialB = commercialScoreForLead(leadB);
    return duePriority(a.dueReason) - duePriority(b.dueReason) || Number(completenessB < 35) - Number(completenessA < 35) || Number(leadB.priority === "A") - Number(leadA.priority === "A") || Number(PRIORITY_BUCKETS.has(sourceBucket(leadB))) - Number(PRIORITY_BUCKETS.has(sourceBucket(leadA))) || commercialB - commercialA || platformRank(leadA) - platformRank(leadB) || completenessA - completenessB || (leadB.score || 0) - (leadA.score || 0) || ageHours(leadB.lastDeepEnrichedAt) - ageHours(leadA.lastDeepEnrichedAt);
  })[0];
}

function maybeBaseValues(base, resetPlatformContacts, key) { return resetPlatformContacts ? [] : base[key] || []; }
function mergeLeadEnrichment(base, enriched) {
  const resetPlatformContacts = isPlatformProfileUrl(base.url);
  return { ...base, ...enriched, snippet: normalizeWhitespace([base.snippet, enriched.snippet, enriched.pageDescription].filter(Boolean).join(" ")).slice(0, 1400), emails: cleanEmails([...maybeBaseValues(base, resetPlatformContacts, "emails"), ...(enriched.emails || [])]), phoneNumbers: cleanPhoneNumbers([...maybeBaseValues(base, resetPlatformContacts, "phoneNumbers"), ...(enriched.phoneNumbers || [])]), forms: cleanForms([...maybeBaseValues(base, resetPlatformContacts, "forms"), ...(enriched.forms || [])]), contactLinks: cleanLinks([...maybeBaseValues(base, resetPlatformContacts, "contactLinks"), ...(enriched.contactLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }), socialLinks: cleanLinks([base.url, ...maybeBaseValues(base, resetPlatformContacts, "socialLinks"), ...(enriched.socialLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }), websiteLinks: cleanLinks([...maybeBaseValues(base, resetPlatformContacts, "websiteLinks"), ...(enriched.websiteLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }), relatedLinks: unique([...maybeBaseValues(base, resetPlatformContacts, "relatedLinks"), ...(enriched.relatedLinks || [])]).slice(0, 35), contactSources: unique([...maybeBaseValues(base, resetPlatformContacts, "contactSources"), ...(enriched.contactSources || [])]).slice(0, 25), decisionMakerLinks: unique([...(base.decisionMakerLinks || []), ...(enriched.decisionMakerLinks || [])]).slice(0, 12), decisionMakers: [...(base.decisionMakers || []), ...(enriched.decisionMakers || [])].slice(0, 10), contactConfidence: resetPlatformContacts ? Number(enriched.contactConfidence || 0) : Math.max(Number(base.contactConfidence || 0), Number(enriched.contactConfidence || 0)), bestContact: enriched.bestContact || (resetPlatformContacts ? "" : base.bestContact || ""), bestContactType: enriched.bestContactType || (resetPlatformContacts ? "" : base.bestContactType || ""), bestContactSource: enriched.bestContactSource || (resetPlatformContacts ? "" : base.bestContactSource || ""), platform: enriched.platform || base.platform || platformFromUrl(base.url) };
}

async function enrichOne(lead, dueReason = "") {
  await updateLead(lead.id, { deepStatus: "running", deepStartedAt: nowIso(), deepDueReason: dueReason, enrichmentAttempts: Number(lead.enrichmentAttempts || 0) + 1 });
  const enriched = await deepEnrichResult(lead, { searchContacts: true, maxContactPages: options.maxContactPages, maxExternalWebsites: options.maxExternalWebsites, maxTrailQueries: options.maxTrailQueries, trailLimit: options.trailLimit });
  const merged = mergeLeadEnrichment(lead, enriched);
  const finalLead = enhanceCommercialLead({ ...classifyResult(merged, merged.sourceIntent || merged.leadType || "partner"), deepStatus: "done", deepDueReason: dueReason, deepFinishedAt: nowIso(), lastDeepEnrichedAt: nowIso(), enrichmentWorker: true });
  const reasons = leadRejectionReasons(finalLead);
  if (reasons.length || isBlockedCommercialLead(finalLead)) {
    await updateLead(lead.id, { deepStatus: "rejected", qualityStatus: "rejected", deepDueReason: dueReason, deepFinishedAt: nowIso(), lastDeepEnrichedAt: nowIso(), rejectionReasons: unique([...reasons, isBlockedCommercialLead(finalLead) ? "commercial noise policy" : ""]).filter(Boolean) });
    return { status: "rejected", lead: finalLead, reasons };
  }
  const stored = await upsertLeads([finalLead], `enrichment_worker_${Date.now()}`);
  const exported = await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
  return { status: "stored", lead: finalLead, stored, exported };
}

await clearStopFile();
await appendLog(`[enrichment-worker] Started with ${JSON.stringify(options)}`);
await writeStatus({ status: "running", phase: "started", options });
let processed = 0, rejected = 0, errors = 0, idleCycles = 0, lastResult = null;
while (!(await stopRequested())) {
  const db = await readDb();
  const queue = enrichmentQueueStats(db.leads || []);
  const selected = pickNextLead(db.leads || []);
  if (!selected) { idleCycles += 1; await writeStatus({ status: "running", phase: "idle", options, processed, rejected, errors, idleCycles, queue, lastResult, total: db.leads.length }); await sleep(options.idleMs); continue; }
  idleCycles = 0;
  const { lead, dueReason } = selected;
  await writeStatus({ status: "running", phase: "enriching", options, processed, rejected, errors, idleCycles, queue, current: { id: lead.id, name: lead.name, url: lead.url, platform: lead.platform, dueReason } });
  try {
    const result = await enrichOne(lead, dueReason);
    processed += 1;
    if (result.status === "rejected") rejected += 1;
    lastResult = { status: result.status, id: lead.id, name: lead.name || lead.url, dueReason, at: nowIso(), emails: (result.lead.emails || []).length, links: (result.lead.contactLinks || []).length, makers: (result.lead.decisionMakers || []).length, bestContact: result.lead.bestContact || "" };
    await appendLog(`[enrichment-worker] ${result.status} ${dueReason} ${lead.id} ${lead.name || lead.url}; emails=${lastResult.emails}; links=${lastResult.links}; makers=${lastResult.makers}; best=${lastResult.bestContact || "-"}`);
  } catch (error) {
    errors += 1;
    lastResult = { status: "error", id: lead.id, name: lead.name || lead.url, dueReason, at: nowIso(), error: error.message };
    await updateLead(lead.id, { deepStatus: "error", deepDueReason: dueReason, deepFinishedAt: nowIso(), enrichmentErrors: unique([...(lead.enrichmentErrors || []), error.message]).slice(0, 8) }).catch(() => {});
    await appendLog(`[enrichment-worker] error ${dueReason} ${lead.id} ${error.stack || error.message}`);
  }
  if (!(await stopRequested())) await sleep(options.delayMs);
}
await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
await writeStatus({ status: "stopped", phase: "stopped", options, processed, rejected, errors, lastResult });
await appendLog(`[enrichment-worker] Stopped. processed=${processed}; rejected=${rejected}; errors=${errors}`);
