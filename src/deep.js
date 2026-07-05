import * as cheerio from "cheerio";
import {
  cleanEmails,
  cleanForms,
  cleanLinks,
  cleanPhoneNumbers,
  isBlockedLinkUrl,
  isBrokerOrReferralUrl,
  isLinkHubUrl,
  isShortenerUrl,
  isUsefulDirectContactUrl
} from "./contact-cleaner.js";
import {
  bareWebsiteUrls,
  isGenericContactTrailName,
  isPlatformProfileDomain,
  isPlatformProfileUrl,
  pickBestContact
} from "./platform-enrichment.js";
import { domainOf, normalizeWhitespace, safeUrl, sleep, unique } from "./utils.js";
import { extractEmails, fetchHtml, resolveFinalUrl, searchOne } from "./search.js";

const CONTACT_WORDS = [
  "contact",
  "contacto",
  "contato",
  "about",
  "sobre",
  "partner",
  "partners",
  "partnership",
  "affiliate",
  "afiliado",
  "whatsapp",
  "calendly",
  "book"
];

const SOCIAL_DOMAINS = [
  "linkedin.com",
  "youtube.com",
  "instagram.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  "discord.gg",
  "discord.com",
  "x.com",
  "twitter.com",
  "threads.net",
  "facebook.com",
  "tiktok.com",
  "linktr.ee",
  "reddit.com",
  "tradingview.com",
  "forexfactory.com",
  "babypips.com",
  "beacons.ai",
  "bio.link",
  "msha.ke",
  "solo.to",
  "allmylinks.com",
  "calendly.com",
  "wa.me",
  "whatsapp.com"
];

const IGNORE_DOMAINS = [
  "google.com",
  "gstatic.com",
  "schema.org",
  "w3.org",
  "doubleclick.net",
  "ytimg.com",
  "googlevideo.com",
  "googleusercontent.com",
  "youtubei.googleapis.com",
  "youtubei-att.googleapis.com",
  "accountlinking-pa-clients6.youtube.com",
  "payments.youtube.com",
  "studio.youtube.com"
];

const CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/contacto",
  "/contato",
  "/about",
  "/about-us",
  "/sobre",
  "/partnership",
  "/partnerships",
  "/partners",
  "/affiliate",
  "/affiliates"
];

const DECISION_MAKER_TERMS =
  /founder|co[- ]?founder|ceo|chief|owner|director|head|partner|partnership|business development|\bbd\b|country manager|affiliate manager|portfolio manager|fund manager|investment manager|principal|managing partner/i;

const TRAIL_SEARCH_CONTACT_CONFIDENCE_CEILING = 80;
const TRAIL_SEARCH_MAX_CRAWLS = 4;
const TRAIL_SEARCH_TRADING_CONTEXT =
  /\b(?:forex|fx\b|trading|trader|xauusd|gold|metatrader|mt4|mt5|pamm|mam|copy trading|signals?|broker|ib\b|introducing broker|affiliate|cpa|revshare|revenue share|fund manager|portfolio manager|money manager)\b/i;
const TRAIL_SEARCH_CONTACT_CONTEXT =
  /\b(?:contact|contacto|contato|email|e-mail|mail|whatsapp|wa\.me|telegram|t\.me|instagram|linkedin|about|partner|partnership|affiliate|book|call|message|mensagem|mensaje)\b/i;
const GENERIC_IDENTITY_TOKENS = new Set([
  "forex",
  "fx",
  "gold",
  "xauusd",
  "crypto",
  "trading",
  "trader",
  "copy",
  "signals",
  "signal",
  "pamm",
  "mam",
  "fund",
  "manager",
  "portfolio",
  "money",
  "asset",
  "account",
  "support",
  "contact",
  "official",
  "the",
  "and",
  "for",
  "with",
  "broker",
  "brokers",
  "academy",
  "community",
  "channel",
  "group"
]);

function decodeLoose(value = "") {
  let text = String(value)
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003a/g, ":")
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the partially decoded text.
  }
  return text;
}

