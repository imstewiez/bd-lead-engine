import { sourceBucket } from "./mql5-limit.js";
import { isPlatformOwnedEmail } from "./platform-contact-policy.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso } from "./utils.js";

function needsBoost(lead = {}) {
  const bucket = sourceBucket(lead);
  const specialist = ["mql5", "myfxbook", "specialist"].includes(bucket) || /zulutrade|fxblue|darwinex|signalstart|collective2/i.test(`${lead.platform || ""} ${lead.url || ""}`);
  if (!specialist) return false;
  const platformEmail = (lead.emails || []).some((email) => isPlatformOwnedEmail(email, lead)) || (lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead));
  const weakContact = !lead.bestContact || platformEmail || Number(lead.contactConfidence || 0) < 80;
  const highValue = Number(lead.commercialScore || lead.score || 0) >= 65 || lead.priority === "A";
  return weakContact && highValue;
}

const db = await readDb();
let boosted = 0;
const samples = [];
const now = nowIso();

db.leads = (db.leads || []).map((lead) => {
  if (!needsBoost(lead)) return lead;
  boosted += 1;
  if (samples.length < 12) samples.push({ name: lead.name || lead.title || lead.url, url: lead.url, bestContact: lead.bestContact || "" });
  return {
    ...lead,
    smartTrailDoneAt: "",
    lastDeepEnrichedAt: "",
    deepStatus: "",
    smartTrailBoostedAt: now
  };
});

db.smartTrailBoostHistory = [{ at: now, boosted, samples }, ...(db.smartTrailBoostHistory || [])].slice(0, 20);
await writeDb(db);
console.log(JSON.stringify({ ok: true, rootDir: getRootDir(), boosted, samples }, null, 2));
