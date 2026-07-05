import * as cheerio from "cheerio";
import { cleanEmails, cleanLinks, cleanPhoneNumbers, isBlockedLinkUrl, isBrokerOrReferralUrl, isLinkHubUrl, isShortenerUrl } from "./contact-cleaner.js";
import { deepEnrichResult as baseDeepEnrichResult } from "./deep.js";
import { bareWebsiteUrls, cleanDecisionContactLinks, isDecisionContactUrl, isPlatformProfileDomain, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { filterDecisionMakerEmails, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { domainOf, normalizeWhitespace, safeUrl, sleep, titleFromUrl, unique } from "./utils.js";
import { extractEmails, fetchHtml, resolveFinalUrl, searchOne } from "./search.js";

const GENERIC = new Set(["platform", "copy", "trader", "forex", "fx", "gold", "xauusd", "trading", "strategy", "signal", "signals", "provider", "portfolio", "manager", "growth", "reliability", "algo", "global"]);
const READABLE_PLATFORM_ROOTS = ["myfxbook.com", "mql5.com", "fxblue.com", "zulutrade.com", "darwinex.com", "signalstart.com", "collective2.com"];
const DIRECT_ROOTS = ["linkedin.com", "instagram.com", "x.com", "twitter.com", "t.me", "telegram.me", "facebook.com", "tiktok.com", "threads.net", "discord.gg", "discord.com", "linktr.ee", "beacons.ai", "bio.link", "msha.ke", "solo.to", "carrd.co", "taplink.cc", "wa.me", "whatsapp.com", "calendly.com"];
const AFFILIATE_LANDING_PATTERN = /(?:one\.exnessonelink\.com|exnessonelink\.com|exness-track|exnesstrack|apextraderfunding\.com\/member|affiliate_id=|partner_id=|ref=|referral|affid|clickid=|promo_code=)/i;

function rootMatch(domain, roots) {
  return roots.some((root) => domain === root || domain.endsWith(`.${root}`));
}

function loose(value = "") {
  let text = String(value || "").replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=").replace(/\\u003a/gi, ":").replace(/\\u002f/gi, "/").replace(/&amp;/g, "&");
  try { text = decodeURIComponent(text); } catch {}
  return text;
}

function compact(value = "") {
  return normalizeWhitespace(loose(value)).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function tokenList(value = "") {
  return normalizeWhitespace(loose(value)).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((token) => token.length >= 2 && !GENERIC.has(token));
}

function cleanIdentity(value = "") {
  return normalizeWhitespace(loose(value))
    .replace(/^platform\s*[|:-]\s*/i, "")
    .replace(/\s*[-|:]\s*(?:zulutrade|myfxbook|mql5|fxblue|signalstart|darwinex|copy trader|forex|trading).*$/i, "")
    .replace(/(?:\s+copy\s+trader\s+forex|\s+trading\s+strategy).*$/i, "")
    .replace(/^@/, "")
    .trim();
}

function usefulIdentity(value = "") {
  const cleaned = cleanIdentity(value);
  return cleaned.length >= 3 && !/^\d+$/.test(cleaned) && tokenList(cleaned).length;
}

function namesFromText(text = "") {
  const raw = loose(text);
  const upper = [...raw.matchAll(/\b([A-Z][A-Z0-9]{2,}(?:\s+[A-Z0-9]{2,}){0,3})\b/g)].map((m) => m[1]);
  const quoted = [...raw.matchAll(/["“']([A-Z0-9][A-Z0-9 ._-]{2,40})["”']/g)].map((m) => m[1]);
  return unique([...upper, ...quoted].map(cleanIdentity)).filter(usefulIdentity).slice(0, 8);
}

function namesFromUrl(url = "") {
  const clean = safeUrl(url);
  if (!clean) return [];
  const domain = domainOf(clean);
  try {
    const parts = new URL(clean).pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();
    const second = (parts[1] || "").toLowerCase();
    const candidates = [];
    if ((domain === "myfxbook.com" || domain.endsWith(".myfxbook.com")) && ["members", "portfolio", "community"].includes(first) && parts[1]) candidates.push(parts[1]);
    if ((domain === "mql5.com" || domain.endsWith(".mql5.com")) && first === "en" && second === "users" && parts[2]) candidates.push(parts[2]);
    if ((domain === "fxblue.com" || domain.endsWith(".fxblue.com")) && first === "users" && parts[1]) candidates.push(parts[1]);
    if ((domain === "zulutrade.com" || domain.endsWith(".zulutrade.com")) && first === "trader" && parts[1]) candidates.push(parts[1]);
    if ((domain === "darwinex.com" || domain.endsWith(".darwinex.com")) && first === "darwin" && parts[1]) candidates.push(parts[1]);
    if ((domain === "signalstart.com" || domain.endsWith(".signalstart.com")) && first === "analysis" && parts[1]) candidates.push(parts[1]);
    if ((domain === "instagram.com" || domain.endsWith(".instagram.com")) && parts[0]) candidates.push(parts[0]);
    if ((domain === "x.com" || domain === "twitter.com") && parts[0]) candidates.push(parts[0]);
    if ((domain === "tiktok.com" || domain.endsWith(".tiktok.com")) && parts[0]?.startsWith("@")) candidates.push(parts[0].replace(/^@/, ""));
    if ((domain === "t.me" || domain === "telegram.me") && parts[0]) candidates.push(parts[0]);
    if ((domain === "linkedin.com" || domain.endsWith(".linkedin.com")) && ["in", "company"].includes(first) && parts[1]) candidates.push(parts[1]);
    return unique(candidates.map((name) => name.replace(/[-_]+/g, " ")).map(cleanIdentity)).filter(usefulIdentity).slice(0, 6);
  } catch {
    return [];
  }
}

function identityFor(lead = {}) {
  const fields = [lead.name, lead.title, lead.pageTitle, lead.pageDescription, lead.snippet].filter(Boolean);
  const page = String(lead.pageText || "").slice(0, 1800);
  const urlNames = unique([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || []), ...(lead.websiteLinks || [])].flatMap(namesFromUrl));
  const names = unique([...urlNames, ...fields.map(cleanIdentity), ...fields.flatMap(namesFromText), ...namesFromText(page)]).filter(usefulIdentity).slice(0, 10);
  return { names, tokens: unique(names.flatMap(tokenList)).slice(0, 14), aliases: unique(names.map(compact)).filter((alias) => alias.length >= 3) };
}

function matchesIdentity(item = {}, identity = {}) {
  const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`.toLowerCase();
  const packed = compact(text);
  if (identity.aliases.some((alias) => alias.length >= 4 && packed.includes(alias))) return true;
  const hits = identity.tokens.filter((token) => text.includes(token) || packed.includes(compact(token))).length;
  return identity.tokens.length >= 2 && hits >= Math.min(2, identity.tokens.length);
}

function cleanExternalUrl(value, baseUrl) {
  try { return safeUrl(new URL(loose(value), baseUrl).toString()); } catch { return null; }
}

function mineUrls(text = "", baseUrl = "") {
  const decoded = loose(text);
  const explicit = decoded.match(/https?:\/\/[^\s"'<>)}\]]+/gi) || [];
  return unique([...explicit, ...bareWebsiteUrls(decoded)].map((url) => cleanExternalUrl(String(url).replace(/[.,;]+$/, ""), baseUrl)).filter(Boolean))
    .filter((url) => !isBlockedLinkUrl(url) && !isBrokerOrReferralUrl(url) && !AFFILIATE_LANDING_PATTERN.test(url))
    .slice(0, 50);
}

function isDirectUrl(url = "") {
  const domain = domainOf(url);
  return isDecisionContactUrl(url) || isLinkHubUrl(url) || rootMatch(domain, DIRECT_ROOTS);
}

function canRead(url = "", sourceUrl = "") {
  const domain = domainOf(url);
  if (!domain || domain === domainOf(sourceUrl) || isBlockedLinkUrl(url) || isBrokerOrReferralUrl(url) || AFFILIATE_LANDING_PATTERN.test(url)) return false;
  if (isLinkHubUrl(url)) return true;
  if (isPlatformProfileDomain(domain)) return rootMatch(domain, READABLE_PLATFORM_ROOTS);
  if (isDirectUrl(url) && !isDecisionContactUrl(url)) return false;
  return !/\.(?:png|jpe?g|gif|webp|svg|css|js|pdf)(?:[?#].*)?$/i.test(url);
}

async function readPage(url) {
  try {
    const page = await fetchHtml(url, 16000);
    const finalUrl = safeUrl(page.finalUrl) || url;
    const $ = cheerio.load(page.html);
    const title = normalizeWhitespace($("title").first().text()) || titleFromUrl(finalUrl);
    const body = normalizeWhitespace($("body").text()).slice(0, 8000);
    const hrefs = [];
    $("a[href]").each((_, el) => {
      const link = cleanExternalUrl($(el).attr("href"), finalUrl);
      if (link) hrefs.push(link);
    });
    const text = `${page.html} ${body}`;
    const links = cleanLinks([...hrefs, ...mineUrls(text, finalUrl)], { allowYouTubeChannels: false, allowShorteners: true }).filter((link) => !AFFILIATE_LANDING_PATTERN.test(link));
    return {
      url: finalUrl,
      title,
      emails: extractEmails(text),
      phoneNumbers: cleanPhoneNumbers(text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []),
      contactLinks: unique([
        ...cleanDecisionContactLinks(links),
        ...links.filter((link) => !isPlatformProfileUrl(link) && /contact|about|partner|affiliate|whatsapp|telegram|calendly|book|call/i.test(link))
      ]).slice(0, 25),
      socialLinks: links.filter(isDirectUrl).slice(0, 25),
      websiteLinks: links.filter((link) => !isDirectUrl(link) && !isPlatformProfileUrl(link)).slice(0, 25)
    };
  } catch {
    return { url, emails: [], phoneNumbers: [], contactLinks: [], socialLinks: [], websiteLinks: [] };
  }
}

async function seedContactPages(current = {}, maxPages = 6) {
  const pages = [];
  const queue = [];
  if (current.url && (isPlatformProfileUrl(current.url) || rootMatch(domainOf(current.url), READABLE_PLATFORM_ROOTS))) {
    const sourcePage = await readPage(current.url);
    pages.push(sourcePage);
    queue.push(...(sourcePage.websiteLinks || []), ...(sourcePage.contactLinks || []), ...(sourcePage.socialLinks || []));
  }
  queue.push(...(current.websiteLinks || []), ...(current.contactLinks || []), ...(current.socialLinks || []));
  for (const link of unique(queue).filter((url) => canRead(url, current.url)).slice(0, Math.max(2, maxPages))) {
    if (pages.length >= maxPages) break;
    const resolved = isShortenerUrl(link) ? await resolveFinalUrl(link) : link;
    if (resolved && canRead(resolved, current.url)) pages.push(await readPage(resolved));
    await sleep(150);
  }
  return pages;
}

function mergeTrail(base = {}, pages = [], related = []) {
  const merged = {
    ...base,
    relatedLinks: unique([...(base.relatedLinks || []), ...related]).slice(0, 50),
    contactSources: unique([...(base.contactSources || []), ...pages.map((p) => p.url).filter(Boolean)]).slice(0, 35),
    emails: cleanEmails([...(base.emails || []), ...pages.flatMap((p) => p.emails || [])]),
    phoneNumbers: cleanPhoneNumbers([...(base.phoneNumbers || []), ...pages.flatMap((p) => p.phoneNumbers || [])]),
    contactLinks: cleanLinks([...(base.contactLinks || []), ...pages.flatMap((p) => p.contactLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => !AFFILIATE_LANDING_PATTERN.test(url)).slice(0, 50),
    socialLinks: cleanLinks([...(base.socialLinks || []), ...pages.flatMap((p) => p.socialLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => !AFFILIATE_LANDING_PATTERN.test(url)).slice(0, 50),
    websiteLinks: cleanLinks([...(base.websiteLinks || []), ...pages.flatMap((p) => p.websiteLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => !AFFILIATE_LANDING_PATTERN.test(url)).slice(0, 50),
    identityTrailSearched: true,
    identityTrailSources: unique(pages.map((p) => p.url).filter(Boolean)).slice(0, 25)
  };
  const stripped = stripPlatformOwnedContacts({ ...merged, emails: filterDecisionMakerEmails(merged) });
  return { ...stripped, ...pickBestContact(stripped) };
}

function contactQueriesForName(name = "") {
  return [
    `"${name}" whatsapp forex`,
    `"${name}" telegram forex`,
    `"${name}" "contact" "forex"`,
    `"${name}" "trading" "whatsapp"`,
    `"${name}" "trading" "telegram"`,
    `"${name}" site:instagram.com`,
    `"${name}" site:t.me`,
    `"${name}" site:linktr.ee`,
    `"${name}" site:beacons.ai`,
    `"${name}" site:bio.link`,
    `"${name}" site:linkedin.com/in`,
    `"${name}" site:myfxbook.com`,
    `"${name}" site:mql5.com/en/users`,
    `"${name}" site:fxblue.com/users`,
    `"${name}" forex`,
    `"${name}" trading contact`
  ];
}

async function enrichIdentityTrail(lead = {}, options = {}) {
  const current = stripPlatformOwnedContacts(lead);
  const identity = identityFor(current);
  if (!identity.names.length && !identity.tokens.length) return current;
  const strong = Boolean(current.bestContact && current.bestContactType !== "email" && current.bestContactType !== "website") || cleanDecisionContactLinks(current.contactLinks || []).length > 0;
  if (strong && Number(current.contactConfidence || 0) >= 80) return current;

  const maxPages = Math.max(3, Math.min(Number(options.maxContactPages || 8), 12));
  const names = identity.names.length ? identity.names.slice(0, 5) : [identity.tokens.slice(0, 3).join(" ")].filter(Boolean);
  const queries = unique(names.flatMap(contactQueriesForName)).slice(0, Math.max(8, Math.min(Number(options.maxTrailQueries || 24), 32)));

  const related = [];
  const pages = await seedContactPages(current, maxPages);
  for (const query of queries) {
    const { results } = await searchOne(query, current.sourceIntent || "specialist", Math.max(4, Math.min(Number(options.trailLimit || 8), 12)), ["yahoo", "bing-rss", "bing", "brave-html", "duckduckgo"]);
    for (const item of results) {
      if (!matchesIdentity(item, identity)) continue;
      related.push(item.url);
      if (pages.length < maxPages && canRead(item.url, current.url)) {
        const first = await readPage(item.url);
        pages.push(first);
        const follow = cleanLinks([...(first.websiteLinks || []), ...(first.contactLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => canRead(url, current.url)).slice(0, 3);
        for (const link of follow) {
          if (pages.length >= maxPages) break;
          const resolved = isShortenerUrl(link) ? await resolveFinalUrl(link) : link;
          if (resolved && canRead(resolved, current.url)) pages.push(await readPage(resolved));
          await sleep(150);
        }
      }
    }
    if (pages.length >= maxPages) break;
    await sleep(250);
  }
  return pages.length || related.length ? mergeTrail(current, pages, related) : current;
}

export async function deepEnrichResult(result, options = {}) {
  const base = stripPlatformOwnedContacts(await baseDeepEnrichResult(result, options));
  const enriched = await enrichIdentityTrail(base, options);
  return stripPlatformOwnedContacts({ ...enriched, ...pickBestContact(enriched) });
}
