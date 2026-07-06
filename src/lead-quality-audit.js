import fs from "node:fs/promises";
import path from "node:path";
import { cleanEmails, cleanForms, cleanLinks, cleanPhoneNumbers, isUsefulDirectContactUrl } from "./contact-cleaner.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, isPlatformOwnedUrl, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { cleanDecisionContactLinks, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { sourceBucket } from "./mql5-limit.js";
import { getRootDir, readDb } from "./store.js";
import { domainOf, normalizeWhitespace, nowIso } from "./utils.js";

const rootDir = getRootDir();
const reportDir = path.join(rootDir, "ops-reports");

const SCORE_REVIEW_THRESHOLD = Number(process.argv.find((arg) => arg.startsWith("--minScore="))?.split("=")[1] || 75);
const OUTPUT_LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 25);
const JSON_ONLY = process.argv.includes("--json");

const PLACEHOLDER_EMAIL_DOMAINS = new Set(["text.com", "company.com", "example.com", "example.org", "example.net", "email.com", "domain.com"]);
const GENERIC_EMAIL_LOCAL = /^(?:support|help|info|contact|sales|partner|partners|affiliate|affiliates|hello|team|admin|privacy|legal|service|customerservice|customer\.service|john|jane|demo|test|example|accounts|billing|finance)(?:[+._-].*)?$/i;
const ACTUAL_ICP_TERMS = /\b(?:forex|fx\b|cfd|cfds|xauusd|gold trader|trading academy|forex academy|copy trading|signal provider|signals?|pamm|mam|fund manager|portfolio manager|money manager|asset manager|introducing broker|\bib\b|forex affiliate|affiliate program|broker partnership|trading community|prop firm|funded trader|funded trading|metatrader|mt4|mt5|trading educator|trading mentor|broker-seeking|looking for broker|recommend broker|which broker|traders fair|money expo|ifx expo|finance magnates)\b/i;
const SYNTHETIC_SNIPPET = /(?:qwant|extracted)\s+(?:web result|candidate|url)\s+(?:for|from)/i;
const GENERIC_TITLE = /^(?:platform|instagram|linkedin|facebook|twitter|x|tiktok|telegram|trader|forex trader|copy trading|signals?|company\s+[a-z0-9_.-]+)$/i;

function scoreOf(lead = {}) {
  return Number(lead.commercialScore || lead.score || 0);
}

function leadName(lead = {}) {
  return normalizeWhitespace(lead.companyName || lead.name || lead.title || lead.url || "unknown");
}

function cleanUrl(url = "") {
  return String(url || "").replace(/\/$/, "").toLowerCase();
}

function urlKey(lead = {}) {
  return cleanUrl(lead.url || "") || `${domainOf(lead.domain || "")}::${leadName(lead).toLowerCase()}`;
}

function publicText(lead = {}) {
  // Excludes sourceQuery by design. This should reflect only the result/profile/page itself.
  return normalizeWhitespace([
    lead.name,
    lead.companyName,
    lead.title,
    lead.snippet,
    lead.description,
    lead.pageTitle,
    lead.pageDescription,
    lead.pageText,
    lead.url,
    lead.domain,
    ...(lead.evidence || [])
  ].filter(Boolean).join(" "));
}

function identityText(lead = {}) {
  return normalizeWhitespace([
    lead.name,
    lead.companyName,
    lead.title,
    lead.url,
    lead.domain
  ].filter(Boolean).join(" "));
}

function hasActualIcpSignal(lead = {}) {
  return ACTUAL_ICP_TERMS.test(publicText(lead));
}

function placeholderEmails(lead = {}) {
  return cleanEmails(lead.emails || []).filter((email) => {
    const [local = "", domain = ""] = email.toLowerCase().split("@");
    return PLACEHOLDER_EMAIL_DOMAINS.has(domain) || GENERIC_EMAIL_LOCAL.test(local);
  });
}

