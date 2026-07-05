import * as cheerio from "cheerio";
import { cleanEmails, cleanLinks, cleanPhoneNumbers, isBlockedLinkUrl, isBrokerOrReferralUrl, isLinkHubUrl, isShortenerUrl, isUsefulDirectContactUrl } from "./contact-cleaner.js";
import { deepEnrichResult as baseDeepEnrichResult } from "./deep.js";
import { bareWebsiteUrls, isPlatformProfileDomain, isPlatformProfileUrl, pickBestContact } from "./platform-enrichment.js";
import { filterDecisionMakerEmails, stripPlatformOwnedContacts } from "./platform-contact-policy.js";
import { domainOf, normalizeWhitespace, safeUrl, sleep, titleFromUrl, unique } from "./utils.js";
import { extractEmails, fetchHtml, resolveFinalUrl, searchOne } from "./search.js";

const GENERIC = new Set(["platform", "copy", "trader", "forex", "fx", "gold", "xauusd", "trading", "strategy", "signal", "signals", "provider", "portfolio", "manager", "growth", "reliability", "algo", "global"]);
const READABLE_PLATFORM_ROOTS = ["myfxbook.com", "mql5.com", "fxblue.com", "zulutrade.com", "darwinex.com", "signalstart.com", "collective2.com"];
const DIRECT_ROOTS = ["linkedin.com", "instagram.com", "x.com", "twitter.com", "t.me", "telegram.me", "facebook.com", "tiktok.com", "threads.net", "discord.gg", "discord.com", "linktr.ee", "beacons.ai", "bio.link", "msha.ke", "solo.to", "carrd.co", "taplink.cc", "wa.me", "whatsapp.com", "calendly.com"];

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

