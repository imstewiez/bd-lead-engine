import fs from "node:fs/promises";
import path from "node:path";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { enhanceCommercialLead } from "./commercial-intelligence.js";
import { exportLeads } from "./exporter.js";
import { leadRejectionReasons } from "./lead-quality.js";
import { sourceBucket } from "./mql5-limit.js";
import { isBlockedCommercialLead } from "./noise-policy.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "leads.json");
const KNOWN_CURRENCY_EXCHANGE_DOMAINS = ["forex.se", "forex.no", "forex.fi", "forexvaluta.dk"];
const KNOWN_GENERIC_FALSE_POSITIVE_DOMAINS = ["kitco.com", "mambaby.com", "partnershiphp.org", "tipranks.com", "tradersunion.com", "latammediareport.com"];

function stamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function leadText(lead = {}) { return [lead.name, lead.companyName, lead.title, lead.snippet, lead.url, lead.domain, lead.platform, lead.sourceIntent, lead.segment, lead.leadType, lead.entityType, ...(lead.evidence || []), ...(lead.websiteLinks || []), ...(lead.socialLinks || []), ...(lead.contactLinks || []), ...(lead.relatedLinks || [])].filter(Boolean).join(" ").toLowerCase(); }
function hasContact(lead = {}) { return Boolean(lead.bestContact || cleanEmails(lead.emails || []).length || cleanForms(lead.forms || []).length || hasDirectOutboundPath(lead)); }
function isProtectedLead(lead = {}) { if (lead.manualKeep === true) return true; if (String(lead.notes || "").trim()) return true; const stage = String(lead.stage || "new").toLowerCase(); return !["", "new", "research", "rejected"].includes(stage); }
function domainFromLead(lead = {}) { try { return new URL(lead.url || "").hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(lead.domain || "").replace(/^www\./, "").toLowerCase(); } }
function pathFromLead(lead = {}) { try { return new URL(lead.url || "").pathname.replace(/\/$/, "").toLowerCase(); } catch { return ""; } }
function domainIn(domain, list) { return list.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`)); }
function isKnownCurrencyExchangeLead(lead = {}) { return domainIn(domainFromLead(lead), KNOWN_CURRENCY_EXCHANGE_DOMAINS); }
function isKnownGenericFalsePositive(lead = {}) { const domain = domainFromLead(lead); const pathValue = pathFromLead(lead); if (domainIn(domain, KNOWN_GENERIC_FALSE_POSITIVE_DOMAINS)) return true; if (/^(?:[a-z]{2}\.)?tradingview\.com$/.test(domain) && (!pathValue || pathValue === "")) return true; if (/^(?:www\.)?tradingview\.com$/.test(domain) && /^\/(?:markets|chart|symbols)(?:\/|$)/.test(pathValue)) return true; return false; }
function isGenericArticleOrPressLead(lead = {}) { const text = leadText(lead); const url = String(lead.url || "").toLowerCase(); if (/press release|newswire|latammediareport\.com\/article/.test(text)) return true; if (/tradersunion\.com\/.*(?:interesting-articles|top-\d+|top\d+|best-forex|forex-educators|forex-mentors)/.test(url)) return true; if (/\btop\s*\d+\s+forex\b|\bbest\s+forex\s+(?:educators|mentors|brokers|signals)\b/.test(text)) return true; return false; }

function hardNoiseReason(rawLead = {}) {
  const lead = enhanceCommercialLead(rawLead);
  const text = leadText(lead);
  const url = String(lead.url || "").toLowerCase();
  const bucket = sourceBucket(lead);

  if (isBlockedCommercialLead(lead)) return "commercial_noise_policy";
  if (isKnownCurrencyExchangeLead(lead)) return "known_currency_exchange_false_positive";
  if (isKnownGenericFalsePositive(lead)) return "known_generic_false_positive";
  if (isGenericArticleOrPressLead(lead)) return "generic_article_or_press_release";
  if (/cache\.aspx/.test(url)) return "generic_cache_page";
  if (/tradingview\.com\/(?:chart|markets|symbols)|\/chart\/?$/.test(url)) return "tradingview_chart_or_market_page";
  if (/\bt\.me\/telegram\b|\btelegram\.org\b|^view @telegram\b/.test(text)) return "official_telegram_page";
  if (/youtube\.com|youtu\.be|facebook\.com\/public|gateway\.discord\.gg|discadia\.com/.test(url) && !/\b(?:forex|xauusd|gold|signals?|telegram|whatsapp|ib partner|introducing broker|affiliate)\b/.test(text)) return "generic_social_or_directory_page";
  if (/\b(?:posts x|instagram photos and videos|dashboard|login|sign in|examplefx blue statistics|jobs careers|careershfm|forex factory$)\b/.test(text)) return "generic_platform_page";
  if (/world health summit|microsoft store|google play|apps no google play|xbox|ko-fi shop|support trading with charm/.test(text)) return "non_financial_platform_noise";
  if (/oxfordlearnersdictionaries|merriam-webster|cambridge\.org\/dictionary|collinsdictionary|vocabulary\.com|thesaurus\.com|wikipedia\.org|investopedia\.com/.test(text)) return "reference_content_page";
  if (/forexfactory\.com\/(?:calendar|news|market|scanner)/.test(url)) return "forexfactory_generic_tool_page";
  if (/\bforex factory\b/.test(text) && !/forexfactory\.com\/thread|forexfactory\.com\/member|introducing broker|affiliate|partnership|telegram|whatsapp|contact/.test(text)) return "forexfactory_generic_page";
  if (/mql5\.com\/en\/market\b|mql5 market/.test(text) && !/mql5\.com\/en\/users|mql5\.com\/en\/signals|contact|telegram|whatsapp/.test(text)) return "mql5_market_generic_page";
  if (/tradingview/.test(bucket) && !hasContact(lead) && !/tradingview\.com\/u\//.test(url)) return "tradingview_source_only_noise";

  const hardReasons = leadRejectionReasons(lead).filter((reason) => reason !== "missing strict forex/CFD/trading ICP signal");
  const pruneableReason = hardReasons.find((reason) => /official broker|generic article|generic explainer|reference|ranking|review|job listing|careers|third-party tooling|payments|money-transfer|bank|insurance|non-trading|consumer|sports|government|media|broker site/i.test(reason));
  if (pruneableReason) return `hard_rejected:${pruneableReason}`;
  if (String(lead.deepStatus || "").toLowerCase() === "rejected" && hardReasons.length && !hasContact(lead)) return `rejected:${hardReasons[0]}`;
  return "";
}

export function shouldPruneLead(lead = {}) {
  if (isProtectedLead(lead)) return { prune: false, reason: "protected_manual_work" };
  const reason = hardNoiseReason(lead);
  return reason ? { prune: true, reason } : { prune: false, reason: "keep" };
}

export async function pruneRejectedLeads(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const limit = Math.max(1, Number(options.limit || 5000));
  const db = await readDb();
  const leads = db.leads || [];
  const removed = [];
  const kept = [];
  for (const lead of leads) {
    const decision = shouldPruneLead(lead);
    if (decision.prune && removed.length < limit) removed.push({ lead, reason: decision.reason });
    else kept.push(lead);
  }
  const byReason = removed.reduce((acc, item) => { acc[item.reason] = (acc[item.reason] || 0) + 1; return acc; }, {});
  let backupPath = null;
  let exported = null;
  if (removed.length && !dryRun) {
    await fs.mkdir(dataDir, { recursive: true });
    backupPath = path.join(dataDir, `leads.prune-backup-${stamp()}.json`);
    await fs.copyFile(dbPath, backupPath).catch(() => {});
    await writeDb({ ...db, leads: kept, pruneHistory: [{ at: nowIso(), reason: options.reason || "manual", removed: removed.length, before: leads.length, after: kept.length, byReason, backupPath }, ...(db.pruneHistory || [])].slice(0, 50) });
    exported = await exportLeads({ csvName: "autopilot-qualified-leads.csv", jsonName: "autopilot-qualified-leads.json", contactCsvName: "autopilot-qualified-contactable-leads.csv", contactJsonName: "autopilot-qualified-contactable-leads.json", hotCsvName: "autopilot-hot-leads.csv", hotJsonName: "autopilot-hot-leads.json" });
  }
  return { ok: true, dryRun, before: leads.length, removed: removed.length, after: dryRun ? leads.length : kept.length, backupPath, byReason, sample: removed.slice(0, 20).map(({ lead, reason }) => ({ id: lead.id, name: lead.name, url: lead.url, reason })), exported };
}

if (process.argv[1]?.endsWith("lead-pruner.js")) {
  const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
  pruneRejectedLeads({ dryRun: args.get("dryRun") === "true", limit: Number(args.get("limit") || 5000), reason: "cli" }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}
