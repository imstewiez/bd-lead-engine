import { cleanEmails, cleanForms } from "./contact-cleaner.js";
import { domainOf, normalizeWhitespace, safeUrl } from "./utils.js";

const PLATFORM_DOMAINS = [
  "myfxbook.com",
  "mql5.com",
  "tradingview.com",
  "fxblue.com",
  "fxbluelabs.com",
  "zulutrade.com",
  "darwinex.com",
  "signalstart.com",
  "collective2.com",
  "forexfactory.com",
  "babypips.com"
];

const GENERIC_LOCALS = /^(?:support|help|info|contact|sales|partner|partners|affiliate|affiliates|hello|team|admin|privacy|legal|service|customerservice|customer\.service|john|jane|demo|test|example|accounts|account|billing|finance|payments|marketing|press|media)(?:[+._-].*)?$/i;
const GENERIC_EMAIL_DOMAINS = new Set(["text.com", "company.com", "example.com", "example.org", "example.net", "email.com", "domain.com"]);
const FREEMAIL_DOMAINS = new Set(["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com", "live.com"]);
const PLATFORM_BRAND_HANDLES = new Set([
  "zulutrade",
  "appstore",
  "myfxbook",
  "mql5",
  "fxblue",
  "darwinex",
  "signalstart",
  "collective2",
  "forexfactory",
  "babypips"
]);
const WIDGET_OR_INFRA_DOMAINS = ["livechat.com", "livechatinc.com", "intercom.io", "intercomcdn.com", "zendesk.com", "freshdesk.com"];

export function platformRootDomain(domain = "") {
  const clean = String(domain || "").replace(/^www\./i, "").toLowerCase();
  return PLATFORM_DOMAINS.find((root) => clean === root || clean.endsWith(`.${root}`)) || "";
}

function isPlatformSource(lead = {}) {
  return Boolean(platformRootDomain(domainOf(lead.url || lead.bestContactSource || "")));
}

function emailIdentityTokens(lead = {}) {
  const urlTokens = [];
  try {
    const parsed = new URL(lead.url || "");
    urlTokens.push(...parsed.pathname.split("/").filter(Boolean));
  } catch {}
  return normalizeWhitespace([
    lead.name,
    lead.companyName,
    lead.title,
    lead.pageTitle,
    ...(lead.evidence || []),
    ...urlTokens
  ].filter(Boolean).join(" "))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !/^(?:forex|trading|trader|platform|copy|signal|signals|global|english|spanish|portuguese|profile|public|contact|path|affiliate|community|audience|zulu|zulutrade)$/.test(token));
}

function freemailMatchesLeadIdentity(email = "", lead = {}) {
  const [local = ""] = String(email || "").toLowerCase().split("@");
  const compactLocal = local.replace(/[^a-z0-9]+/g, "");
  if (compactLocal.length < 5) return false;
  return emailIdentityTokens(lead).some((token) => {
    const compactToken = token.replace(/[^a-z0-9]+/g, "");
    return compactToken.length >= 4 && (compactLocal.includes(compactToken) || compactToken.includes(compactLocal));
  });
}

export function isPlatformOwnedEmail(email = "", lead = {}) {
  const clean = String(email || "").trim().toLowerCase();
  const [local = "", emailDomainRaw = ""] = clean.split("@");
  const emailDomain = emailDomainRaw.replace(/^www\./, "");
  if (!local || !emailDomain) return true;
  if (GENERIC_EMAIL_DOMAINS.has(emailDomain)) return true;
  if (GENERIC_LOCALS.test(local)) return true;

  const emailRoot = platformRootDomain(emailDomain);
  if (emailRoot) {
    const sourceRoot = platformRootDomain(domainOf(lead.url || lead.bestContactSource || ""));
    if (sourceRoot) return true;
    if (GENERIC_LOCALS.test(local)) return true;
  }

  if (isPlatformSource(lead) && FREEMAIL_DOMAINS.has(emailDomain) && !freemailMatchesLeadIdentity(clean, lead)) return true;
  return false;
}

function handleFromSocialUrl(url = "") {
  const clean = safeUrl(url);
  if (!clean) return "";
  try {
    const parsed = new URL(clean);
    const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    if (domain === "tiktok.com") return parts[0].replace(/^@/, "").toLowerCase();
    if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) return (parts[1] || parts[0] || "").toLowerCase();
    return parts[0].replace(/^@/, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isPlatformOwnedUrl(url = "", lead = {}) {
  const clean = safeUrl(url);
  if (!clean) return true;
  const domain = domainOf(clean);
  if (!domain) return true;
  if (WIDGET_OR_INFRA_DOMAINS.some((root) => domain === root || domain.endsWith(`.${root}`))) return true;
  if (platformRootDomain(domain)) return true;
  const handle = handleFromSocialUrl(clean);
  if (handle && PLATFORM_BRAND_HANDLES.has(handle)) return true;
  if (isPlatformSource(lead) && handle && PLATFORM_BRAND_HANDLES.has(handle.replace(/[^a-z0-9]+/g, ""))) return true;
  return false;
}

export function filterDecisionMakerEmails(lead = {}) {
  return cleanEmails(lead.emails || []).filter((email) => !isPlatformOwnedEmail(email, lead));
}

export function filterDecisionUrls(urls = [], lead = {}) {
  return [...new Set((urls || []).filter(Boolean))].filter((url) => !isPlatformOwnedUrl(url, lead));
}

export function filterDecisionForms(lead = {}) {
  return cleanForms(lead.forms || []).filter((form) => {
    const pageUrl = form.pageUrl || form.action || "";
    return !isPlatformOwnedUrl(pageUrl, lead);
  });
}

export function stripPlatformOwnedContacts(lead = {}) {
  const emails = filterDecisionMakerEmails(lead);
  const platformBestEmail = lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead);
  const platformBestUrl = lead.bestContact && ["form", "social", "website", "direct-link"].includes(lead.bestContactType || "") && isPlatformOwnedUrl(lead.bestContact, lead);
  const platformBest = platformBestEmail || platformBestUrl;
  return {
    ...lead,
    emails,
    forms: filterDecisionForms(lead),
    bestContact: platformBest ? "" : lead.bestContact || "",
    bestContactType: platformBest ? "" : lead.bestContactType || "",
    bestContactSource: platformBest ? "" : lead.bestContactSource || ""
  };
}
