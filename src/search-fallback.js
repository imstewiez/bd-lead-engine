import * as cheerio from "cheerio";
import { cleanSearchRedirect, domainOf, idForLead, normalizeWhitespace, platformFromUrl, safeUrl, stripHtml, titleFromUrl, unique } from "./utils.js";
import { fetchText, resultFrom } from "./search.js";

const SEARCH_ENGINES = ["bing-rss", "bing", "duckduckgo", "yahoo", "brave-html", "qwant", "google"];
const NON_TRADING_FOREX_DOMAINS = ["forex.se", "forex.no", "forex.fi", "forexvaluta.dk"];
const KNOWN_FALSE_POSITIVE_DOMAINS = ["kitco.com", "mambaby.com", "partnershiphp.org", "tipranks.com", "tradersunion.com", "latammediareport.com"];
const NON_TRADING_FOREX_NOISE = /växla|valuta|valutakurser|valutaomvandlare|reseförsäkring|skicka pengar|western union|kreditkort|travel money|currency exchange|exchange rates|money transfer|travel insurance|buy currency|sell currency/i;

function siteConstraint(query = "") {
  const match = String(query).match(/\bsite:([a-z0-9.-]+)((?:\/[^\s"]*)?)/i);
  if (!match) return null;
  return {
    domain: match[1].replace(/^www\./i, "").toLowerCase(),
    pathPrefix: String(match[2] || "").replace(/\/$/, "").toLowerCase()
  };
}

function matchesSiteConstraint(result, query) {
  const required = siteConstraint(query);
  if (!required?.domain) return true;
  const domain = domainOf(result.url);
  if (domain !== required.domain && !domain.endsWith(`.${required.domain}`)) return false;
  if (!required.pathPrefix) return true;
  try {
    const pathname = new URL(result.url).pathname.replace(/\/$/, "").toLowerCase();
    return pathname === required.pathPrefix || pathname.startsWith(`${required.pathPrefix}/`);
  } catch {
    return false;
  }
}

function cleanTitle(raw = "", url = "") {
  const title = normalizeWhitespace(stripHtml(raw || ""))
    .replace(/^(?:https?:\/\/)?(?:www\.)?[^\s]+\s*/i, "")
    .replace(/^[›|:;,-\s]+/, "");
  return title || titleFromUrl(url);
}

function parseAnchors(html, query, intent, source) {
  const $ = cheerio.load(html, { xmlMode: source === "bing-rss" });
  const results = [];

  if (source === "bing-rss") {
    $("item").each((_, element) => {
      const item = $(element);
      const url = cleanSearchRedirect(item.find("link").first().text());
      const title = item.find("title").first().text();
      const snippet = item.find("description").first().text();
      const result = resultFrom(url, title, snippet, source, query, intent);
      if (result) results.push(result);
    });
    return results;
  }

  if (source === "bing") {
    $("li.b_algo").each((_, element) => {
      const link = $(element).find("h2 a").first();
      const url = cleanSearchRedirect(link.attr("href"));
      const title = link.text();
      const snippet = $(element).find(".b_caption p").first().text() || $(element).text();
      const result = resultFrom(url, title, snippet, source, query, intent);
      if (result) results.push(result);
    });
  }

  $("a[href]").each((_, element) => {
    const link = $(element);
    const rawHref = link.attr("href");
    let url = cleanSearchRedirect(rawHref);
    if (!url && rawHref?.startsWith("/url?")) url = cleanSearchRedirect(`https://www.google.com${rawHref}`);
    if (!url) return;
    const domain = domainOf(url);
    if (/google\.|gstatic|bing\.|microsoft\.|yahoo\.|duckduckgo\.|brave\.|qwant\.|schema\.org/.test(domain)) return;
    const title = cleanTitle(link.text(), url);
    if (!title || title.length < 5) return;
    const snippet = normalizeWhitespace(link.closest("li, div, article, section").text()).replace(title, "");
    const result = resultFrom(url, title, snippet, source, query, intent);
    if (result) results.push(result);
  });

  const decoded = html
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
  const urlMatches = decoded.match(/https?:\/\/[^"'<>)\s\\]+/gi) || [];
  for (const match of urlMatches) {
    const url = cleanSearchRedirect(match.replace(/[.,;]+$/, ""));
    if (!url) continue;
    const domain = domainOf(url);
    if (/google\.|gstatic|bing\.|microsoft\.|yahoo\.|duckduckgo\.|brave\.|qwant\.|schema\.org/.test(domain)) continue;
    const result = resultFrom(url, titleFromUrl(url), `Extracted candidate for ${query}`, source, query, intent);
    if (result) results.push(result);
  }

  return results;
}

function searchUrl(engine, query, limit) {
  if (engine === "bing-rss") return `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  if (engine === "bing") return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}&cc=US&setlang=en-US&ensearch=1`;
  if (engine === "yahoo") return `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  if (engine === "brave-html") return `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  if (engine === "qwant") return `https://www.qwant.com/?q=${encodeURIComponent(query)}&t=web`;
  if (engine === "google") return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}&hl=en`;
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

function isKnownFalsePositive(result = {}) {
  const domain = domainOf(result.url || "");
  if (KNOWN_FALSE_POSITIVE_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return true;
  try {
    const parsed = new URL(result.url || "");
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
    if (/^(?:[a-z]{2}\.)?tradingview\.com$/.test(host) && (!path || path === "")) return true;
    if (/^(?:www\.)?tradingview\.com$/.test(host) && /^\/(?:markets|chart|symbols)(?:\/|$)/i.test(parsed.pathname)) return true;
  } catch {}
  return false;
}

function isNonTradingForexNoise(result = {}) {
  const domain = domainOf(result.url || "");
  if (NON_TRADING_FOREX_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return true;
  const text = `${result.title} ${result.snippet} ${result.url}`;
  return /\bforex\b/i.test(text) && NON_TRADING_FOREX_NOISE.test(text) && !/forex trading|forex trader|cfd trading|xauusd|copy trading|pamm|\bmam\b|introducing broker|forex affiliate|signals/i.test(text);
}

function junk(result) {
  if (isKnownFalsePositive(result)) return true;
  if (isNonTradingForexNoise(result)) return true;
  const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return /cache\.aspx|press release|newswire|top\s*\d+\s+forex|best\s+forex\s+(?:educators|mentors)|w3\.org|schema\.org|xmlns|xhtml|wikipedia|dictionary|definition|investopedia|marketwatch|ishares|msci|weather|currency exchange|google maps|tripadvisor|computational fluid dynamics|forex\.com\/?$/.test(text);
}

function hasLeadSignal(result, query) {
  const text = `${result.title} ${result.snippet} ${result.url} ${query}`.toLowerCase();
  return /forex|\bfx\b|xauusd|gold trader|trading|trader|broker|cfd|cfds|pamm|\bmam\b|copy trading|signals|sinais|señales|telegram|whatsapp|discord|linkedin|instagram|myfxbook|mql5|tradingview|introducing broker|affiliate|partnership|academy|mentor|fund manager|portfolio manager|asset manager|prop firm|funded trader|business development/.test(text);
}

function platformBoost(result) {
  const url = String(result.url || "").toLowerCase();
  if (/linkedin\.com\/in|linkedin\.com\/company|instagram\.com\/[^/]+|x\.com\/[^/]+|twitter\.com\/[^/]+|t\.me\/[^/]+|discord\.gg\/[^/]+|myfxbook\.com|mql5\.com|tradingview\.com\/u\//.test(url)) return true;
  return false;
}

function isSyntheticResult(result = {}) {
  return /^Extracted candidate for/i.test(String(result.snippet || ""));
}

function hasActualLeadSignal(result) {
  const text = `${result.title} ${isSyntheticResult(result) ? "" : result.snippet} ${result.url}`.toLowerCase();
  return /forex|\bfx\b|xauusd|gold trader|trading|trader|broker|cfd|cfds|pamm|\bmam\b|copy trading|signals|sinais|senales|telegram|whatsapp|discord|linkedin|instagram|myfxbook|mql5|tradingview\.com\/u\/|introducing broker|affiliate|partnership|academy|mentor|fund manager|portfolio manager|asset manager|prop firm|funded trader|business development/.test(text);
}

async function runEngine(engine, query, intent, limit) {
  try {
    const html = await fetchText(searchUrl(engine, query, limit), 14000);
    return { results: parseAnchors(html, query, intent, engine), errors: [] };
  } catch (error) {
    return { results: [], errors: [`${engine}: ${error.message}`] };
  }
}

export async function searchOne(query, intent = "partner", limit = 10) {
  const engines = SEARCH_ENGINES;
  const providers = await Promise.all(engines.map((engine) => runEngine(engine, query, intent, limit)));
  const errors = providers.flatMap((provider) => provider.errors);
  const all = providers.flatMap((provider) => provider.results);
  const seen = new Set();
  const candidates = [];

  for (const result of all) {
    if (!matchesSiteConstraint(result, query)) continue;
    if (junk(result)) continue;
    if (!hasActualLeadSignal(result) && !(platformBoost(result) && !isSyntheticResult(result))) continue;
    const key = result.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(result);
  }

  const strong = candidates.filter((result) => hasActualLeadSignal(result) || (platformBoost(result) && !isSyntheticResult(result)) || hasLeadSignal(result, query));
  return { results: unique(strong).slice(0, limit), errors };
}
