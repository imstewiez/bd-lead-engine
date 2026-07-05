import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { sourceBucket } from "./mql5-limit.js";
import { domainOf, platformFromUrl } from "./utils.js";

function leadText(lead = {}) {
  return [
    lead.name,
    lead.title,
    lead.snippet,
    lead.url,
    lead.domain,
    lead.platform,
    lead.segment,
    lead.leadType,
    lead.bestContact,
    ...(lead.evidence || []),
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.websiteLinks || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function parsedUrl(lead = {}) {
  try {
    return new URL(lead.url || "");
  } catch {
    return null;
  }
}

function pathParts(lead = {}) {
  return (parsedUrl(lead)?.pathname || "").split("/").filter(Boolean).map((part) => part.toLowerCase());
}

function hasValidatedContact(lead = {}) {
  return Boolean(
    lead.bestContact ||
    cleanEmails(lead.emails || []).length ||
    cleanForms(lead.forms || []).length ||
    hasDirectOutboundPath(lead) ||
    (lead.decisionMakers || []).length ||
    (lead.decisionMakerLinks || []).length
  );
}

function hasDirectProfileUrl(lead = {}) {
  const url = String(lead.url || "").toLowerCase();
  return /linkedin\.com\/(?:in|company)\/[^/]+|instagram\.com\/(?!p\/|reel\/|reels\/|stories\/|explore\/)[a-z0-9_.-]+\/?$|(?:x\.com|twitter\.com)\/(?!i\/|share\/|intent\/|search\/|home\/?$)[a-z0-9_]+\/?$|(?:t\.me|telegram\.me)\/[a-z0-9_]+\/?$|mql5\.com\/en\/(?:users|signals)\/|myfxbook\.com\/members\/|fxblue\.com\/users\/|tradingview\.com\/u\//i.test(url);
}

function isForumSourcePage(lead = {}) {
  const domain = domainOf(lead.url || "");
  const parts = pathParts(lead);
  const url = String(lead.url || "").toLowerCase();
  const text = leadText(lead);

  if (/earnforex\.com\/forum\/tags\//i.test(url)) return true;
  if (/forum\.forex\/(?:forums|tags|whats-new|search)\b/i.test(url)) return true;
  if (/forexfactory\.com\/(?:forum|forums|calendar|news|market|scanner)\b/i.test(url)) return true;
  if (/forexpeacearmy\.com\/community\/(?:forums|tags|search)\b/i.test(url)) return true;
  if ((domain.includes("forum") || /forexfactory|earnforex|forexpeacearmy/.test(domain)) && /\b(?:tag|tags|category|categories|forum index|search results)\b/i.test(text)) return true;
  if (parts.includes("thread") || /\/thread\/|forexfactory\.com\/thread\//i.test(url)) return true;
  return false;
}

function isEventSourcePage(lead = {}) {
  const text = leadText(lead);
  const url = String(lead.url || "").toLowerCase();
  if (/linkedin\.com\/(?:in|company)\//i.test(url)) return false;
  return /\b(?:expo|summit|event|conference|past-events|agenda|sponsor|sponsors|exhibitor|exhibitors|attending)\b/i.test(`${text} ${url}`);
}

function isDirectoryOrIndexPage(lead = {}) {
  const text = leadText(lead);
  const url = String(lead.url || "").toLowerCase();
  return /\b(?:directory|directories|members list|member list|top traders|rankings?|leaderboard|tagged|tags|category|categories|search results|past-events|all signals|signals list|portfolio list|profiles list)\b/i.test(`${text} ${url}`) && !hasDirectProfileUrl(lead);
}

function isCompanyOrPersonLead(lead = {}) {
  const text = leadText(lead);
  const segment = String(lead.segment || "");
  if (hasDirectProfileUrl(lead)) return true;
  if (hasValidatedContact(lead) && /\b(?:founder|owner|ceo|director|head|manager|partner|introducing broker|fund manager|portfolio manager|asset manager|mentor|academy|community|signals|prop firm|funded trader|trader|affiliate)\b/i.test(text)) return true;
  if (["IB / Partner", "Affiliate", "Trading Education", "Community", "Creator / Influencer", "Prop / Funded Trading", "Fund / Asset Manager", "High-Calibre Trader"].includes(segment) && hasValidatedContact(lead)) return true;
  return false;
}

export function classifyLeadEntity(lead = {}) {
  const bucket = sourceBucket(lead);
  const platform = lead.platform || platformFromUrl(lead.url || "") || "Web";

  if (isForumSourcePage(lead)) {
    return { kind: "research_source", label: "Research source", reason: "forum_thread_or_index", bucket, platform };
  }

  if (isEventSourcePage(lead)) {
    return { kind: "research_source", label: "Research source", reason: "event_or_sponsor_page", bucket, platform };
  }

  if (isDirectoryOrIndexPage(lead)) {
    return { kind: "research_source", label: "Research source", reason: "directory_or_index_page", bucket, platform };
  }

  if (["forum", "ecosystem"].includes(bucket) && !hasValidatedContact(lead)) {
    return { kind: "research_source", label: "Research source", reason: "source_bucket_without_validated_contact", bucket, platform };
  }

  if (isCompanyOrPersonLead(lead)) {
    return { kind: "actual_lead", label: "Actual lead", reason: "direct_profile_or_validated_contact", bucket, platform };
  }

  return { kind: "actual_lead", label: "Actual lead", reason: "default_contactable_or_profile_candidate", bucket, platform };
}

export function isActualLead(lead = {}) {
  return classifyLeadEntity(lead).kind === "actual_lead";
}

export function isResearchSource(lead = {}) {
  return classifyLeadEntity(lead).kind === "research_source";
}
