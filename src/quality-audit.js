import { filterAndDedupeLeads, filterWorkingLeads, isExportQualified } from "./exporter.js";
import { sourceBucket } from "./mql5-limit.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { pickBestContact } from "./platform-enrichment.js";
import { readDb } from "./store.js";

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item) || "unknown";
    out[key] = (out[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function hasPlatformContact(lead = {}) {
  return (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
}

function hasRealDecisionContact(lead = {}) {
  const cleaned = { ...stripPlatformOwnedContacts(lead), ...pickBestContact(stripPlatformOwnedContacts(lead)) };
  return Boolean(cleaned.bestContact) || filterDecisionMakerEmails(cleaned).length > 0 || (cleaned.contactLinks || []).length > 0 || (cleaned.decisionMakers || []).length > 0 || (cleaned.decisionMakerLinks || []).length > 0;
}

const db = await readDb();
const leads = db.leads || [];
const qualified = filterAndDedupeLeads(leads);
const working = filterWorkingLeads(leads);
const exportQualified = leads.filter(isExportQualified);
const platformContactLeaks = leads.filter(hasPlatformContact);
const highValueNoContact = leads
  .filter((lead) => Number(lead.commercialScore || lead.score || 0) >= 75 || lead.priority === "A")
  .filter((lead) => !hasRealDecisionContact(lead))
  .slice(0, 25)
  .map((lead) => ({ name: lead.name || lead.title || lead.url, url: lead.url, bucket: sourceBucket(lead), score: lead.commercialScore || lead.score || 0, bestContact: lead.bestContact || "" }));

const report = {
  ok: true,
  totals: {
    raw: leads.length,
    exportQualified: exportQualified.length,
    qualified: qualified.length,
    working: working.length,
    platformContactLeaks: platformContactLeaks.length,
    highValueNoContact: highValueNoContact.length
  },
  byBucket: countBy(leads, sourceBucket),
  qualifiedByBucket: countBy(qualified, sourceBucket),
  workingByBucket: countBy(working, sourceBucket),
  contactLeakSamples: platformContactLeaks.slice(0, 15).map((lead) => ({ name: lead.name || lead.title || lead.url, url: lead.url, bestContact: lead.bestContact || "", emails: lead.emails || [] })),
  highValueNoContact
};

console.log(JSON.stringify(report, null, 2));
