import * as cheerio from "cheerio";
import { cleanSearchRedirect, domainOf, normalizeWhitespace, safeUrl, sleep, stripHtml, titleFromUrl, unique } from "./utils.js";
import { fetchText, resultFrom } from "./search.js";

const DEFAULT_SEARCH_ENGINES = ["bing-rss", "yahoo", "bing", "duckduckgo", "brave-html", "qwant", "google", "mojeek"];
const RETRY_SEARCH_ENGINES = ["bing-rss", "yahoo", "bing", "duckduckgo", "brave-html", "mojeek"];
const NON_TRADING_FOREX_DOMAINS = ["forex.se", "forex.no", "forex.fi", "forexvaluta.dk"];
const KNOWN_FALSE_POSITIVE_DOMAINS = ["kitco.com", "mambaby.com", "partnershiphp.org", "tipranks.com", "tradersunion.com", "latammediareport.com"];
const NON_TRADING_FOREX_NOISE = /växla|valuta|valutakurser|valutaomvandlare|reseförsäkring|skicka pengar|western union|kreditkort|travel money|currency exchange|exchange rates|money transfer|travel insurance|buy currency|sell currency/i;

function engineList() {
  const configured = String(process.env.SEARCH_FALLBACK_ENGINES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? unique(configured) : DEFAULT_SEARCH_ENGINES;
}

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
    .replace(/^[›|:;,\-\s]+/, "");
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
    if (/google\.|gstatic|bing\.|microsoft\.|yahoo\.|duckduckgo\.|brave\.|qwant\.|mojeek\.|schema\.org/.test(domain)) return;
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
    if (/google\.|gstatic|bing\.|microsoft\.|yahoo\.|duckduckgo\.|brave\.|qwant\.|mojeek\.|schema\.org/.test(domain)) continue;
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
  if (engine === "mojeek") return `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

function isKnownFalsePositive(result = {}) {
  const domain = domainOf(result.url || "");
  if (KNOWN_FALSE_POSITIVE_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return true;
  try {
    const parsed = new URL(result.url || "");
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
    if (/^(?:[a-z]{2}\.)?tradingview\.com$/.test(host)) return true;
    if (/^(?:www\.)?tradingview\.com$/.test(host) && /^\/(?:u|ideas|markets|chart|symbols|scripts)(?:\/|$)/i.test(parsed.pathname)) return true;
    if (!path && /^(?:www\.)?(?:linkedin\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com)$/.test(host)) return true;
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
  return /tradingview\.com|cache\.aspx|press release|newswire|top\s*\d+\s+forex|best\s+forex\s+(?:educators|mentors)|w3\.org|schema\.org|xmlns|xhtml|wikipedia|dictionary|definition|investopedia|marketwatch|ishares|msci|weather|currency exchange|google maps|tripadvisor|computational fluid dynamics|forex\.com\/?$/.test(text);
}

function hasLeadSignal(result, query) {
  const text = `${result.title} ${result.snippet} ${result.url} ${query}`.toLowerCase();
  return /forex|\bfx\b|xauusd|gold trader|trading|trader|broker|cfd|cfds|pamm|\bmam\b|copy trading|signals|sinais|señales|telegram|whatsapp|discord|linkedin|instagram|myfxbook|mql5|introducing broker|affiliate|partnership|academy|mentor|fund manager|portfolio manager|asset manager|prop firm|funded trader|business development|attending|visitor|delegate|speaker|panelist/.test(text);
}

function platformBoost(result) {
  const url = String(result.url || "").toLowerCase();
  if (/linkedin\.com\/in|linkedin\.com\/company|instagram\.com\/[^/]+|x\.com\/[^/]+|twitter\.com\/[^/]+|t\.me\/[^/]+|discord\.gg\/[^/]+|myfxbook\.com|mql5\.com|fxblue\.com|zulutrade\.com|darwinex\.com|signalstart\.com/.test(url)) return true;
  return false;
}

function isSyntheticResult(result = {}) {
  return /^Extracted candidate for/i.test(String(result.snippet || ""));
}

function hasActualLeadSignal(result) {
  const text = `${result.title} ${isSyntheticResult(result) ? "" : result.snippet} ${result.url}`.toLowerCase();
  return /forex|\bfx\b|xauusd|gold trader|trading|trader|broker|cfd|cfds|pamm|\bmam\b|copy trading|signals|sinais|senales|telegram|whatsapp|discord|linkedin|instagram|myfxbook|mql5|introducing broker|affiliate|partnership|academy|mentor|fund manager|portfolio manager|asset manager|prop firm|funded trader|business development|attending|visitor|delegate|speaker|panelist/.test(text);
}

async function runEngine(engine, query, intent, limit) {
  try {
    const html = await fetchText(searchUrl(engine, query, limit), 18000);
    return { results: parseAnchors(html, query, intent, engine), errors: [] };
  } catch (error) {
    const message = String(error.message || "");
    if (/abort|timeout|fetch failed|ECONNRESET|ETIMEDOUT|HTTP 429|HTTP 403/i.test(message)) {
      await sleep(700);
      try {
        const html = await fetchText(searchUrl(engine, query, limit), 26000);
        return { results: parseAnchors(html, query, intent, engine), errors: [] };
      } catch (retryError) {
        return { results: [], errors: [`${engine}: ${retryError.message}`] };
      }
    }
    return { results: [], errors: [`${engine}: ${error.message}`] };
  }
}

function relaxedQueryText(query = "") {
  return normalizeWhitespace(
    String(query)
      .replace(/\bsite:[a-z0-9.-]+(?:\/[^\s"]*)?/gi, "")
      .replace(/[“”]/g, "\"")
      .trim()
  );
}

function queryVariants(query = "") {
  const original = normalizeWhitespace(query);
  const variants = [original];
  const required = siteConstraint(original);
  const relaxed = relaxedQueryText(original);

  if (required?.domain) {
    const sitePath = `${required.domain}${required.pathPrefix || ""}`.replace(/\/$/, "");
    if (relaxed) variants.push(`"${sitePath}" ${relaxed}`);
    if (required.domain === "x.com") variants.push(original.replace(/site:x\.com/i, "site:twitter.com"));
    if (required.domain === "twitter.com") variants.push(original.replace(/site:twitter\.com/i, "site:x.com"));
    if (required.domain === "linkedin.com" && required.pathPrefix.startsWith("/in")) variants.push(`"linkedin.com/in" ${relaxed}`);
    if (required.domain === "linkedin.com" && required.pathPrefix.startsWith("/company")) variants.push(`"linkedin.com/company" ${relaxed}`);
    if (required.domain === "instagram.com") variants.push(`"instagram.com" ${relaxed}`);
    if (required.domain === "t.me") variants.push(original.replace(/site:t\.me/i, "site:telegram.me"));
    if (required.domain === "telegram.me") variants.push(original.replace(/site:telegram\.me/i, "site:t.me"));
    if (required.domain === "mql5.com") variants.push(`"mql5.com" ${relaxed}`);
    if (required.domain === "myfxbook.com") variants.push(`"myfxbook.com" ${relaxed}`);
  }

  if (relaxed && relaxed !== original) variants.push(relaxed);
  if (relaxed && /\b(?:forex|xauusd|trading|broker|affiliate|introducing broker)\b/i.test(relaxed)) {
    variants.push(`${relaxed} contact`);
    variants.push(`${relaxed} profile`);
  }

  return unique(variants.filter(Boolean)).slice(0, 5);
}

async function runSearchWave(engines, query, intent, limit) {
  const providers = await Promise.all(engines.map((engine) => runEngine(engine, query, intent, limit)));
  return {
    results: providers.flatMap((provider) => provider.results),
    errors: providers.flatMap((provider) => provider.errors)
  };
}

function collectCandidates(rawResults, originalQuery, seen, candidates) {
  for (const result of rawResults) {
    if (!matchesSiteConstraint(result, originalQuery)) continue;
    if (junk(result)) continue;
    if (!hasActualLeadSignal(result) && !(platformBoost(result) && !isSyntheticResult(result))) continue;
    const key = result.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(result);
  }
}

export async function searchOne(query, intent = "partner", limit = 10) {
  const engines = engineList();
  const seen = new Set();
  const candidates = [];
  const errors = [];

  const firstWave = await runSearchWave(engines, query, intent, limit);
  errors.push(...firstWave.errors);
  collectCandidates(firstWave.results, query, seen, candidates);

  if (candidates.length < limit) {
    const retryEngines = RETRY_SEARCH_ENGINES.filter((engine) => engines.includes(engine));
    for (const variant of queryVariants(query).filter((item) => item !== query)) {
      if (candidates.length >= limit * 2) break;
      const wave = await runSearchWave(retryEngines, variant, intent, limit);
      errors.push(...wave.errors.map((error) => `${error} [variant]`));
      collectCandidates(wave.results, query, seen, candidates);
      if (candidates.length >= limit) break;
    }
  }

  const strong = candidates.filter((result) => hasActualLeadSignal(result) || (platformBoost(result) && !isSyntheticResult(result)) || hasLeadSignal(result, query));
  return {
    results: unique(strong).slice(0, limit),
    errors: strong.length ? [] : unique(errors).slice(0, 12),
    providerWarnings: unique(errors).slice(0, 20)
  };
}
