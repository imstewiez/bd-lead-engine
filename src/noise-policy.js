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
    ...(lead.evidence || [])
  ].filter(Boolean).join(" "));
}

function domainIsProp(domain = "") {
  return [...PROP_DOMAINS].some((item) => domain === item || domain.endsWith(`.${item}`));
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
  if (isPropFirmLead(lead)) return true;
  if (["review_or_seo", "job_posting", "directory_or_registry", "broker_page"].includes(lead.entityType)) return true;
  if (REVIEW_OR_SEO_PATTERN.test(text) && !/\b(?:contact|whatsapp|telegram|affiliate manager|head of partnerships|business development|introducing broker|IB partner|forex affiliate)\b/i.test(text)) return true;
  return false;
}

export function isBlockedCommercialQuery(query = "") {
  const text = String(query || "").toLowerCase();
  if (/\b(?:prop firm|proprietary trading|funded trader|funded trading|funded account|evaluation account|trading challenge|instant funding|futures funding|forex funding)\b/i.test(text)) return true;
  if (PROP_NAME_PATTERN.test(text)) return true;
  if (/\b(?:best|top|review|reviews|compare|comparison|ranking|rankings|coupon|discount|promo code)\b/i.test(text)) return true;
  return false;
}
