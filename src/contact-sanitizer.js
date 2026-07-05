import { exportLeads } from "./exporter.js";
import { cleanDecisionContactLinks, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { filterDecisionMakerEmails, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

function cleanArray(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function sanitizeLead(lead = {}) {
  const stripped = stripPlatformOwnedContacts(lead);
  const decisionLinks = cleanDecisionContactLinks([...(stripped.contactLinks || []), ...(stripped.socialLinks || [])]);
  const contactLinks = cleanArray([...(stripped.contactLinks || [])]).filter((url) => !isPlatformProfileUrl(url));
  const socialLinks = cleanArray([...(stripped.socialLinks || [])]).filter((url) => !isPlatformProfileUrl(url) || decisionLinks.includes(url));
  const websiteLinks = cleanArray([...(stripped.websiteLinks || [])]).filter((url) => !isPlatformProfileUrl(url));
  const cleaned = {
    ...stripped,
    emails: filterDecisionMakerEmails(stripped),
    contactLinks,
    socialLinks,
    websiteLinks
  };
  return { ...cleaned, ...pickBestContact(cleaned) };
}

function changedBeforeAfter(before = {}, after = {}) {
  return JSON.stringify({
    emails: before.emails || [],
    bestContact: before.bestContact || "",
    bestContactType: before.bestContactType || "",
    contactLinks: before.contactLinks || [],
    socialLinks: before.socialLinks || [],
    websiteLinks: before.websiteLinks || []
  }) !== JSON.stringify({
    emails: after.emails || [],
    bestContact: after.bestContact || "",
    bestContactType: after.bestContactType || "",
    contactLinks: after.contactLinks || [],
    socialLinks: after.socialLinks || [],
    websiteLinks: after.websiteLinks || []
  });
}

export async function sanitizePlatformContacts(options = {}) {
  const db = await readDb();
  const leads = db.leads || [];
  let changed = 0;
  const nextLeads = leads.map((lead) => {
    const cleaned = sanitizeLead(lead);
    if (!changedBeforeAfter(lead, cleaned)) return lead;
    changed += 1;
    return { ...cleaned, contactSanitizedAt: nowIso() };
  });

  if (changed && !options.dryRun) {
    await writeDb({
      ...db,
      leads: nextLeads,
      contactSanitizerHistory: [
        { at: nowIso(), changed, total: leads.length },
        ...(db.contactSanitizerHistory || [])
      ].slice(0, 50)
    });
    await exportLeads({
      csvName: "autopilot-qualified-leads.csv",
      jsonName: "autopilot-qualified-leads.json",
      contactCsvName: "autopilot-qualified-contactable-leads.csv",
      contactJsonName: "autopilot-qualified-contactable-leads.json",
      hotCsvName: "autopilot-hot-leads.csv",
      hotJsonName: "autopilot-hot-leads.json"
    });
  }

  return { ok: true, changed, total: leads.length, dryRun: Boolean(options.dryRun) };
}

if (process.argv[1]?.endsWith("contact-sanitizer.js")) {
  const dryRun = process.argv.includes("--dryRun=true") || process.argv.includes("--dry-run");
  sanitizePlatformContacts({ dryRun })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
