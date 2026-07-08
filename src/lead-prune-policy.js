import { cleanForms, cleanLinks, cleanPhoneNumbers } from "./contact-cleaner.js";
import { leadRejectionReasons, rawLeadText, visibleLeadText } from "./lead-quality.js";
import { sourceBucket } from "./mql5-limit.js";
import { isBlockedCommercialLead } from "./noise-policy.js";
import { filterDecisionMakerEmails, isPlatformOwnedEmail, isPlatformOwnedUrl, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { cleanDecisionContactLinks, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { domainOf, normalizeWhitespace } from "./utils.js";

const HARD_INFRA_DOMAINS = [
  "help.instagram.com",
  "help.twitter.com",
  "help.x.com",
  "help.linkedin.com",
  "help.facebook.com",
  "gateway.discord.gg",
  "storage.live.com",
  "livechat.com",
  "intercom.io",
  "zendesk.com",
  "freshdesk.com"
];

const HARD_CONTENT_NOISE_DOMAINS = [
  "kaskus.co.id",
  "rankia.pt",
  "cursa.app",
  "mam.paris.fr",
  "goldbod.gov.gh"
];

const SYNTHETIC_SEARCH_SNIPPET = /(?:qwant|extracted)\s+(?:web result|candidate|url)\s+(?:for|from)/i;
const WEAK_IDENTITY = /^(?:platform|trader|forex trader|copy trading|signals?|instagram|linkedin|facebook|twitter|x|tiktok|telegram|gateway\.discord\.gg|help\.instagram\.com)$/i;
const PLACEHOLDER_EMAIL_DOMAIN = /@(text|company|example|domain|email)\.(?:com|org|net)$/i;
const STRICT_VISIBLE_ICP = /\b(?:forex|fx trading|fx trader|forex trading|forex trader|cfd|cfds|xauusd|gold trader|metatrader|mt4|mt5|copy trading|copytrading|forex signals?|signal provider|pamm|mam|introducing broker|forex ib|ib partner|forex affiliate|trading academy|forex academy|trading community|prop firm|funded trader|broker partnership|broker regulado|looking for broker|recommend broker|which broker)\b/i;

function scoreOf(lead = {}) {
  return Number(lead.commercialScore || lead.score || 0);
}

function nameOf(lead = {}) {
  return normalizeWhitespace(lead.companyName || lead.name || lead.title || "");
}

function domainMatches(domain = "", domains = []) {
  return domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

export function cleanLeadContacts(lead = {}) {
  const stripped = stripPlatformOwnedContacts(lead);
  const best = pickBestContact(stripped);
  const prepared = { ...stripped, ...best };
  const emails = filterDecisionMakerEmails(prepared);
  const phoneNumbers = cleanPhoneNumbers(prepared.phoneNumbers || []);
  const forms = cleanForms(prepared.forms || []).filter((form) => !isPlatformOwnedUrl(form.pageUrl || form.action || "", prepared));
  const contactLinks = cleanDecisionContactLinks(prepared.contactLinks || []);
  const socialLinks = cleanDecisionContactLinks(prepared.socialLinks || []);
  const websiteLinks = cleanLinks(prepared.websiteLinks || [], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => !isPlatformProfileUrl(url) && !isPlatformOwnedUrl(url, prepared));
  const bestContactIsPlatform = prepared.bestContact && (isPlatformProfileUrl(prepared.bestContact) || isPlatformOwnedUrl(prepared.bestContact, prepared));
  const bestContactIsEmailLeak = prepared.bestContactType === "email" && isPlatformOwnedEmail(prepared.bestContact, prepared);

  const cleaned = {
    ...prepared,
    emails,
    phoneNumbers,
    forms,
    contactLinks,
    socialLinks,
    websiteLinks,
    bestContact: bestContactIsPlatform || bestContactIsEmailLeak ? "" : prepared.bestContact || "",
    bestContactType: bestContactIsPlatform || bestContactIsEmailLeak ? "" : prepared.bestContactType || "",
    bestContactSource: bestContactIsPlatform || bestContactIsEmailLeak ? "" : prepared.bestContactSource || ""
  };

  if (!cleaned.bestContact) Object.assign(cleaned, pickBestContact(cleaned));
  return cleaned;
}

export function hasRealDecisionContact(lead = {}) {
  const cleaned = cleanLeadContacts(lead);
  if ((cleaned.emails || []).length) return true;
  if ((cleaned.phoneNumbers || []).length) return true;
  if ((cleaned.forms || []).length) return true;
  if ((cleaned.contactLinks || []).some((url) => !isPlatformOwnedUrl(url, cleaned) && !isPlatformProfileUrl(url))) return true;
  if (cleaned.bestContact && cleaned.bestContactType && cleaned.bestContactType !== "website") return true;
  return false;
}

export function pruneReasons(lead = {}) {
  const reasons = [];
  const cleaned = cleanLeadContacts(lead);
  const domain = domainOf(cleaned.url || cleaned.domain || "");
  const score = scoreOf(cleaned);
  const bucket = sourceBucket(cleaned);
  const visible = visibleLeadText(cleaned);
  const raw = rawLeadText(cleaned);
  const name = nameOf(cleaned);
  const hardReasons = leadRejectionReasons(cleaned);
  const realContact = hasRealDecisionContact(cleaned);

  if (hardReasons.length) reasons.push(...hardReasons.map((reason) => `hard reject: ${reason}`));
  if (isBlockedCommercialLead(cleaned)) reasons.push("commercial noise policy");
  if (domainMatches(domain, HARD_INFRA_DOMAINS)) reasons.push("platform/help/widget/infra domain");
  if (domainMatches(domain, HARD_CONTENT_NOISE_DOMAINS) && !STRICT_VISIBLE_ICP.test(visible)) reasons.push("known non-lead/content/government domain");
  if (SYNTHETIC_SEARCH_SNIPPET.test(cleaned.snippet || "") && score >= 60) reasons.push("synthetic search snippet inflated lead");
  if (WEAK_IDENTITY.test(name) && score >= 75) reasons.push("weak/generic identity with high score");
  if ((cleaned.emails || lead.emails || []).some((email) => PLACEHOLDER_EMAIL_DOMAIN.test(email) || isPlatformOwnedEmail(email, cleaned))) reasons.push("placeholder/platform email contamination");
  if (cleaned.bestContact && (isPlatformOwnedUrl(cleaned.bestContact, cleaned) || isPlatformProfileUrl(cleaned.bestContact))) reasons.push("best contact is platform-owned URL");
  if (score >= 75 && !realContact) reasons.push("high-score lead without real decision contact");
  if (["forum", "reddit", "web"].includes(bucket) && score >= 70 && !realContact) reasons.push("content/community lead without contact route");
  if (bucket === "discord" && score >= 65 && !realContact) reasons.push("discord/community lead without contact route");
  if (["linkedin", "instagram", "tiktok", "x", "facebook"].includes(bucket) && SYNTHETIC_SEARCH_SNIPPET.test(cleaned.snippet || "")) reasons.push("query-driven social result");
  if (["fxblue", "zulutrade", "specialist"].includes(bucket) && !realContact && /fxblue|zulutrade/i.test(cleaned.url || "")) reasons.push("platform strategy profile without owned contact route");
  if (domain === "youtube.com" || domain.endsWith(".youtube.com")) {
    if (!realContact) reasons.push("YouTube lead without contact route");
    if (!STRICT_VISIBLE_ICP.test(`${name} ${visible}`) || (cleaned.emails || []).some((email) => isPlatformOwnedEmail(email, cleaned))) reasons.push("weak/contaminated YouTube lead");
  }
  if (!STRICT_VISIBLE_ICP.test(visible) && score >= 85 && !/mql5\.com\/en\/users\/[^/]+\/seller/i.test(cleaned.url || "")) reasons.push("high score without visible ICP evidence");
  if (!raw || raw.length < 18) reasons.push("insufficient lead evidence text");

  return [...new Set(reasons)];
}

export function shouldPruneLead(lead = {}) {
  return pruneReasons(lead).length > 0;
}
