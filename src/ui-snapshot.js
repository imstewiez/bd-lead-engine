import fs from "node:fs/promises";
import path from "node:path";
import { getRootDir, readDb } from "./store.js";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { platformFromUrl } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");
const snapshotPath = path.join(dataDir, "ui-dashboard.json");
const publicSnapshotPath = path.join(publicDir, "ui-dashboard.json");
const statusPath = path.join(dataDir, "ui-snapshot-worker-status.json");
const intervalMs = Number(process.argv.find((arg) => arg.startsWith("--intervalMs="))?.split("=")[1] || process.env.UI_SNAPSHOT_INTERVAL_MS || 12000);
const once = process.argv.includes("--once");

function platformForLead(lead = {}) {
  return lead.platform || platformFromUrl(lead.url || "") || "Unknown";
}

function isUiLead(lead = {}) {
  if (!lead.url && !lead.name && !lead.title) return false;
  if (lead.segment === "Broker Site") return false;
  if (lead.priority === "D" && Number(lead.score || 0) < 35) return false;
  return Number(lead.score || 0) >= 35 || lead.qualificationStatus === "research_candidate" || ["partner", "recruitment", "institution"].includes(lead.leadType);
}

function contactRank(lead = {}) {
  return Number(cleanEmails(lead.emails || []).length > 0) * 4 + Number(cleanForms(lead.forms || []).length > 0) * 3 + Number(hasDirectOutboundPath(lead));
}

function score(lead = {}) {
  return Number(lead.commercialScore || lead.score || 0) + contactRank(lead);
}

function compactLead(lead = {}) {
  return {
    id: lead.id,
    name: lead.name,
    title: lead.title,
    url: lead.url,
    domain: lead.domain,
    platform: platformForLead(lead),
    priority: lead.priority,
    score: lead.score,
    commercialScore: lead.commercialScore,
    contactConfidence: lead.contactConfidence,
    contactQuality: lead.contactQuality,
    bestContact: lead.bestContact,
    bestContactType: lead.bestContactType,
    bestContactSource: lead.bestContactSource,
    leadType: lead.leadType,
    segment: lead.segment,
    country: lead.country,
    languages: lead.languages || [],
    stage: lead.stage || "new",
    snippet: lead.snippet,
    evidence: lead.evidence || [],
    outbound: lead.outbound || {},
    emails: lead.emails || [],
    socialLinks: lead.socialLinks || [],
    contactLinks: lead.contactLinks || [],
    websiteLinks: lead.websiteLinks || [],
    phoneNumbers: lead.phoneNumbers || [],
    forms: lead.forms || [],
    firstSeen: lead.firstSeen,
    lastSeen: lead.lastSeen,
    updatedAt: lead.updatedAt
  };
}

function summarize(leads, rawTotal) {
  const counts = {
    total: leads.length,
    priorityA: leads.filter((lead) => lead.priority === "A" || Number(lead.score || 0) >= 76).length,
    priorityB: leads.filter((lead) => lead.priority === "B").length,
    partners: leads.filter((lead) => lead.leadType === "partner").length,
    recruitment: leads.filter((lead) => lead.leadType === "recruitment").length,
    institutions: leads.filter((lead) => lead.leadType === "institution").length,
    new: leads.filter((lead) => (lead.stage || "new") === "new").length,
    contacted: leads.filter((lead) => lead.stage === "contacted").length,
    booked: leads.filter((lead) => lead.stage === "meeting_booked").length,
    contactable: leads.filter((lead) => cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)).length,
    emails: leads.filter((lead) => cleanEmails(lead.emails || []).length).length,
    forms: leads.filter((lead) => cleanForms(lead.forms || []).length).length,
    directLinks: leads.filter(hasDirectOutboundPath).length,
    clusters: 0
  };
  const byPlatform = leads.reduce((acc, lead) => {
    const key = platformForLead(lead);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const bySegment = leads.reduce((acc, lead) => {
    const key = lead.segment || "Unclear";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const byCountry = leads.reduce((acc, lead) => {
    const key = lead.country || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return { counts, byPlatform, bySegment, byCountry, rawTotal };
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export async function buildUiSnapshot() {
  const startedAt = Date.now();
  const db = await readDb();
  const leads = (db.leads || [])
    .filter(isUiLead)
    .sort((a, b) => score(b) - score(a) || String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))
    .map(compactLead);
  const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: db.updatedAt || null,
    buildMs: Date.now() - startedAt,
    total: leads.length,
    leads,
    summary: summarize(leads, (db.leads || []).length)
  };
  await writeJsonAtomic(snapshotPath, snapshot);
  await writeJsonAtomic(publicSnapshotPath, snapshot);
  await writeJsonAtomic(statusPath, { ok: true, updatedAt: snapshot.generatedAt, total: leads.length, rawTotal: db.leads?.length || 0, buildMs: snapshot.buildMs });
  return snapshot;
}

async function loop() {
  while (true) {
    try {
      const snapshot = await buildUiSnapshot();
      console.log(`[ui-snapshot] ok total=${snapshot.total} buildMs=${snapshot.buildMs}`);
    } catch (error) {
      console.error(`[ui-snapshot] ${error.stack || error.message}`);
      await writeJsonAtomic(statusPath, { ok: false, updatedAt: new Date().toISOString(), error: error.message });
    }
    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

loop().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
