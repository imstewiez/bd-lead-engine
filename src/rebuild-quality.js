import { classifyResult } from "./classify.js";
import { exportLeads } from "./exporter.js";
import { pickBestContact } from "./platform-enrichment.js";
import { isPlatformOwnedEmail, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

function changedBeforeAfter(before = {}, after = {}) {
  return JSON.stringify({ emails: before.emails || [], bestContact: before.bestContact || "", bestContactType: before.bestContactType || "" }) !== JSON.stringify({ emails: after.emails || [], bestContact: after.bestContact || "", bestContactType: after.bestContactType || "" });
}

const db = await readDb();
let platformContactsRemoved = 0;
let reclassified = 0;
const samples = [];

db.leads = (db.leads || []).map((lead) => {
  const hadPlatformContact = (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
  const cleaned = stripPlatformOwnedContacts(lead);
  const repicked = { ...cleaned, ...pickBestContact(cleaned) };
  const classified = classifyResult(repicked, repicked.sourceIntent || repicked.leadType || "partner");
  const next = { ...classified, qualityRebuiltAt: nowIso() };
  if (hadPlatformContact || changedBeforeAfter(lead, next)) {
    platformContactsRemoved += Number(hadPlatformContact);
    reclassified += 1;
    if (samples.length < 8) samples.push({ name: lead.name || lead.title || lead.url, before: lead.bestContact || "", after: next.bestContact || "" });
  }
  return next;
});

db.qualityRebuildHistory = [{ at: nowIso(), platformContactsRemoved, reclassified, samples }, ...(db.qualityRebuildHistory || [])].slice(0, 20);
await writeDb(db);
const exported = await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });

console.log(JSON.stringify({ ok: true, rootDir: getRootDir(), total: db.leads.length, platformContactsRemoved, reclassified, exported, samples }, null, 2));
