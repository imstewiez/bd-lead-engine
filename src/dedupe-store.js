import { readDb, writeDb } from "./store.js";
import { domainOf, nowIso } from "./utils.js";

function normalize(value = "") {
  return String(value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[#?].*$/, "").replace(/\/$/, "").trim();
}

function handleFromUrl(url = "") {
  const cleaned = normalize(url);
  const parts = cleaned.split("/").filter(Boolean);
  if (!parts.length) return "";
  const host = parts[0];
  const tail = parts.slice(1).join("/");
  if (/linkedin\.com/.test(host)) return tail.replace(/^in\//, "linkedin:").replace(/^company\//, "linkedin-company:");
  if (/instagram\.com/.test(host)) return `instagram:${parts[1] || ""}`;
  if (/(^|\.)x\.com|twitter\.com/.test(host)) return `x:${parts[1] || ""}`;
  if (/myfxbook\.com/.test(host)) return `myfxbook:${tail}`;
  if (/mql5\.com/.test(host)) return `mql5:${tail}`;
  return "";
}

function entityKey(lead = {}) {
  const email = (lead.emails || []).find(Boolean);
  if (email && /@/.test(email)) return `email-domain:${String(email).split("@").pop().toLowerCase()}`;
  const website = (lead.websiteLinks || []).find(Boolean) || lead.domain || "";
  const websiteDomain = website ? domainOf(website) : "";
  if (websiteDomain && !/linkedin|instagram|facebook|twitter|x\.com|mql5|myfxbook|telegram|t\.me/.test(websiteDomain)) return `domain:${websiteDomain}`;
  const urls = [lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])].filter(Boolean);
  for (const url of urls) {
    const handle = handleFromUrl(url);
    if (handle && handle.length > 4) return `handle:${handle}`;
  }
  const name = String(lead.name || lead.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const country = String(lead.country || "").toLowerCase();
  return name ? `name:${name}:${country}` : `id:${lead.id || Math.random()}`;
}

function uniqueArray(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function mergeLead(a = {}, b = {}) {
  const keepAStage = a.stage && a.stage !== "new";
  const better = Number(b.score || 0) > Number(a.score || 0) ? b : a;
  return {
    ...a,
    ...b,
    name: better.name || a.name || b.name,
    title: better.title || a.title || b.title,
    snippet: better.snippet || a.snippet || b.snippet,
    score: Math.max(Number(a.score || 0), Number(b.score || 0)),
    commercialScore: Math.max(Number(a.commercialScore || 0), Number(b.commercialScore || 0)),
    contactConfidence: Math.max(Number(a.contactConfidence || 0), Number(b.contactConfidence || 0)),
    stage: keepAStage ? a.stage : (b.stage || a.stage || "new"),
    notes: a.notes || b.notes || "",
    emails: uniqueArray([...(a.emails || []), ...(b.emails || [])]),
    socialLinks: uniqueArray([...(a.socialLinks || []), ...(b.socialLinks || [])]),
    contactLinks: uniqueArray([...(a.contactLinks || []), ...(b.contactLinks || [])]),
    websiteLinks: uniqueArray([...(a.websiteLinks || []), ...(b.websiteLinks || [])]),
    phoneNumbers: uniqueArray([...(a.phoneNumbers || []), ...(b.phoneNumbers || [])]),
    evidence: uniqueArray([...(a.evidence || []), ...(b.evidence || [])]),
    runIds: uniqueArray([...(a.runIds || []), ...(b.runIds || [])]),
    forms: [...(a.forms || []), ...(b.forms || [])].filter((form, index, all) => index === all.findIndex((item) => JSON.stringify(item) === JSON.stringify(form))),
    duplicateIds: uniqueArray([...(a.duplicateIds || []), a.id, ...(b.duplicateIds || []), b.id].filter((id) => id && id !== a.id)),
    entityKey: a.entityKey || b.entityKey || entityKey(a),
    firstSeen: [a.firstSeen, b.firstSeen].filter(Boolean).sort()[0] || nowIso(),
    lastSeen: [a.lastSeen, b.lastSeen].filter(Boolean).sort().pop() || nowIso(),
    updatedAt: nowIso()
  };
}

export async function dedupeStore() {
  const db = await readDb();
  const byKey = new Map();
  let duplicates = 0;
  for (const lead of db.leads || []) {
    const key = entityKey(lead);
    const normalized = { ...lead, entityKey: key };
    if (!byKey.has(key)) {
      byKey.set(key, normalized);
      continue;
    }
    duplicates += 1;
    byKey.set(key, mergeLead(byKey.get(key), normalized));
  }
  db.leads = [...byKey.values()];
  db.dedupe = { updatedAt: nowIso(), duplicatesRemoved: duplicates, total: db.leads.length };
  await writeDb(db);
  return db.dedupe;
}

dedupeStore().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
