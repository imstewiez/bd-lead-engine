import { cap, domainOf, normalizeWhitespace, titleFromUrl, unique } from "./utils.js";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";

const REVIEW_DOMAINS = [
  "comparebrokers.org",
  "brokerchooser.com",
  "forexbrokers.com",
  "bestbrokers.com",
  "compareforexbrokers.com",
  "brokersview.com",
  "topbrokers.com",
  "investingintheweb.com",
  "fx-list.com",
  "daytrading.com",
  "wikifx.com",
  "propfirmmatch.com",
  "propfirmreviews.com",
  "propfirmjournal.com",
  "forexpropreviews.com",
  "prop-trading-firm.com",
  "bestpropfirms.com",
  "tradersunion.com",
  "investing.com",
  "investopedia.com",
  "fxstreet.com",
  "businessinsider.com",
  "forbes.com"
];

const OFFICIAL_PROP_DOMAINS = [
  "ftmo.com",
  "fundednext.com",
  "onefunded.com",
  "the5ers.com",
  "fxify.com",
  "topstep.com",
  "apextraderfunding.com",
  "takeprofittrader.com",
  "myfundedfutures.com",
  "fundedtradingplus.com",
  "thefundedtraderprogram.com",
  "fundedtraderprogram.com",
  "alpha-capital-group.com",
  "alphacapitalgroup.uk",
  "e8markets.com",
  "blueberryfunded.com",
  "brightfunded.com",
  "fundingpips.com",
  "thetradingpit.com",
  "funderpro.com",
  "citytradersimperium.com",
  "luxtradingfirm.com",
  "surgetrader.com",
  "traddoo.com",
  "instantfunding.io",
  "goatfundedtrader.com",
  "maven-trading.com",
  "myforexfunds.com"
];

const COMPANY_SUFFIX_PATTERN = /\b(?:ltd|limited|llc|inc|corp|corporation|group|capital|markets|trading|technologies|technology|global|official|homepage|home|login|dashboard|review|reviews|ranking|rankings|best|top|compare|comparison)\b/gi;

const REVIEW_PATTERN = /\b(?:best|top|compare|comparison|ranking|ranked|review|reviews|vs\.?|versus|alternative|alternatives|coupon|coupons|discount|promo code|trustpilot|scam|complaint|complaints|pros and cons|guide|ultimate guide|list of|directory)\b/i;
const SEO_PATH_PATTERN = /\/(?:blog|learn|education|academy|articles?|news|reviews?|guides?|ranking|rankings|compare|comparison|best|top|coupon|promo|broker-reviews?|prop-firm-reviews?)(?:\/|$)/i;
const COMPANY_PATH_PATTERN = /\/(?:about|about-us|contact|contact-us|partners?|partnerships?|affiliates?|affiliate-program|introducing-broker|ib|careers|team|company)(?:\/|$)/i;
const CONTACT_PATTERN = /\b(?:contact|contacto|contato|email|whatsapp|wa\.me|telegram|t\.me|calendly|book a call|schedule a call|affiliate|partner|partnership|introducing broker|media kit|advertise|sponsor)\b/i;
const DECISION_MAKER_PATTERN = /\b(?:founder|co-founder|ceo|chief executive|owner|director|managing director|head of|vp|vice president|business development|partnerships?|affiliate manager|growth manager|commercial director|country manager|regional manager|community manager|marketing director)\b/i;
const PROP_COMPANY_PATTERN = /\b(?:prop firm|proprietary trading firm|funded trading|funded trader|trading challenge|evaluation account|funded account|futures funding|forex funding|funded futures|instant funding|challenge rules)\b/i;
const TRADING_ENTITY_PATTERN = /\b(?:forex|fx\b|cfd|cfds|xauusd|gold trader|mt4|mt5|metatrader|copy trading|signal provider|pamm|mam|forex affiliate|introducing broker|trading academy|forex academy|trading community|broker partnership|broker partner|fund manager|portfolio manager|money manager|asset manager|prop firm|funded trading|funded trader)\b/i;
const PLATFORM_PROFILE_PATTERN = /\b(?:linkedin\.com\/in|linkedin\.com\/company|instagram\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|t\.me|telegram|discord\.gg|linktr\.ee|beacons\.ai|myfxbook\.com|mql5\.com|fxblue\.com|zulutrade\.com|darwinex\.com|signalstart\.com)\b/i;
const JOB_PATTERN = /\b(?:job description|apply now|apply for this job|we are hiring|vacancy|career opportunity|submit your application|equal opportunity employer|remote job|salary range)\b/i;
const DIRECTORY_PATTERN = /\b(?:directory|companies list|company profile|business listing|yellow pages|opencorporates|companies house|registry)\b/i;
const BROKER_PAGE_PATTERN = /\b(?:open account|client portal|deposit|withdrawal|spreads from|trade online|regulated broker|brokerage services)\b/i;

