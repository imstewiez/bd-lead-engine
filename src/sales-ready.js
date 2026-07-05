import fs from "node:fs/promises";
import path from "node:path";
import { cleanEmails, cleanForms, cleanLinks, cleanPhoneNumbers, isUsefulDirectContactUrl } from "./contact-cleaner.js";
import { filterAndDedupeLeads, filterWorkingLeads, isExportQualified } from "./exporter.js";
import { sourceBucket } from "./mql5-limit.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { pickBestContact } from "./platform-enrichment.js";
import { getRootDir, readDb } from "./store.js";
import { toCsvCell } from "./utils.js";

const rootDir = getRootDir();

function contactScore(lead = {}) {
  const cleaned = { ...stripPlatformOwnedContacts(lead), ...pickBestContact(stripPlatformOwnedContacts(lead)) };
  const emails = filterDecisionMakerEmails(cleaned);
  const direct = cleanLinks([...(cleaned.contactLinks || []), ...(cleaned.socialLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter(isUsefulDirectContactUrl);
  const forms = cleanForms(cleaned.forms || []);
  const phones = cleanPhoneNumbers(cleaned.phoneNumbers || []);
  let score = 0;
  if (direct.some((url) => /wa\.me|whatsapp/i.test(url))) score += 40;
  if (direct.some((url) => /t\.me|telegram/i.test(url))) score += 35;
  if (emails.length) score += 30;
  if (phones.length) score += 25;
  if (forms.length) score += 18;
  if ((cleaned.websiteLinks || []).length) score += 10;
  if ((cleaned.decisionMakers || []).length || (cleaned.decisionMakerLinks || []).length) score += 20;
  if (cleaned.bestContact) score += 20;
  return { score, cleaned };
}

export function isSalesReadyLead(lead = {}) {
  if (!isExportQualified(lead)) return false;
  const { score, cleaned } = contactScore(lead);
  const hasPlatformEmail = (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
  if (hasPlatformEmail && !cleaned.bestContact) return false;
  const bucket = sourceBucket(lead);
  if (["mql5", "myfxbook", "specialist"].includes(bucket) && score < 55) return false;
  if (score < 45) return false;
  return true;
}

function serialize(lead = {}) {
  const { score, cleaned } = contactScore(lead);
  const cols = [
    cleaned.commercialScore || cleaned.score || "",
    score,
    cleaned.priority || "",
    sourceBucket(cleaned),
    cleaned.bestContact || "",
    cleaned.bestContactType || "",
    cleaned.bestContactSource || "",
    cleaned.name || cleaned.title || "",
    cleaned.url || "",
    filterDecisionMakerEmails(cleaned),
    cleanPhoneNumbers(cleaned.phoneNumbers || []),
    cleanLinks(cleaned.contactLinks || [], { allowYouTubeChannels: false, allowShorteners: true }),
    cleanLinks(cleaned.socialLinks || [], { allowYouTubeChannels: false, allowShorteners: true }),
    cleanLinks(cleaned.websiteLinks || [], { allowYouTubeChannels: false, allowShorteners: true }),
    cleaned.decisionMakers || [],
    cleaned.relatedLinks || [],
    cleaned.snippet || ""
  ];
  return cols.map(toCsvCell).join(",");
}

const db = await readDb();
const all = db.leads || [];
const qualified = filterAndDedupeLeads(all);
const working = filterWorkingLeads(all);
const salesReady = qualified.filter(isSalesReadyLead).sort((a, b) => contactScore(b).score - contactScore(a).score || Number(b.commercialScore || b.score || 0) - Number(a.commercialScore || a.score || 0));
const header = ["commercialScore", "contactScore", "priority", "sourceBucket", "bestContact", "bestContactType", "bestContactSource", "name", "url", "emails", "phoneNumbers", "contactLinks", "socialLinks", "websiteLinks", "decisionMakers", "relatedLinks", "snippet"];
await fs.writeFile(path.join(rootDir, "autopilot-sales-ready-leads.csv"), `${header.join(",")}\n${salesReady.map(serialize).join("\n")}\n`, "utf8");
await fs.writeFile(path.join(rootDir, "autopilot-sales-ready-leads.json"), `${JSON.stringify(salesReady.map((lead) => contactScore(lead).cleaned), null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, total: all.length, qualified: qualified.length, working: working.length, salesReady: salesReady.length, csv: "autopilot-sales-ready-leads.csv", json: "autopilot-sales-ready-leads.json" }, null, 2));
