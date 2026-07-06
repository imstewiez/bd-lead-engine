import { domainOf, normalizeWhitespace } from "./utils.js";

const PROP_DOMAINS = new Set([
  "onefunded.com",
  "ftmo.com",
  "fundednext.com",
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
]);

const PROP_NAME_PATTERN = /\b(?:onefunded|fundednext|ftmo|the5ers|fxify|topstep|apex trader funding|take profit trader|my funded futures|funded trading plus|the funded trader|alpha capital group|e8 markets|blueberry funded|brightfunded|funding pips|the trading pit|funderpro|city traders imperium|lux trading firm|surgetrader|traddoo|instant funding|goat funded trader|maven trading|my forex funds)\b/i;
const PROP_CATEGORY_PATTERN = /\b(?:prop firm|proprietary trading firm|funded trader|funded trading|funded account|evaluation account|trading challenge|challenge rules|instant funding|futures funding|forex funding)\b/i;
const REVIEW_OR_SEO_PATTERN = /\b(?:best|top|compare|comparison|ranking|ranked|review|reviews|coupon|discount|promo code|scam|complaint|alternatives|guide)\b/i;
const STRONG_TARGET_PATTERN = /\b(?:forex|fx trader|fx trading|forex trader|forex trading|foreign exchange|currency trading|cfd|cfds|xauusd|gold trader|metatrader|mt4|mt5|copy trading|copytrading|signals?|sinais|senales|señales|pamm|mam|introducing broker|ib partner|forex ib|forex affiliate|affiliate forex|cpa forex|revenue share|revshare|broker partnership|broker partner|trading academy|forex academy|trading community|whatsapp|telegram)\b/i;
const GENERIC_SOCIAL_NOISE_PATTERN = /\b(?:profiles?|people named|facebook profiles?|posts x|dashboard|login|sign in|examplefx blue statistics|forex factory$|company murenamobile|zooe\b|lilo org\b|videoestados unidos|exploring portugal)\b/i;
const GENERIC_PAGE_PATTERN = /\b(?:home page|homepage|dashboard|login|sign in|pricing|terms and conditions|privacy policy|cookie policy|support center|help center|download app|google play|app store)\b/i;
const BROKER_SITE_PATTERN = /\b(?:broker site|open account|client portal|deposit|withdrawal|spreads from|trade online|regulated broker|brokerage services)\b/i;

function leadText(lead = {}) {
  return normalizeWhitespace([
    lead.name,
    lead.companyName,
    lead.title,
    lead.snippet,
    lead.description,
    lead.pageTitle,
    lead.pageDescription,
    lead.pageText,
    lead.url,
    lead.domain,
    lead.segment,
    lead.entityType,
    lead.platform,
    ...(lead.evidence || [])
  ].filter(Boolean).join(" "));
}

function domainIsProp(domain = "") {
  return [...PROP_DOMAINS].some((item) => domain === item || domain.endsWith(`.${item}`));
}

function hasTargetSignal(lead = {}) {
  return STRONG_TARGET_PATTERN.test(leadText(lead));
}

export function isPropFirmLead(lead = {}) {
  const domain = domainOf(lead.url || lead.domain || "");
  const text = leadText(lead);
  if (domainIsProp(domain)) return true;
  if (lead.entityType === "prop_firm_company") return true;
  if (PROP_NAME_PATTERN.test(text)) return true;
  if (PROP_CATEGORY_PATTERN.test(text) && !/\b(?:affiliate manager|head of partnerships|business development|introducing broker|IB partner|CPA affiliate|forex affiliate|revenue share)\b/i.test(text)) return true;
  return false;
}

export function isBlockedCommercialLead(lead = {}) {
  const text = leadText(lead);
  const score = Number(lead.commercialScore || lead.score || 0);
  if (isPropFirmLead(lead)) return true;
  if (["review_or_seo", "job_posting", "directory_or_registry", "broker_page"].includes(lead.entityType)) return true;
  if (lead.segment === "Broker Site" || BROKER_SITE_PATTERN.test(text)) return true;
  if (GENERIC_SOCIAL_NOISE_PATTERN.test(text) && !hasTargetSignal(lead)) return true;
  if (GENERIC_PAGE_PATTERN.test(text) && score < 72 && !hasTargetSignal(lead)) return true;
  if (REVIEW_OR_SEO_PATTERN.test(text) && !/\b(?:contact|whatsapp|telegram|affiliate manager|head of partnerships|business development|introducing broker|IB partner|forex affiliate)\b/i.test(text)) return true;
  if (score < 45 && !hasTargetSignal(lead)) return true;
  return false;
}

export function isBlockedCommercialQuery(query = "") {
  const text = String(query || "").toLowerCase();
  if (/\b(?:prop firm|proprietary trading|funded trader|funded trading|funded account|evaluation account|trading challenge|instant funding|futures funding|forex funding)\b/i.test(text)) return true;
  if (PROP_NAME_PATTERN.test(text)) return true;
  if (/\b(?:best|top|review|reviews|compare|comparison|ranking|rankings|coupon|discount|promo code)\b/i.test(text)) return true;
  return false;
}