function domainMatches(domain, domains) {
  return domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

function textForLead(lead = {}) {
  return normalizeWhitespace([
    lead.name,
    lead.title,
    lead.snippet,
    lead.description,
    lead.pageTitle,
    lead.pageDescription,
    lead.pageText,
    lead.url,
    lead.domain,
    lead.segment,
    lead.leadType,
    ...(lead.evidence || []),
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.websiteLinks || []),
    ...(lead.emails || []),
    ...(lead.phoneNumbers || [])
  ].filter(Boolean).join(" "));
}

function cleanCompanyName(value = "") {
  const cleaned = normalizeWhitespace(String(value || "")
    .replace(/\s+[|–—-]\s+.*$/g, "")
    .replace(/\b(?:official site|official website|homepage|home page|review|reviews|ranking|rankings|best|top|compare|comparison|coupon|promo code)\b/gi, "")
    .replace(COMPANY_SUFFIX_PATTERN, "")
    .replace(/[^\p{L}\p{N}&.' ]+/gu, " "));
  return normalizeWhitespace(cleaned).slice(0, 80);
}

function companyNameFromDomain(domain = "") {
  const parts = String(domain || "").replace(/^www\./, "").split(".");
  const base = parts.length > 2 && ["co", "com", "net", "org"].includes(parts.at(-2)) ? parts.at(-3) : parts[0];
  return normalizeWhitespace(String(base || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()));
}

function companyNameForLead(lead = {}, domain = "") {
  const fromTitle = cleanCompanyName(lead.name || lead.title || lead.pageTitle || "");
  if (fromTitle && fromTitle.length >= 3 && !REVIEW_PATTERN.test(fromTitle)) return fromTitle;
  return companyNameFromDomain(domain) || titleFromUrl(lead.url || "") || "Unknown company";
}

function companyKeyForLead(lead = {}, entityType = "") {
  const domain = domainOf(lead.url || lead.domain || "");
  const platform = String(lead.platform || "").toLowerCase();
  if (domain && !["linkedin.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "t.me", "telegram.me", "linktr.ee", "beacons.ai"].some((host) => domain === host || domain.endsWith(`.${host}`))) {
    return `domain:${domain}`;
  }
  try {
    const parsed = new URL(lead.url || "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (domain.includes("linkedin.com") && ["company", "in"].includes((parts[0] || "").toLowerCase()) && parts[1]) return `linkedin:${parts[0]}:${parts[1].toLowerCase()}`;
    if ((platform || domain) && parts[0]) return `profile:${domain}:${parts[0].replace(/^@/, "").toLowerCase()}`;
  } catch {}
  const name = cleanCompanyName(lead.name || lead.title || "").toLowerCase().replace(/\s+/g, "-");
  return name ? `name:${name}` : `url:${String(lead.url || "").replace(/\/$/, "").toLowerCase()}`;
}

export function classifyEntity(lead = {}) {
  const domain = domainOf(lead.url || lead.domain || "");
  const text = textForLead(lead);
  const lower = text.toLowerCase();
  const url = String(lead.url || "").toLowerCase();
  const officialProp = domainMatches(domain, OFFICIAL_PROP_DOMAINS);
  const reviewDomain = domainMatches(domain, REVIEW_DOMAINS);
  const hasContact = CONTACT_PATTERN.test(text) || cleanEmails(lead.emails || []).length > 0 || cleanForms(lead.forms || []).length > 0 || hasDirectOutboundPath(lead);
  const hasDecisionMaker = DECISION_MAKER_PATTERN.test(text);
  const hasTrading = TRADING_ENTITY_PATTERN.test(text) || officialProp;
  const hasProfile = PLATFORM_PROFILE_PATTERN.test(text);
  const hasCompanyPath = COMPANY_PATH_PATTERN.test(url);
  const looksReview = reviewDomain || (REVIEW_PATTERN.test(text) && !hasDecisionMaker && !hasContact) || SEO_PATH_PATTERN.test(url);
  const looksJob = JOB_PATTERN.test(text);
  const looksDirectory = DIRECTORY_PATTERN.test(text) && !hasDecisionMaker && !hasContact;
  const looksBrokerPage = BROKER_PAGE_PATTERN.test(text) && lead.segment === "Broker Site";

  let entityType = "research_candidate";
  if (looksJob) entityType = "job_posting";
  else if (looksReview) entityType = "review_or_seo";
  else if (looksDirectory) entityType = "directory_or_registry";
  else if (officialProp || PROP_COMPANY_PATTERN.test(text)) entityType = "prop_firm_company";
  else if (hasDecisionMaker && hasTrading) entityType = "decision_maker";
  else if (hasProfile && hasTrading) entityType = "social_profile";
  else if (lead.segment === "Fund / Asset Manager") entityType = "capital_allocator";
  else if (["Trading Education", "Community", "Creator / Influencer", "IB / Partner", "Affiliate"].includes(lead.segment)) entityType = "partner_entity";
  else if (hasTrading && (hasContact || hasCompanyPath)) entityType = "company";
  else if (looksBrokerPage) entityType = "broker_page";

  const reject = ["review_or_seo", "job_posting", "directory_or_registry", "broker_page"].includes(entityType);
  const companyName = companyNameForLead(lead, domain);
  const companyKey = companyKeyForLead(lead, entityType);

  return {
    entityType,
    entityReject: reject,
    entityRejectReason: reject ? entityType.replace(/_/g, " ") : "",
    companyName,
    companyKey,
    entitySignals: unique([
      officialProp ? "Official prop firm" : "",
      hasDecisionMaker ? "Decision maker" : "",
      hasContact ? "Contact path" : "",
      hasTrading ? "Trading ICP" : "",
      hasProfile ? "Public profile" : "",
      hasCompanyPath ? "Company/partner path" : ""
    ]),
    officialProp
  };
}

export function commercialScoreLead(lead = {}, entity = classifyEntity(lead)) {
  const emails = cleanEmails(lead.emails || []);
  const forms = cleanForms(lead.forms || []);
  const hasDirect = hasDirectOutboundPath(lead);
  const text = textForLead(lead);
  let score = 0;

  const typeBase = {
    prop_firm_company: 58,
    decision_maker: 64,
    partner_entity: 56,
    social_profile: 48,
    capital_allocator: 54,
    company: 50,
    research_candidate: 28,
    review_or_seo: 5,
    job_posting: 4,
    directory_or_registry: 10,
    broker_page: 8
  };
  score += typeBase[entity.entityType] ?? 20;
  score += Math.min(18, Number(lead.score || 0) * 0.18);
  score += emails.length ? 12 : 0;
  score += forms.length ? 8 : 0;
  score += hasDirect ? 10 : 0;
  score += Number(lead.contactConfidence || 0) >= 75 ? 10 : Number(lead.contactConfidence || 0) >= 50 ? 5 : 0;
  score += entity.entitySignals?.includes("Decision maker") ? 10 : 0;
  score += entity.entitySignals?.includes("Company/partner path") ? 8 : 0;
  score += /\b(?:affiliate|partner|partnership|introducing broker|ib program|revenue share|cpa|sponsor|media kit|advertise)\b/i.test(text) ? 12 : 0;
  score += /\b(?:whatsapp|telegram|calendly|book a call|contact us|contacto|contato)\b/i.test(text) ? 6 : 0;
  score += entity.officialProp ? 10 : 0;
  score -= entity.entityReject ? 45 : 0;
  score -= REVIEW_PATTERN.test(text) && !CONTACT_PATTERN.test(text) ? 20 : 0;
  score -= JOB_PATTERN.test(text) ? 30 : 0;

  return cap(Math.round(score), 0, 100);
}

export function commercialTier(score = 0) {
  if (score >= 82) return "A";
  if (score >= 66) return "B";
  if (score >= 48) return "C";
  return "D";
}

export function enhanceCommercialLead(lead = {}) {
  const entity = classifyEntity(lead);
  const commercialScore = commercialScoreLead(lead, entity);
  const commercialTierValue = commercialTier(commercialScore);
  const contactable = cleanEmails(lead.emails || []).length > 0 || cleanForms(lead.forms || []).length > 0 || hasDirectOutboundPath(lead);
  const qualified = !entity.entityReject && commercialScore >= 42;
  const qualityStatus = entity.entityReject ? "rejected" : qualified ? "qualified" : "manual_review";

  return {
    ...lead,
    ...entity,
    companyKey: entity.companyKey,
    companyName: entity.companyName,
    commercialScore,
    commercialTier: commercialTierValue,
    contactable,
    qualityStatus,
    qualificationStatus: qualityStatus === "rejected" ? "rejected" : lead.qualificationStatus,
    priority: commercialTierValue,
    evidence: unique([...(lead.evidence || []), ...(entity.entitySignals || [])]).slice(0, 10)
  };
}

export function isCommerciallyRejected(lead = {}) {
  const enriched = lead.commercialScore == null || !lead.entityType ? enhanceCommercialLead(lead) : lead;
  return enriched.qualityStatus === "rejected" || Number(enriched.commercialScore || 0) < 28;
}

export function mergeLeadAssets(base = {}, incoming = {}) {
  return {
    ...base,
    ...incoming,
    name: incoming.companyName || base.companyName || incoming.name || base.name,
    title: incoming.title || base.title,
    snippet: incoming.snippet && String(incoming.snippet).length > String(base.snippet || "").length ? incoming.snippet : base.snippet || incoming.snippet,
    emails: unique([...(base.emails || []), ...(incoming.emails || [])]),
    socialLinks: unique([...(base.socialLinks || []), ...(incoming.socialLinks || [])]),
    contactLinks: unique([...(base.contactLinks || []), ...(incoming.contactLinks || [])]),
    websiteLinks: unique([...(base.websiteLinks || []), ...(incoming.websiteLinks || [])]),
    phoneNumbers: unique([...(base.phoneNumbers || []), ...(incoming.phoneNumbers || [])]),
    forms: [...(base.forms || []), ...(incoming.forms || [])].slice(0, 12),
    evidence: unique([...(base.evidence || []), ...(incoming.evidence || [])]).slice(0, 16),
    assetUrls: unique([...(base.assetUrls || []), base.url, incoming.url, ...(incoming.websiteLinks || []), ...(incoming.contactLinks || []), ...(incoming.socialLinks || [])]).slice(0, 30),
    sourceQueries: unique([...(base.sourceQueries || []), base.sourceQuery, incoming.sourceQuery]).slice(0, 12),
    score: Math.max(Number(base.score || 0), Number(incoming.score || 0)),
    commercialScore: Math.max(Number(base.commercialScore || 0), Number(incoming.commercialScore || 0)),
    commercialTier: commercialTier(Math.max(Number(base.commercialScore || 0), Number(incoming.commercialScore || 0)))
  };
}