function cleanExternalUrl(value, baseUrl) {
  if (!value) return null;
  let candidate = decodeLoose(value);
  try {
    candidate = new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.hostname.includes("youtube.com") && parsed.pathname.includes("/redirect")) {
      const q = parsed.searchParams.get("q") || parsed.searchParams.get("url");
      if (q) return safeUrl(decodeLoose(q));
    }
  } catch {
    return null;
  }
  return safeUrl(candidate);
}

function compactIdentity(value = "") {
  return normalizeWhitespace(decodeLoose(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function identityTokensFrom(value = "") {
  return normalizeWhitespace(decodeLoose(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3)
    .filter((token) => !GENERIC_IDENTITY_TOKENS.has(token))
    .slice(0, 6);
}

function titleIdentity(value = "") {
  return normalizeWhitespace(value)
    .replace(/\s[-|].*$/g, "")
    .replace(/(?:'s)?\s+(?:forex|fx|gold|xauusd|trading|copy trading|pamm|mam|portfolio|fund|money|asset)\s+(?:fund manager|manager|trader|signals?|provider).*$/i, "")
    .replace(/^@/, "");
}

function urlPathIdentityTokens(url = "") {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.flatMap((part) => identityTokensFrom(part.replace(/[-_]+/g, " "))).slice(0, 5);
  } catch {
    return [];
  }
}

function buildLeadIdentity(lead = {}) {
  const name = titleIdentity(lead.name || lead.title || "");
  const title = titleIdentity(lead.title || "");
  const pathTokens = urlPathIdentityTokens(lead.url || "");
  const aliases = unique([
    compactIdentity(name),
    compactIdentity(title),
    compactIdentity((lead.name || "").replace(/\s+/g, "")),
    compactIdentity(pathTokens.join(""))
  ]).filter((alias) => alias.length >= 5 && !GENERIC_IDENTITY_TOKENS.has(alias));
  const tokens = unique([
    ...identityTokensFrom(name),
    ...identityTokensFrom(title),
    ...pathTokens
  ]).filter((token) => token.length >= 3 && !GENERIC_IDENTITY_TOKENS.has(token));
  return { name, aliases, tokens };
}

function whatsappUrlFromDigits(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 16) return null;
  if (/^0+$/.test(digits)) return null;
  return `https://wa.me/${digits}`;
}

function normalizeWhatsappUrl(value, baseUrl = "") {
  const clean = cleanExternalUrl(value, baseUrl);
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    const domain = domainOf(clean);
    if (!["wa.me", "api.whatsapp.com", "web.whatsapp.com", "whatsapp.com"].some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) {
      return null;
    }
    const phoneParam = parsed.searchParams.get("phone") || parsed.searchParams.get("number") || parsed.searchParams.get("text") || "";
    const fromPath = parsed.pathname.match(/\d{8,}/)?.[0] || "";
    return whatsappUrlFromDigits(phoneParam || fromPath);
  } catch {
    return null;
  }
}

function extractWhatsappUrls(text = "", baseUrl = "") {
  const decoded = decodeLoose(text);
  const explicitLinks = decoded.match(/https?:\/\/(?:api\.|web\.)?whatsapp\.com\/[^\s"'<>)}\]]+|https?:\/\/wa\.me\/[^\s"'<>)}\]]+/gi) || [];
  const inlineNumbers = [...decoded.matchAll(/(?:whats?app|wa\.me|api\.whatsapp)[^+\d]{0,60}(\+?\d[\d\s().-]{7,}\d)/gi)].map((match) => match[1]);
  return unique([
    ...explicitLinks.map((url) => normalizeWhatsappUrl(url, baseUrl)),
    ...inlineNumbers.map(whatsappUrlFromDigits)
  ].filter(Boolean));
}

function extractUrls(text, baseUrl = "") {
  const decoded = decodeLoose(text);
  const baseDomain = domainOf(baseUrl);
  const matches = unique([...(decoded.match(/https?:\/\/[^\s"'<>)}\]]+/gi) || []), ...bareWebsiteUrls(decoded), ...extractWhatsappUrls(decoded, baseUrl)]);
  return unique(
    matches
      .map((url) => cleanExternalUrl(url.replace(/[.,;]+$/, ""), baseUrl))
      .filter(Boolean)
      .filter((url) => {
        const domain = domainOf(url);
        if (!domain || isBlockedLinkUrl(url) || isBrokerOrReferralUrl(url)) return false;
        if (IGNORE_DOMAINS.some((ignored) => domain === ignored || domain.endsWith(`.${ignored}`))) return false;
        if (baseDomain && isPlatformProfileDomain(baseDomain) && domain === baseDomain) return false;
        if (
          (baseDomain === "youtube.com" || baseDomain.endsWith(".youtube.com")) &&
          (domain === "youtube.com" || domain.endsWith(".youtube.com"))
        ) {
          return false;
        }
        if (domain === "youtube.com" || domain.endsWith(".youtube.com")) {
          try {
            const parsed = new URL(url);
            if (
              parsed.pathname.startsWith("/s/") ||
              parsed.pathname.startsWith("/error_") ||
              parsed.pathname.startsWith("/csi_") ||
              parsed.pathname.startsWith("/watch") ||
              parsed.pathname === "/g" ||
              parsed.pathname.includes("favicon") ||
              parsed.pathname.includes("jsbin")
            ) {
              return false;
            }
          } catch {
            return false;
          }
        }
        return true;
      })
  ).slice(0, 30);
}

function extractPhoneNumbers(text) {
  const decoded = decodeLoose(text);
  const matches = decoded.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  const whatsappNumbers = [...decoded.matchAll(/(?:whats?app|wa\.me|api\.whatsapp)[^+\d]{0,60}(\+?\d[\d\s().-]{7,}\d)/gi)].map((match) => match[1]);
  return cleanPhoneNumbers([...matches, ...whatsappNumbers]);
}

function isSocialUrl(url) {
  if (isLinkHubUrl(url)) return false;
  const domain = domainOf(url);
  return SOCIAL_DOMAINS.some((social) => domain === social || domain.endsWith(`.${social}`));
}

function isContactUrl(url) {
  const lower = url.toLowerCase();
  return CONTACT_WORDS.some((word) => lower.includes(word));
}

function isLinkedInDecisionUrl(url) {
  const domain = domainOf(url);
  if (domain !== "linkedin.com" && !domain.endsWith(".linkedin.com")) return false;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const section = (parts[0] || "").toLowerCase();
    return ["in", "company"].includes(section) && parts.length >= 2;
  } catch {
    return false;
  }
}

function splitLinkTypes(urls, sourceUrl = "") {
  const socialLinks = [];
  const contactLinks = [];
  const websiteLinks = [];
  const sourceDomain = domainOf(sourceUrl);
  const sourceIsPlatform = isPlatformProfileDomain(sourceDomain);
  for (const url of urls) {
    if (isBlockedLinkUrl(url) || isBrokerOrReferralUrl(url)) continue;
    const domain = domainOf(url);
    if (sourceIsPlatform && domain === sourceDomain) continue;
    if (domain === "youtube.com" || domain.endsWith(".youtube.com")) {
      try {
        const path = new URL(url).pathname;
        if (path.includes("/about") || path.startsWith("/@")) continue;
      } catch {
        continue;
      }
    }
    if (isLinkHubUrl(url)) {
      socialLinks.push(url);
      contactLinks.push(url);
      websiteLinks.push(url);
      continue;
    }
    if (isUsefulDirectContactUrl(url)) socialLinks.push(url);
    if (isUsefulDirectContactUrl(url)) contactLinks.push(url);
    if (isSocialUrl(url)) socialLinks.push(url);
    if (isContactUrl(url)) contactLinks.push(url);
    if (!isSocialUrl(url) && !isContactUrl(url)) websiteLinks.push(url);
  }
  return {
    socialLinks: cleanLinks(socialLinks, { allowYouTubeChannels: false }).slice(0, 20),
    contactLinks: cleanLinks(contactLinks, { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 20),
    websiteLinks: cleanLinks(websiteLinks, { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 20)
  };
}

function extractForms($, pageUrl) {
  const forms = [];
  $("form").each((index, element) => {
    const form = $(element);
    const fields = [];
    form.find("input, textarea, select").each((_, field) => {
      const node = $(field);
      const name = node.attr("name") || node.attr("id") || node.attr("placeholder") || node.attr("type") || "";
      const clean = normalizeWhitespace(name);
      if (clean && !["hidden", "submit", "button"].includes(clean.toLowerCase())) fields.push(clean);
    });
    const action = cleanExternalUrl(form.attr("action") || pageUrl, pageUrl) || pageUrl;
    const text = normalizeWhitespace(form.text()).slice(0, 180);
    const method = (form.attr("method") || "get").toUpperCase();
    forms.push({
      pageUrl,
      action,
      method,
      fields: unique(fields).slice(0, 12),
      label: text || `Form ${index + 1}`
    });
  });
  return cleanForms(forms).slice(0, 6);
}

async function readContactPage(url) {
  try {
    const page = await fetchHtml(url, 13000);
    const html = page.html;
    const finalUrl = safeUrl(page.finalUrl) || url;
    if (isBlockedLinkUrl(finalUrl) || isBrokerOrReferralUrl(finalUrl)) {
      return {
        ok: false,
        url: finalUrl,
        error: "Skipped blocked/broker/referral page"
      };
    }
    const $ = cheerio.load(html);
    const rawText = $("body").text();
    $("script, style, noscript, svg, iframe").remove();
    const pageText = normalizeWhitespace($("body").text()).slice(0, 10000);
    const pageTitle = normalizeWhitespace($("title").first().text());
    const pageDescription = normalizeWhitespace(
      $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="twitter:description"]').attr("content") ||
        ""
    );
    const hrefs = [];
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      const link = cleanExternalUrl(href, finalUrl);
      if (link) hrefs.push(link);
    });
    const textToMine = `${html} ${rawText} ${pageText}`;
    const whatsappUrls = extractWhatsappUrls(textToMine, finalUrl);
    const urls = unique([...hrefs, ...whatsappUrls, ...extractUrls(textToMine, finalUrl)]);
    const types = splitLinkTypes(urls, finalUrl);
    return {
      ok: true,
      url: finalUrl,
      pageTitle,
      pageDescription,
      pageText,
      emails: extractEmails(textToMine),
      phoneNumbers: extractPhoneNumbers(textToMine),
      forms: extractForms($, finalUrl),
      ...types
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error.message
    };
  }
}

function guessedContactUrls(url) {
  try {
    const parsed = new URL(url);
    if (isPlatformProfileUrl(url)) return [];
    if (isSocialUrl(url) && !isLinkHubUrl(url)) return [];
    return CONTACT_PATHS.map((pathname) => `${parsed.origin}${pathname}`);
  } catch {
    return [];
  }
}

function isCrawlableExternalWebsite(url) {
  const domain = domainOf(url);
  if (!domain) return false;
  if (isBlockedLinkUrl(url) || isBrokerOrReferralUrl(url)) return false;
  if (isPlatformProfileDomain(domain)) return false;
  if (isSocialUrl(url) && !isLinkHubUrl(url)) return false;
  if (IGNORE_DOMAINS.some((ignored) => domain === ignored || domain.endsWith(`.${ignored}`))) return false;
  if (/googlevideo|googleusercontent|ytimg|youtubei|initplayback|favicon|\.jpg|\.jpeg|\.png|\.gif|\.webp|\.svg|\.css|\.js/i.test(url)) {
    return false;
  }
  return true;
}

async function crawlWebsiteForContacts(url, options = {}) {
  const pages = [];
  const base = await readContactPage(url);
  pages.push(base);
  const candidates = unique([
    ...(base.contactLinks || []),
    ...guessedContactUrls(url)
  ])
    .filter(isCrawlableExternalWebsite)
    .slice(0, options.maxContactPages || 5);

  for (const candidate of candidates) {
    if (candidate.replace(/\/$/, "") === url.replace(/\/$/, "")) continue;
    const page = await readContactPage(candidate);
    pages.push(page);
    await sleep(250);
  }
  return pages;
}

async function enrichExternalWebsites(result, options = {}) {
  // Only crawl URLs that were extracted from the profile/page/linkhub itself.
  // Broad search-result URLs stay as related evidence unless they are crawled explicitly in searchForContactTrail().
  const rawCandidates = unique([...(result.websiteLinks || []), ...(result.trustedWebsiteLinks || [])]).slice(0, 24);
  const resolvedCandidates = [];
  const directLinks = [];
  for (const candidate of rawCandidates) {
    const resolved = isShortenerUrl(candidate) ? await resolveFinalUrl(candidate) : candidate;
    if (!resolved) continue;
    if (isUsefulDirectContactUrl(resolved)) {
      directLinks.push(resolved);
      await sleep(80);
      continue;
    }
    if (isCrawlableExternalWebsite(resolved)) resolvedCandidates.push(resolved);
    await sleep(80);
  }
  const candidates = unique(resolvedCandidates).slice(0, options.maxExternalWebsites || 4);

  const pages = [];
  for (const url of candidates) {
    pages.push(...(await crawlWebsiteForContacts(url, options)));
    await sleep(350);
  }
  return mergeLeadData({ ...result, contactLinks: unique([...(result.contactLinks || []), ...directLinks]) }, pages);
}

function mergeLeadData(base, additions) {
  const merged = { ...base };
  merged.emails = cleanEmails([...(merged.emails || []), ...additions.flatMap((item) => item.emails || [])]);
  merged.phoneNumbers = cleanPhoneNumbers([...(merged.phoneNumbers || []), ...additions.flatMap((item) => item.phoneNumbers || [])]);
  merged.socialLinks = cleanLinks([...(merged.socialLinks || []), ...additions.flatMap((item) => item.socialLinks || [])], {
    allowYouTubeChannels: false
  }).slice(0, 30);
  merged.contactLinks = cleanLinks([...(merged.contactLinks || []), ...additions.flatMap((item) => item.contactLinks || [])], {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).slice(0, 30);
  merged.websiteLinks = cleanLinks([...(merged.websiteLinks || []), ...additions.flatMap((item) => item.websiteLinks || [])], {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).slice(0, 30);
  merged.forms = cleanForms([
    ...(merged.forms || []),
    ...additions.flatMap((item) => item.forms || [])
  ]).slice(0, 12);
  merged.contactSources = cleanLinks([...(merged.contactSources || []), ...additions.map((item) => item.url).filter(Boolean)], {
    allowYouTubeChannels: false
  }).slice(0, 20);
  merged.decisionMakerLinks = cleanLinks(
    [
      ...(merged.decisionMakerLinks || []),
      ...additions.flatMap((item) => item.decisionMakerLinks || []),
      ...additions.flatMap((item) => [...(item.socialLinks || []), ...(item.contactLinks || []), ...(item.relatedLinks || [])].filter(isLinkedInDecisionUrl))
    ],
    {
      allowYouTubeChannels: false,
      allowShorteners: true
    }
  ).slice(0, 20);
  const seenPeople = new Set();
  merged.decisionMakers = [
    ...(merged.decisionMakers || []),
    ...additions.flatMap((item) => item.decisionMakers || [])
  ]
    .filter((person) => {
      const key = `${person.url || ""}|${person.name || ""}|${person.title || ""}`.toLowerCase();
      if (!key || seenPeople.has(key)) return false;
      seenPeople.add(key);
      return true;
    })
    .slice(0, 12);
  return merged;
}

function scoreContactability(lead) {
  const emails = cleanEmails(lead.emails || []);
  const forms = cleanForms(lead.forms || []);
  const phones = cleanPhoneNumbers(lead.phoneNumbers || []);
  const direct = cleanLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])], {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).filter(isUsefulDirectContactUrl);
  if (direct.some((url) => /wa\.me|whatsapp/i.test(url))) return { contactConfidence: 96, contactQuality: "whatsapp" };
  if (emails.length) return { contactConfidence: 94, contactQuality: "email" };
  if (phones.length) return { contactConfidence: 90, contactQuality: "phone" };
  if (forms.length) return { contactConfidence: 86, contactQuality: "form" };
  if (direct.some((url) => /calendly|t\.me|telegram/i.test(url))) return { contactConfidence: 82, contactQuality: "direct-link" };
  if (direct.length) return { contactConfidence: 74, contactQuality: "social" };
  if (cleanLinks(lead.contactLinks || [], { allowYouTubeChannels: false }).length) return { contactConfidence: 65, contactQuality: "contact-page" };
  if (cleanLinks(lead.websiteLinks || [], { allowYouTubeChannels: false }).length) return { contactConfidence: 45, contactQuality: "website" };
  return { contactConfidence: 15, contactQuality: "no-contact-yet" };
}

function shouldSearchContactTrail(lead, quality) {
  const name = normalizeWhitespace((lead.name || lead.title || "").replace(/^@/, ""));
  const direct = cleanLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])], {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).some(isUsefulDirectContactUrl);
  const alreadyHasActionableContact =
    direct ||
    cleanEmails(lead.emails || []).length > 0 ||
    cleanPhoneNumbers(lead.phoneNumbers || []).length > 0 ||
    cleanForms(lead.forms || []).length > 0;
  if (alreadyHasActionableContact) return false;
  if (quality.contactConfidence >= TRAIL_SEARCH_CONTACT_CONFIDENCE_CEILING) return false;
  if (isGenericContactTrailName(name) && ((lead.websiteLinks || []).length || isPlatformProfileUrl(lead.url))) return false;
  const identity = buildLeadIdentity(lead);
  return identity.aliases.length > 0 || identity.tokens.length > 0;
}

function parseYouTubeInfo(text) {
  const decoded = decodeLoose(text);
  const description =
    decoded.match(/"description":\{"simpleText":"([^"]{10,2000})"/)?.[1] ||
    decoded.match(/"channelAboutFullMetadataRenderer":\{.*?"description":\{"simpleText":"([^"]{10,2000})"/)?.[1] ||
    "";
  const subscribers =
    decoded.match(/"subscriberCountText":\{"simpleText":"([^"]+)"/)?.[1] ||
    decoded.match(/"subscriberCountText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"/)?.[1] ||
    "";
  const country = decoded.match(/"country":\{"simpleText":"([^"]+)"/)?.[1] || "";
  return {
    channelDescription: normalizeWhitespace(decodeLoose(description)),
    audience: normalizeWhitespace(decodeLoose(subscribers)),
    youtubeCountry: normalizeWhitespace(decodeLoose(country))
  };
}

async function enrichYouTubeLead(result) {
  const pages = [];
  for (const suffix of ["", "/about"]) {
    const pageUrl = result.url.replace(/\/$/, "") + suffix;
    try {
      const page = await fetchHtml(pageUrl, 15000);
      const html = page.html;
      const info = parseYouTubeInfo(html);
      const textToMine = [info.channelDescription, info.audience, info.youtubeCountry].filter(Boolean).join(" ");
      const urls = extractUrls(textToMine, pageUrl);
      pages.push({
        ok: true,
        url: safeUrl(page.finalUrl) || pageUrl,
        emails: extractEmails(textToMine),
        phoneNumbers: extractPhoneNumbers(textToMine),
        forms: [],
        ...splitLinkTypes(urls, pageUrl),
        ...info
      });
      await sleep(250);
    } catch (error) {
      pages.push({ ok: false, url: pageUrl, error: error.message });
    }
  }
  const merged = mergeLeadData(result, pages);
  const bestInfo = pages.find((page) => page.channelDescription || page.audience || page.youtubeCountry) || {};
  return {
    ...merged,
    ...bestInfo,
    snippet: normalizeWhitespace(
      [result.snippet, bestInfo.channelDescription ? `Channel bio: ${bestInfo.channelDescription}` : ""].filter(Boolean).join(" ")
    ).slice(0, 1400)
  };
}

async function enrichWebsiteLead(result, options) {
  const pages = await crawlWebsiteForContacts(result.url, options);
  const base = pages[0] || {};

  const merged = mergeLeadData(
    {
      ...result,
      pageTitle: base.pageTitle || result.pageTitle,
      pageDescription: base.pageDescription || result.pageDescription,
      pageText: base.pageText || result.pageText,
      fetchStatus: base.ok ? "deep-ok" : `deep-failed: ${base.error}`
    },
    pages
  );
  return merged;
}

function evaluateTrailResult(item, result, identity) {
  const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`;
  const lower = text.toLowerCase();
  const compact = compactIdentity(text);
  let urlCompact = "";
  try {
    const parsed = new URL(item.url);
    urlCompact = compactIdentity(`${parsed.hostname} ${parsed.pathname}`);
  } catch {
    urlCompact = compactIdentity(item.url || "");
  }
  const aliasHit = identity.aliases.some((alias) => alias.length >= 5 && (compact.includes(alias) || urlCompact.includes(alias)));
  const tokenHits = identity.tokens.filter((token) => lower.includes(token) || urlCompact.includes(token)).length;
  const weakTokenHit = identity.tokens.length >= 2 && tokenHits >= Math.min(2, identity.tokens.length) && TRAIL_SEARCH_TRADING_CONTEXT.test(lower);
  const sourceUrlHit = Boolean(result.url && lower.includes(String(result.url).toLowerCase()));
  const matchesIdentity = aliasHit || weakTokenHit || sourceUrlHit;
  const contactContext = TRAIL_SEARCH_CONTACT_CONTEXT.test(lower) || isContactUrl(item.url || "") || isUsefulDirectContactUrl(item.url || "");
  const tradingContext = TRAIL_SEARCH_TRADING_CONTEXT.test(lower);
  const canCrawl =
    matchesIdentity &&
    (contactContext || tradingContext) &&
    !isSocialUrl(item.url) &&
    !isBrokerOrReferralUrl(item.url) &&
    !isBlockedLinkUrl(item.url) &&
    !isPlatformProfileUrl(item.url) &&
    isCrawlableExternalWebsite(item.url);
  return { matchesIdentity, canCrawl, contactContext, tradingContext };
}

async function searchForContactTrail(result, options = {}) {
  const name = normalizeWhitespace((result.name || result.title || "").replace(/^@/, ""));
  if (!name || name.length < 3 || isGenericContactTrailName(name)) return {};
  const identity = buildLeadIdentity(result);
  if (!identity.aliases.length && !identity.tokens.length) return {};
  const queries = [
    `"${name}" contact`,
    `"${name}" email`,
    `"${name}" whatsapp`,
    `"${name}" forex contact`,
    `"${name}" trading whatsapp`,
    `"${name}" trading instagram`,
    `"${name}" introducing broker`,
    `"${name}" forex affiliate`,
    `"${name}" CPA forex`,
    `"${name}" revenue share forex`,
    `"${name}" XAUUSD`,
    `"${name}" gold trader`,
    `"${name}" copy trading`,
    `"${name}" myfxbook`,
    `"${name}" mql5 signals`,
    `"${name}" LinkedIn`,
    `"${name}" site:linkedin.com/in`,
    `"${name}" site:instagram.com`,
    `"${name}" site:x.com`,
    `"${name}" site:twitter.com`,
    `"${name}" site:facebook.com`,
    `"${name}" site:tiktok.com`,
    `"${name}" site:tradingview.com/u/`,
    `"${name}" linktree`,
    `"${name}" beacons forex`,
    `"${name}" telegram forex`,
    `"${name}" founder forex`,
    `"${name}" CEO trading`,
    `"${name}" "head of partnerships"`,
    `"${name}" "business development" forex`
  ].slice(0, options.maxTrailQueries || 10);
  const related = [];
  const contactPages = [];
  const decisionMakerLinks = [];
  const decisionMakers = [];
  for (const query of queries) {
    const { results } = await searchOne(query, result.sourceIntent || "partner", options.trailLimit || 5, [
      "yahoo",
      "bing-rss",
      "bing",
      "brave-html"
    ]);
    for (const item of results) {
      const evaluation = evaluateTrailResult(item, result, identity);
      if (!evaluation.matchesIdentity) continue;
      related.push(item.url);
      if (evaluation.canCrawl && contactPages.length < TRAIL_SEARCH_MAX_CRAWLS) {
        contactPages.push(await readContactPage(item.url));
        await sleep(250);
      }
      const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`.toLowerCase();
      const decisionHit = isLinkedInDecisionUrl(item.url) && (evaluation.matchesIdentity || DECISION_MAKER_TERMS.test(text));
      if (decisionHit) {
        decisionMakerLinks.push(item.url);
        const title = normalizeWhitespace(item.title || "");
        decisionMakers.push({
          name: normalizeWhitespace(title.split(/\s[-|]\s/)[0] || name),
          title,
          url: item.url,
          source: "public-search",
          evidence: normalizeWhitespace(item.snippet || "").slice(0, 240)
        });
      }
    }
    await sleep(350);
  }
  return mergeLeadData(
    {
      relatedLinks: unique(related).slice(0, 15),
      decisionMakerLinks: unique(decisionMakerLinks).slice(0, 10),
      decisionMakers: decisionMakers.slice(0, 8),
      trailSearched: true
    },
    contactPages
  );
}

function buildEnrichmentAudit(lead, sourceDomain) {
  return {
    sourceDomain,
    contactQuality: lead.contactQuality || "no-contact-yet",
    contactConfidence: Number(lead.contactConfidence || 0),
    profileFirst: true,
    searchTrailUsed: Boolean(lead.trailSearched),
    websiteCandidates: cleanLinks(lead.websiteLinks || [], { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 10),
    contactSources: cleanLinks(lead.contactSources || [], { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 10),
    relatedEvidenceCount: (lead.relatedLinks || []).length,
    note: "Contacts are prioritized from the source profile and its discovered website/linkhub before any public-search trail evidence."
  };
}

export async function deepEnrichResult(result, options = {}) {
  const domain = domainOf(result.url);
  let enriched = {
    ...result,
    emails: [],
    socialLinks: [],
    contactLinks: [],
    websiteLinks: [],
    phoneNumbers: [],
    forms: [],
    contactSources: [],
    relatedLinks: [],
    decisionMakerLinks: [],
    decisionMakers: []
  };

  if (domain.includes("youtube.com")) {
    enriched = await enrichYouTubeLead(enriched);
  } else if (!domain.includes("linkedin.com") && !domain.includes("instagram.com") && !domain.includes("facebook.com")) {
    enriched = await enrichWebsiteLead(enriched, options);
  }

  if ((enriched.websiteLinks || []).some(isCrawlableExternalWebsite)) {
    enriched = await enrichExternalWebsites(enriched, options);
  }

  const currentQuality = scoreContactability(enriched);
  if (options.searchContacts && currentQuality.contactConfidence < 70 && shouldSearchContactTrail(enriched, currentQuality)) {
    const trail = await searchForContactTrail(enriched, options);
    enriched = mergeLeadData({ ...enriched, relatedLinks: trail.relatedLinks || [], trailSearched: trail.trailSearched }, [trail]);
    if ((enriched.websiteLinks || []).some(isCrawlableExternalWebsite)) {
      enriched = await enrichExternalWebsites(enriched, options);
    }
  } else if (options.searchContacts && shouldSearchContactTrail(enriched, currentQuality)) {
    const trail = await searchForContactTrail(enriched, {
      ...options,
      maxTrailQueries: Math.min(Number(options.maxTrailQueries || 10), 5),
      trailLimit: Math.min(Number(options.trailLimit || 5), 3)
    });
    enriched = mergeLeadData({ ...enriched, relatedLinks: trail.relatedLinks || [], trailSearched: trail.trailSearched }, [trail]);
  }

  const scored = {
    ...enriched,
    ...scoreContactability(enriched),
    lastDeepEnrichedAt: new Date().toISOString()
  };

  const finalLead = {
    ...scored,
    ...pickBestContact(scored)
  };

  return {
    ...finalLead,
    enrichmentAudit: buildEnrichmentAudit(finalLead, domain)
  };
}
