import { readDb } from "./store.js";

const term = String(process.argv[2] || "").trim().toLowerCase();
if (!term) {
  console.error("Usage: node src/audit-leads.js <term>");
  process.exitCode = 1;
} else {
  const db = await readDb();
  const matches = (db.leads || []).filter((lead) => {
    const text = [
      lead.id,
      lead.name,
      lead.title,
      lead.url,
      lead.domain,
      lead.platform,
      lead.sourceBucket,
      lead.bestContact,
      ...(lead.emails || []),
      ...(lead.socialLinks || []),
      ...(lead.contactLinks || []),
      ...(lead.websiteLinks || []),
      ...(lead.relatedLinks || []),
      ...(lead.evidence || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(term);
  });

  console.log(JSON.stringify({
    ok: true,
    term,
    totalLeads: (db.leads || []).length,
    matches: matches.length,
    sample: matches.slice(0, 30).map((lead) => ({
      id: lead.id,
      name: lead.name,
      url: lead.url,
      platform: lead.platform,
      sourceBucket: lead.sourceBucket,
      bestContact: lead.bestContact || ""
    }))
  }, null, 2));
}