function decisionParts(lead = {}) {
  const cleaned = stripPlatformOwnedContacts(lead);
  const best = pickBestContact(cleaned);
  const prepared = { ...cleaned, ...best };
  const emails = filterDecisionMakerEmails(prepared);
  const phones = cleanPhoneNumbers(prepared.phoneNumbers || []);
  const forms = cleanForms(prepared.forms || []);
  const direct = cleanDecisionContactLinks([prepared.bestContact, ...(prepared.contactLinks || []), ...(prepared.socialLinks || [])]);
  const websites = cleanLinks(prepared.websiteLinks || [], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => !isPlatformProfileUrl(url) && !isPlatformOwnedUrl(url, prepared));
  const bestIsReal = Boolean(prepared.bestContact && prepared.bestContactType !== "website" && !isPlatformProfileUrl(prepared.bestContact) && !isPlatformOwnedUrl(prepared.bestContact, prepared));
  return { prepared, emails, phones, forms, direct, websites, bestIsReal };
}

function hasRealDecisionContact(lead = {}) {
  const parts = decisionParts(lead);
  return parts.emails.length > 0 || parts.phones.length > 0 || parts.forms.length > 0 || parts.direct.length > 0 || parts.bestIsReal;
}

function contactScore(lead = {}) {
  const parts = decisionParts(lead);
  let score = 0;
  if (parts.direct.some((url) => /wa\.me|whatsapp/i.test(url))) score += 40;
  if (parts.direct.some((url) => /t\.me|telegram/i.test(url))) score += 35;
  if (parts.emails.length) score += 30;
  if (parts.phones.length) score += 25;
  if (parts.forms.length) score += 18;
  if (parts.websites.length) score += 5;
  if ((lead.decisionMakers || []).length || (lead.decisionMakerLinks || []).length) score += 15;
  if (parts.bestIsReal) score += 20;
  return score;
}

function suspiciousReasons(lead = {}) {
  const reasons = [];
  const score = scoreOf(lead);
  const parts = decisionParts(lead);
  const text = publicText(lead);
  const idText = identityText(lead);
  const bucket = sourceBucket(lead);
  const placeholders = placeholderEmails(lead);

  if (placeholders.length) reasons.push(`placeholder/generic emails: ${placeholders.join(", ")}`);
  if ((lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead))) reasons.push("platform-owned email still present");
  if (lead.bestContact && isPlatformProfileUrl(lead.bestContact)) reasons.push("bestContact is the source/platform profile");
  if (lead.bestContact && isPlatformOwnedUrl(lead.bestContact, lead)) reasons.push("bestContact is platform/widget/infra-owned URL");
  if (score >= SCORE_REVIEW_THRESHOLD && !hasRealDecisionContact(lead)) reasons.push("high-score lead without real decision contact");
  if (score >= SCORE_REVIEW_THRESHOLD && !hasActualIcpSignal(lead)) reasons.push("high-score lead without actual ICP terms in result/profile text");
  if (score >= SCORE_REVIEW_THRESHOLD && SYNTHETIC_SNIPPET.test(lead.snippet || "")) reasons.push("score likely inflated by synthetic search snippet");
  if (score >= SCORE_REVIEW_THRESHOLD && GENERIC_TITLE.test(leadName(lead))) reasons.push("generic or weak identity/title");
  if (["linkedin", "instagram", "tiktok", "x", "facebook"].includes(bucket) && score >= SCORE_REVIEW_THRESHOLD && !ACTUAL_ICP_TERMS.test(idText) && !ACTUAL_ICP_TERMS.test(text.replace(String(lead.sourceQuery || ""), ""))) reasons.push("social profile appears query-driven, not profile-driven");
  if (["mql5", "myfxbook", "fxblue", "zulutrade", "specialist"].includes(bucket) && contactScore(lead) < 45 && score >= SCORE_REVIEW_THRESHOLD) reasons.push("specialist/platform lead has weak contact score");
  if ((lead.contactLinks || []).some((url) => isPlatformOwnedUrl(url, lead)) || (lead.socialLinks || []).some((url) => isPlatformOwnedUrl(url, lead))) reasons.push("platform-owned links still attached");
  if (parts.websites.length && !parts.bestIsReal && !parts.emails.length && !parts.phones.length && !parts.forms.length && !parts.direct.length) reasons.push("website-only route, not execution-ready");

  return [...new Set(reasons)];
}

