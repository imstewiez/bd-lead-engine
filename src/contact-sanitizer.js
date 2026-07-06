import { exportLeads } from "./exporter.js";
import { cleanDecisionContactLinks, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { filterDecisionForms, filterDecisionMakerEmails, filterDecisionUrls, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

function cleanArray(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function recalibrateContactQuality(lead = {}) {
  const best = pickBestContact(lead);
  const type = best.bestContactType || "";
  const confidenceByType = {
    whatsapp: 96,
    email: 94,
    phone: 90,
    form: 86,
    "direct-link": 82,
    social: 74,
    website: 45
  };
  const fallbackConfidence = (lead.contactLinks || []).length ? 65 : (lead.websiteLinks || []).length ? 45 : 15;
  return {
    ...best,
    contactQuality: type || ((lead.contactLinks || []).length ? "contact-page" : (lead.websiteLinks || []).length ? "website" : "no-contact-yet"),
    contactConfidence: confidenceByType[type] || fallbackConfidence
  };
}

function sanitizeLead(lead = {}) {
  const stripped = stripPlatformOwnedContacts(lead);
  const decisionLinks = cleanDecisionContactLinks([...(stripped.contactLinks || []), ...(stripped.socialLinks || [])]);
  const contactLinks = filterDecisionUrls(cleanArray([...(stripped.contactLinks || [])]), stripped).filter((url) => !isPlatformProfileUrl(url));
  const socialLinks = filterDecisionUrls(cleanArray([...(stripped.socialLinks || [])]), stripped).filter((url) => !isPlatformProfileUrl(url) || decisionLinks.includes(url));
  const websiteLinks = filterDecisionUrls(cleanArray([...(stripped.websiteLinks || [])]), stripped).filter((url) => !isPlatformProfileUrl(url));
  const forms = filterDecisionForms({ ...stripped, contactLinks, socialLinks, websiteLinks });
  const cleaned = {
    ...stripped,
    emails: filterDecisionMakerEmails(stripped),
    forms,
    contactLinks,
    socialLinks,
    websiteLinks
  };
  return { ...cleaned, ...recalibrateContactQuality(cleaned) };
}

function changedBeforeAfter(before = {}, after = {}) {
  return JSON.stringify({
    emails: before.emails || [],
    forms: before.forms || [],
    bestContact: before.bestContact || "",
    bestContactType: before.bestContactType || "",
    contactConfidence: before.contactConfidence || 0,
    contactQuality: before.contactQuality || "",
    contactLinks: before.contactLinks || [],
    socialLinks: before.socialLinks || [],
    websiteLinks: before.websiteLinks || []
  }) !== JSON.stringify({
    emails: after.emails || [],
    forms: after.forms || [],
    bestContact: after.bestContact || "",
    bestContactType: after.bestContactType || "",
    contactConfidence: after.contactConfidence || 0,
    contactQuality: after.contactQuality || "",
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
        { at: nowIso(), changed, total: leads.length, policy: "platform-contact-contamination-v2" },
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
