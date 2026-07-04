import dns from "node:dns/promises";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { sourceBucket } from "./mql5-limit.js";

const mxCache = new Map();
const BAD_EMAIL_PARTS = /noreply|no-reply|donotreply|example|test|privacy|abuse|support$/i;
const PARTNER_EMAIL_PARTS = /partner|partners|affiliate|affiliates|ib|business|bd|sales|commercial|contact|info|hello|team/i;

function safeUrl(value = "") {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function rootDomain(value = "") {
  const parsed = safeUrl(value) || safeUrl(`https://${String(value).replace(/^@/, "")}`);
  if (!parsed) return String(value || "").replace(/^www\./, "").toLowerCase();
  return parsed.hostname.replace(/^www\./, "").toLowerCase();
}

function profileHandle(url = "") {
  const parsed = safeUrl(url);
  if (!parsed) return "";
  const domain = rootDomain(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (!parts.length) return "";
  if (domain.includes("linkedin.com") && parts.length >= 2) return `${parts[0]}/${parts[1]}`.toLowerCase();
  return parts[0].toLowerCase();
}

export function entityKeyForLead(lead = {}) {
  const emails = cleanEmails(lead.emails || []);
  if (emails.length) {
    const emailDomain = emails[0].split("@")[1];
    if (emailDomain) return `domain:${emailDomain.toLowerCase()}`;
  }
  const website = (lead.websiteLinks || []).map(rootDomain).find(Boolean);
  if (website) return `domain:${website}`;
  const urlDomain = rootDomain(lead.url || lead.domain || "");
  const handle = profileHandle(lead.url || "");
  if (urlDomain && handle) return `profile:${urlDomain}/${handle}`;
  if (urlDomain) return `domain:${urlDomain}`;
  return `name:${String(lead.name || lead.title || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function commercialScoreForLead(lead = {}) {
  let score = 0;
  const bucket = sourceBucket(lead);
  const emails = cleanEmails(lead.emails || []);
  const forms = cleanForms(lead.forms || []);
  if (lead.leadType === "partner") score += 25;
  if (lead.leadType === "institution") score += 22;
  if (lead.leadType === "recruitment") score += 14;
  if (["linkedin", "instagram", "x", "telegram", "myfxbook", "tradingview"].includes(bucket)) score += 18;
  if (emails.length) score += 20;
  if (forms.length) score += 12;
  if (hasDirectOutboundPath(lead)) score += 12;
  if ((lead.decisionMakers || []).length) score += 12;
  if (/latam|brazil|brasil|mexico|colombia|chile|peru|portugal|spain|espanha/i.test(`${lead.country} ${lead.snippet} ${lead.name}`)) score += 8;
  score += Math.min(25, Number(lead.score || 0) / 4);
  if (bucket === "mql5") score -= 8;
  if (lead.priority === "A") score += 10;
  if (lead.priority === "D") score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function mergeLeadCluster(leads = []) {
  const scored = leads.map((lead) => ({ ...lead, commercialScore: commercialScoreForLead(lead) }));
  const sorted = scored.sort((a, b) => Number(b.commercialScore || 0) - Number(a.commercialScore || 0) || Number(b.score || 0) - Number(a.score || 0));
  const primary = sorted[0] || {};
  const allUrls = unique(sorted.flatMap((lead) => [lead.url, ...(lead.socialLinks || []), ...(lead.websiteLinks || []), ...(lead.contactLinks || []), ...(lead.relatedLinks || [])]));
  const emails = unique(sorted.flatMap((lead) => cleanEmails(lead.emails || [])));
  const phones = unique(sorted.flatMap((lead) => lead.phoneNumbers || []));
  const forms = sorted.flatMap((lead) => cleanForms(lead.forms || []));
  const sources = unique(sorted.map(sourceBucket));
  const evidence = unique(sorted.flatMap((lead) => lead.evidence || [])).slice(0, 20);
  const score = Math.max(...sorted.map((lead) => Number(lead.score || 0)), 0);
  const commercialScore = Math.max(...sorted.map((lead) => Number(lead.commercialScore || 0)), 0);
  return {
    id: entityKeyForLead(primary),
    name: primary.name || primary.title || "Unknown lead",
    primaryUrl: primary.url,
    leadIds: sorted.map((lead) => lead.id).filter(Boolean),
    sources,
    urls: allUrls,
    emails,
    phones,
    forms,
    evidence,
    country: primary.country || sorted.find((lead) => lead.country)?.country || "Unknown",
    segment: primary.segment || "Unclear",
    leadType: primary.leadType || "research",
    priority: primary.priority || "C",
    score,
    commercialScore,
    contactConfidence: Math.max(...sorted.map((lead) => Number(lead.contactConfidence || 0)), 0),
    lastSeen: sorted.map((lead) => lead.lastSeen).filter(Boolean).sort().pop() || "",
    rawCount: sorted.length
  };
}

export function clusterLeads(leads = []) {
  const groups = new Map();
  for (const lead of leads) {
    const key = entityKeyForLead(lead);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lead);
  }
  return [...groups.values()].map(mergeLeadCluster).sort((a, b) => Number(b.commercialScore || 0) - Number(a.commercialScore || 0) || Number(b.score || 0) - Number(a.score || 0));
}

export async function hasMx(domain = "") {
  const clean = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (!clean || !clean.includes(".")) return false;
  if (mxCache.has(clean)) return mxCache.get(clean);
  try {
    const mx = await dns.resolveMx(clean);
    const ok = Array.isArray(mx) && mx.length > 0;
    mxCache.set(clean, ok);
    return ok;
  } catch {
    mxCache.set(clean, false);
    return false;
  }
}

export async function emailQuality(email = "", lead = {}) {
  const value = String(email || "").trim().toLowerCase();
  const [, domain = ""] = value.split("@");
  const local = value.split("@")[0] || "";
  const mx = await hasMx(domain);
  let score = 30;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) score += 20;
  if (mx) score += 25;
  if (PARTNER_EMAIL_PARTS.test(local)) score += 15;
  if (BAD_EMAIL_PARTS.test(local)) score -= 25;
  if (rootDomain(lead.url || lead.domain || "") === domain) score += 10;
  return { email: value, domain, mx, score: Math.max(0, Math.min(100, score)) };
}

export function rankLeadsCommercially(leads = []) {
  return [...leads]
    .map((lead) => ({ ...lead, commercialScore: commercialScoreForLead(lead), sourceBucket: lead.sourceBucket || sourceBucket(lead), entityKey: entityKeyForLead(lead) }))
    .sort((a, b) => Number(b.commercialScore || 0) - Number(a.commercialScore || 0) || Number(b.score || 0) - Number(a.score || 0));
}

export async function enrichLeadIntelligence(lead = {}) {
  const emails = cleanEmails(lead.emails || []);
  const emailQualityChecks = [];
  for (const email of emails.slice(0, 5)) emailQualityChecks.push(await emailQuality(email, lead));
  return { ...lead, sourceBucket: lead.sourceBucket || sourceBucket(lead), commercialScore: commercialScoreForLead(lead), entityKey: entityKeyForLead(lead), emailQualityChecks };
}