function sampleLead(lead = {}, reasons = suspiciousReasons(lead)) {
  const parts = decisionParts(lead);
  return {
    id: lead.id,
    name: leadName(lead),
    url: lead.url || "",
    bucket: sourceBucket(lead),
    score: scoreOf(lead),
    priority: lead.priority || lead.commercialTier || "",
    contactScore: contactScore(lead),
    contactConfidence: Number(lead.contactConfidence || 0),
    bestContact: parts.prepared.bestContact || lead.bestContact || "",
    bestContactType: parts.prepared.bestContactType || lead.bestContactType || "",
    reasons
  };
}

function groupByReason(suspects = []) {
  const out = {};
  for (const item of suspects) {
    for (const reason of item.reasons) out[reason] = (out[reason] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function duplicateGroups(leads = []) {
  const map = new Map();
  for (const lead of leads) {
    const key = lead.companyKey || urlKey(lead);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(lead);
  }
  return [...map.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, count: items.length, samples: items.slice(0, 5).map((lead) => sampleLead(lead, [])) }))
    .sort((a, b) => b.count - a.count);
}

function markdown(report) {
  const lines = [];
  lines.push("# BD Lead Engine — Lead Quality Audit");
  lines.push("");
  lines.push(`Updated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Totals");
  lines.push(`Raw leads: ${report.totals.raw}`);
  lines.push(`Suspicious leads: ${report.totals.suspicious}`);
  lines.push(`High-score no real contact: ${report.totals.highScoreNoRealContact}`);
  lines.push(`Query/synthetic-signal suspects: ${report.totals.syntheticSignalSuspects}`);
  lines.push(`Placeholder/platform contact suspects: ${report.totals.contactContaminationSuspects}`);
  lines.push(`Duplicate groups: ${report.totals.duplicateGroups}`);
  lines.push("");
  lines.push("## Reasons");
  for (const [reason, count] of Object.entries(report.reasonCounts)) lines.push(`- ${count} × ${reason}`);
  lines.push("");
  lines.push("## Top suspicious leads");
  for (const lead of report.samples.suspicious.slice(0, OUTPUT_LIMIT)) {
    lines.push(`- ${lead.bucket}: ${lead.name} | score=${lead.score} | contactScore=${lead.contactScore} | ${lead.url}`);
    for (const reason of lead.reasons.slice(0, 4)) lines.push(`  - ${reason}`);
  }
  lines.push("");
  lines.push("## Duplicate groups");
  for (const group of report.samples.duplicates.slice(0, 15)) {
    lines.push(`- ${group.count} × ${group.key}`);
    for (const lead of group.samples.slice(0, 3)) lines.push(`  - ${lead.name} | ${lead.url}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const db = await readDb();
const leads = db.leads || [];
const suspects = leads
  .map((lead) => ({ lead, reasons: suspiciousReasons(lead) }))
  .filter((item) => item.reasons.length)
  .sort((a, b) => scoreOf(b.lead) - scoreOf(a.lead) || b.reasons.length - a.reasons.length)
  .map((item) => sampleLead(item.lead, item.reasons));
const duplicates = duplicateGroups(leads);
const report = {
  ok: true,
  generatedAt: nowIso(),
  thresholds: { scoreReviewThreshold: SCORE_REVIEW_THRESHOLD },
  totals: {
    raw: leads.length,
    suspicious: suspects.length,
    highScoreNoRealContact: suspects.filter((lead) => lead.reasons.includes("high-score lead without real decision contact")).length,
    syntheticSignalSuspects: suspects.filter((lead) => lead.reasons.some((reason) => /synthetic|query-driven|actual ICP/.test(reason))).length,
    contactContaminationSuspects: suspects.filter((lead) => lead.reasons.some((reason) => /placeholder|platform-owned|widget|infra/.test(reason))).length,
    duplicateGroups: duplicates.length
  },
  reasonCounts: groupByReason(suspects),
  samples: {
    suspicious: suspects.slice(0, OUTPUT_LIMIT),
    duplicates: duplicates.slice(0, 25)
  }
};

await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, "latest-lead-quality-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(reportDir, "latest-lead-quality-audit.md"), markdown(report), "utf8");

if (JSON_ONLY) console.log(JSON.stringify(report, null, 2));
else {
  console.log(markdown(report));
  console.log(`Wrote ops-reports/latest-lead-quality-audit.json and .md`);
}