function namesFromText(text = "") {
  const raw = loose(text);
  const upper = [...raw.matchAll(/\b([A-Z][A-Z0-9]{2,}(?:\s+[A-Z0-9]{2,}){0,3})\b/g)].map((m) => m[1]);
  const quoted = [...raw.matchAll(/["“']([A-Z0-9][A-Z0-9 ._-]{2,40})["”']/g)].map((m) => m[1]);
  return unique([...upper, ...quoted].map(cleanIdentity)).filter((name) => name.length >= 3 && tokenList(name).length).slice(0, 8);
}

function identityFor(lead = {}) {
  const fields = [lead.name, lead.title, lead.pageTitle, lead.pageDescription, lead.snippet].filter(Boolean);
  const page = String(lead.pageText || "").slice(0, 1800);
  const names = unique([...fields.map(cleanIdentity), ...fields.flatMap(namesFromText), ...namesFromText(page)]).filter((name) => name.length >= 3 && tokenList(name).length).slice(0, 8);
  return { names, tokens: unique(names.flatMap(tokenList)).slice(0, 12), aliases: unique(names.map(compact)).filter((alias) => alias.length >= 3) };
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
  return unique([...explicit, ...bareWebsiteUrls(decoded)].map((url) => cleanExternalUrl(String(url).replace(/[.,;]+$/, ""), baseUrl)).filter(Boolean)).filter((url) => !isBlockedLinkUrl(url) && !isBrokerOrReferralUrl(url)).slice(0, 40);
}

function isDirectUrl(url = "") {
  const domain = domainOf(url);
  return isUsefulDirectContactUrl(url) || isLinkHubUrl(url) || rootMatch(domain, DIRECT_ROOTS);
}

function canRead(url = "", sourceUrl = "") {
  const domain = domainOf(url);
  if (!domain || domain === domainOf(sourceUrl) || isBlockedLinkUrl(url) || isBrokerOrReferralUrl(url)) return false;
  if (isLinkHubUrl(url)) return true;
  if (isPlatformProfileDomain(domain)) return rootMatch(domain, READABLE_PLATFORM_ROOTS);
  if (isDirectUrl(url) && !isUsefulDirectContactUrl(url)) return false;
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
    const links = cleanLinks([...hrefs, ...mineUrls(text, finalUrl)], { allowYouTubeChannels: false, allowShorteners: true });
    return {
      url: finalUrl,
      title,
      emails: extractEmails(text),
      phoneNumbers: cleanPhoneNumbers(text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []),
      contactLinks: links.filter((link) => isUsefulDirectContactUrl(link) || /contact|about|partner|affiliate|whatsapp|telegram|calendly/i.test(link)).slice(0, 20),
      socialLinks: links.filter(isDirectUrl).slice(0, 20),
      websiteLinks: links.filter((link) => !isDirectUrl(link) && !isPlatformProfileUrl(link)).slice(0, 20)
    };
  } catch {
    return { url, emails: [], phoneNumbers: [], contactLinks: [], socialLinks: [], websiteLinks: [] };
  }
}

function mergeTrail(base = {}, pages = [], related = []) {
  const merged = {
    ...base,
    relatedLinks: unique([...(base.relatedLinks || []), ...related]).slice(0, 40),
    contactSources: unique([...(base.contactSources || []), ...pages.map((p) => p.url).filter(Boolean)]).slice(0, 30),
    emails: cleanEmails([...(base.emails || []), ...pages.flatMap((p) => p.emails || [])]),
    phoneNumbers: cleanPhoneNumbers([...(base.phoneNumbers || []), ...pages.flatMap((p) => p.phoneNumbers || [])]),
    contactLinks: cleanLinks([...(base.contactLinks || []), ...pages.flatMap((p) => p.contactLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 40),
    socialLinks: cleanLinks([...(base.socialLinks || []), ...pages.flatMap((p) => p.socialLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 40),
    websiteLinks: cleanLinks([...(base.websiteLinks || []), ...pages.flatMap((p) => p.websiteLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).slice(0, 40),
    identityTrailSearched: true,
    identityTrailSources: unique(pages.map((p) => p.url).filter(Boolean)).slice(0, 20)
  };
  const stripped = stripPlatformOwnedContacts({ ...merged, emails: filterDecisionMakerEmails(merged) });
  return { ...stripped, ...pickBestContact(stripped) };
}

async function enrichIdentityTrail(lead = {}, options = {}) {
  const current = stripPlatformOwnedContacts(lead);
  const identity = identityFor(current);
  if (!identity.names.length && !identity.tokens.length) return current;
  const strong = Boolean(current.bestContact && current.bestContactType !== "email") || (current.contactLinks || []).some(isUsefulDirectContactUrl);
  if (strong && Number(current.contactConfidence || 0) >= 80) return current;

  const names = identity.names.length ? identity.names.slice(0, 4) : [identity.tokens.slice(0, 3).join(" ")].filter(Boolean);
  const queries = unique(names.flatMap((name) => [
    `"${name}" myfxbook`,
    `"${name}" telegram`,
    `"${name}" whatsapp`,
    `"${name}" site:myfxbook.com`,
    `"${name}" site:mql5.com/en/users`,
    `"${name}" site:fxblue.com/users`,
    `"${name}" site:instagram.com`,
    `"${name}" site:linkedin.com/in`,
    `"${name}" forex`,
    `"${name}" trading contact`
  ])).slice(0, Math.max(6, Math.min(Number(options.maxTrailQueries || 16), 24)));

  const related = [];
  const pages = [];
  const maxPages = Math.max(2, Math.min(Number(options.maxContactPages || 6), 8));
  for (const query of queries) {
    const { results } = await searchOne(query, current.sourceIntent || "specialist", Math.max(3, Math.min(Number(options.trailLimit || 6), 8)), ["yahoo", "bing-rss", "bing", "brave-html", "duckduckgo"]);
    for (const item of results) {
      if (!matchesIdentity(item, identity)) continue;
      related.push(item.url);
      if (pages.length < maxPages && canRead(item.url, current.url)) {
        const first = await readPage(item.url);
        pages.push(first);
        const follow = cleanLinks([...(first.websiteLinks || []), ...(first.contactLinks || [])], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => canRead(url, current.url)).slice(0, 2);
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
