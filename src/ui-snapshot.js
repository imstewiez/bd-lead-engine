import fs from "node:fs/promises";
import path from "node:path";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { isExportQualified, isWorkingLead } from "./exporter.js";
import { isBlockedCommercialLead } from "./noise-policy.js";
import { getRootDir, readDb } from "./store.js";
import { platformFromUrl } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");
const snapshotPath = path.join(dataDir, "ui-dashboard.json");
const publicSnapshotPath = path.join(publicDir, "ui-dashboard.json");
const rejectedSnapshotPath = path.join(dataDir, "ui-dashboard-rejected.json");
const statusPath = path.join(dataDir, "ui-snapshot-worker-status.json");
const intervalMs = Number(process.argv.find((arg) => arg.startsWith("--intervalMs="))?.split("=")[1] || process.env.UI_SNAPSHOT_INTERVAL_MS || 12000);
const once = process.argv.includes("--once");

function platformForLead(lead = {}) { return lead.platform || platformFromUrl(lead.url || "") || "Unknown"; }
function searchableText(lead = {}) { return [lead.name, lead.companyName, lead.title, lead.snippet, lead.url, lead.domain, lead.country, lead.leadType, lead.segment, lead.entityType, ...(lead.evidence || [])].filter(Boolean).join(" ").toLowerCase(); }
function isUiLead(rawLead = {}) {
  const lead = enhanceCommercialLead(rawLead);
  if (!lead.url || (!lead.name && !lead.title && !lead.companyName)) return false;
  if (isBlockedCommercialLead(lead)) return false;
  if (lead.segment === "Broker Site") return false;
  if (lead.priority === "D") return false;
  if (Number(lead.score || 0) < 45 && Number(lead.commercialScore || 0) < 45) return false;
  const text = searchableText(lead);
  if (/youtube\.com|youtu\.be|facebook\.com\/public|investopedia|wikipedia|dictionary|calendar|market scanner|crypto news|payments|stablecoin|course catalog|hotel|tourism|academy residence|posts x|instagram photos and videos|dashboard|login|sign in|examplefx blue statistics|jobs careers|careershfm|gateway\.discord\.gg|discadia\.com/i.test(text)) return false;
  if (/\b(?:what is|what are|guide to|basics of|definition|pronunciation|o que é|o que e|guia completo|noções básicas|nocões básicas)\b/i.test(text)) return false;
  return isExportQualified(lead) || isWorkingLead(lead) || Number(lead.commercialScore || 0) >= 58;
}
function contactRank(lead = {}) { return Number(cleanEmails(lead.emails || []).length > 0) * 4 + Number(cleanForms(lead.forms || []).length > 0) * 3 + Number(hasDirectOutboundPath(lead)); }
function score(lead = {}) { return Number(lead.commercialScore || lead.score || 0) + contactRank(lead); }
function compactLead(rawLead = {}) {
  const lead = enhanceCommercialLead(rawLead);
  return { id: lead.id, name: lead.companyName || lead.name, title: lead.title, url: lead.url, domain: lead.domain, platform: platformForLead(lead), priority: lead.priority, score: lead.score, commercialScore: lead.commercialScore, contactConfidence: lead.contactConfidence, contactQuality: lead.contactQuality, bestContact: lead.bestContact, bestContactType: lead.bestContactType, bestContactSource: lead.bestContactSource, leadType: lead.leadType, segment: lead.segment, country: lead.country, languages: lead.languages || [], stage: lead.stage || "new", snippet: lead.snippet, evidence: lead.evidence || [], outbound: lead.outbound || {}, emails: lead.emails || [], socialLinks: lead.socialLinks || [], contactLinks: lead.contactLinks || [], websiteLinks: lead.websiteLinks || [], phoneNumbers: lead.phoneNumbers || [], forms: lead.forms || [], firstSeen: lead.firstSeen, lastSeen: lead.lastSeen, updatedAt: lead.updatedAt };
}
function summarize(leads, rawTotal) {
  const counts = { total: leads.length, priorityA: leads.filter((lead) => lead.priority === "A" || Number(lead.commercialScore || lead.score || 0) >= 76).length, priorityB: leads.filter((lead) => lead.priority === "B").length, partners: leads.filter((lead) => lead.leadType === "partner").length, recruitment: leads.filter((lead) => lead.leadType === "recruitment").length, institutions: leads.filter((lead) => lead.leadType === "institution").length, new: leads.filter((lead) => (lead.stage || "new") === "new").length, contacted: leads.filter((lead) => lead.stage === "contacted").length, booked: leads.filter((lead) => lead.stage === "meeting_booked").length, contactable: leads.filter((lead) => cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)).length, emails: leads.filter((lead) => cleanEmails(lead.emails || []).length).length, forms: leads.filter((lead) => cleanForms(lead.forms || []).length).length, directLinks: leads.filter(hasDirectOutboundPath).length, clusters: 0 };
  const byPlatform = leads.reduce((acc, lead) => { const key = platformForLead(lead); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const bySegment = leads.reduce((acc, lead) => { const key = lead.segment || "Unclear"; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const byCountry = leads.reduce((acc, lead) => { const key = lead.country || "Unknown"; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  return { counts, byPlatform, bySegment, byCountry, rawTotal };
}
async function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(tmp, payload, "utf8");
  let lastError = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try { await fs.rename(tmp, filePath); return; }
    catch (error) { lastError = error; if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error; await sleep(80 * attempt); }
  }
  await fs.copyFile(tmp, filePath);
  await fs.rm(tmp, { force: true }).catch(() => {});
  if (lastError) return;
}
export async function buildUiSnapshot() {
  const startedAt = Date.now();
  const db = await readDb();
  const allLeads = db.leads || [];
  const accepted = [];
  const rejected = [];
  for (const lead of allLeads) {
    if (isUiLead(lead)) accepted.push(enhanceCommercialLead(lead));
    else rejected.push({ id: lead.id, name: lead.name, title: lead.title, url: lead.url, score: lead.score, commercialScore: lead.commercialScore, priority: lead.priority, leadType: lead.leadType, segment: lead.segment, platform: platformForLead(lead) });
  }
  const leads = accepted.sort((a, b) => score(b) - score(a) || String(b.lastSeen || "").localeCompare(String(a.lastSeen || ""))).map(compactLead);
  const snapshot = { version: 3, generatedAt: new Date().toISOString(), sourceUpdatedAt: db.updatedAt || null, qualityGate: "commercial-noise-policy-v3", buildMs: Date.now() - startedAt, rawTotal: allLeads.length, rejectedTotal: rejected.length, total: leads.length, leads, summary: summarize(leads, allLeads.length) };
  await writeJsonAtomic(snapshotPath, snapshot);
  await writeJsonAtomic(publicSnapshotPath, snapshot);
  await writeJsonAtomic(rejectedSnapshotPath, { generatedAt: snapshot.generatedAt, total: rejected.length, rejected: rejected.slice(0, 5000) });
  await writeJsonAtomic(statusPath, { ok: true, updatedAt: snapshot.generatedAt, total: leads.length, rawTotal: allLeads.length, rejectedTotal: rejected.length, buildMs: snapshot.buildMs, qualityGate: snapshot.qualityGate });
  return snapshot;
}
async function loop() {
  while (true) {
    try { const snapshot = await buildUiSnapshot(); console.log(`[ui-snapshot] ok total=${snapshot.total} rejected=${snapshot.rejectedTotal} buildMs=${snapshot.buildMs}`); }
    catch (error) { console.error(`[ui-snapshot] ${error.stack || error.message}`); await writeJsonAtomic(statusPath, { ok: false, updatedAt: new Date().toISOString(), error: error.message }); }
    if (once) return;
    await sleep(intervalMs);
  }
}
loop().catch((error) => { console.error(error); process.exitCode = 1; });
