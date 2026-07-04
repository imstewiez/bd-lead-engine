import * as cheerio from "cheerio";
import { PAGE_FETCH_DENYLIST, SEARCH_ENGINES } from "./config.js";
import { cleanEmails, cleanLinks } from "./contact-cleaner.js";
import { hasSearchableLeadSignal, isHardRejectedLead } from "./lead-quality.js";
import {
  cleanSearchRedirect,
  domainOf,
  idForLead,
  normalizeWhitespace,
  platformFromUrl,
  safeUrl,
  sleep,
  stripHtml,
  titleFromUrl,
  unique
} from "./utils.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export async function fetchHtml(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,es;q=0.8,pt;q=0.7"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml") && !contentType.includes("xml")) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    return {
      html: await response.text(),
      finalUrl: response.url || url,
      contentType
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchText(url, timeoutMs = 12000) {
  const page = await fetchHtml(url, timeoutMs);
  return page.html;
}

export async function resolveFinalUrl(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9,es;q=0.8,pt;q=0.7"
      },
      signal: controller.signal
    });
    return safeUrl(response.url || url) || safeUrl(url);
  } catch {
    return safeUrl(url);
  } finally {
    clearTimeout(timeout);
  }
}

export function resultFrom(url, title, snippet, source, query, intent) {
  const safe = safeUrl(url);
  if (!safe) return null;
  const cleanTitle = cleanResultTitle(stripHtml(title || titleFromUrl(safe)), safe);
  const cleanSnippet = normalizeWhitespace(stripHtml(snippet || ""));
  return {
    id: idForLead(safe, cleanTitle),
    source,
    sourceIntent: intent,
    query,
    url: safe,
    domain: domainOf(safe),
    platform: platformFromUrl(safe),
    title: cleanTitle,
    name: cleanTitle,
    snippet: cleanSnippet
  };
}

function isPlatformCandidateUrl(url = "") {
  const domain = domainOf(url);
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();
    const second = (parts[1] || "").toLowerCase();
    if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) {
      return ["in", "company", "posts"].includes(first) || (first === "feed" && second === "update");
    }
    if (domain === "instagram.com" || domain.endsWith(".instagram.com")) {
      return Boolean(first) && !["p", "reel", "reels", "stories", "explore", "accounts", "about", "privacy", "terms"].includes(first);
    }
    if (domain === "x.com" || domain === "twitter.com") {
      return Boolean(first) && !["i", "share", "intent", "search", "home", "tos", "privacy", "settings", "en", "about", "hashtag"].includes(first);
    }
    if (domain === "tiktok.com" || domain.endsWith(".tiktok.com")) return /^\/@[^/]+\/?$/i.test(parsed.pathname);
    if (domain === "threads.net" || domain.endsWith(".threads.net")) return Boolean(first) && !["privacy", "terms", "login"].includes(first);
    if (domain === "facebook.com" || domain.endsWith(".facebook.com")) return Boolean(first) && !["share", "privacy", "terms", "marketplace", "watch", "reel"].includes(first);
    if (domain === "t.me" || domain === "telegram.me") return Boolean(first) && !["share", "iv", "proxy"].includes(first);
    if (domain === "discord.gg") return Boolean(first);
    if (domain === "discord.com") return first === "invite" && Boolean(second);
    if (domain === "disboard.org" || domain.endsWith(".disboard.org")) return first === "server" && Boolean(second);
    if (domain === "tradingview.com" || domain.endsWith(".tradingview.com")) return first === "u" || first === "ideas";
    if (domain === "myfxbook.com" || domain.endsWith(".myfxbook.com")) return ["members", "portfolio", "community"].includes(first);
    if (domain === "mql5.com" || domain.endsWith(".mql5.com")) return first === "en" && ["signals", "users", "forum", "market"].includes(second);
    if (domain === "fxblue.com" || domain.endsWith(".fxblue.com")) return first === "users";
    if (domain === "zulutrade.com" || domain.endsWith(".zulutrade.com")) return first === "trader";
    if (domain === "darwinex.com" || domain.endsWith(".darwinex.com")) return first === "darwin";
    if (domain === "signalstart.com" || domain.endsWith(".signalstart.com")) return first === "analysis";
    if (domain === "collective2.com" || domain.endsWith(".collective2.com")) return true;
    if (domain === "opencorporates.com") {
      return first === "companies" && Boolean(second) && second !== "search" && parts.length >= 3;
    }
    if (
      domain.includes("company-information.service.gov.uk") ||
      domain === "adviserinfo.sec.gov" ||
      domain === "register.fca.org.uk" ||
      domain.endsWith(".cvm.gov.br") ||
      domain.endsWith(".cnmv.es") ||
      domain.endsWith(".cmfchile.cl") ||
      domain.endsWith(".superfinanciera.gov.co")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function queryHasLeadIntent(query = "") {
  const lower = String(query).toLowerCase();
  return (
    /\b(?:forex|fx|xauusd|gold trader|trading|trader|broker|corretora|divisas|cfd|cfds|pamm|mam|copy trading|signals?|sinais|senales|señales|investment adviser|fund manager|portfolio manager|asset management)\b/i.test(lower) &&
    /\b(?:introducing broker|ib|affiliate|cpa|revenue share|partner|partnership|broker|mentor|academy|signals?|community|whatsapp|telegram|discord|founder|owner|ceo|manager|director|adviser|investment|company registration|shareholder|beneficial owner|gestor|consultor|trader)\b/i.test(lower)
  );
}

function isRelevantResult(result, intent) {
  const contentText = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const queryText = String(result.query || "").toLowerCase();
  const platformCandidate = isPlatformCandidateUrl(result.url);
  const text = platformCandidate && queryHasLeadIntent(queryText) ? `${contentText} ${queryText}` : contentText;
  const urlText = String(result.url || "").toLowerCase();
  if (isHardRejectedLead(result)) return false;
  if (
    /qwant\.com\/?|qwantjunior\.com|about\.qwant\.com|help\.qwant\.com|instagram\.com\/?(?:$|\?|#)|instagram\.com\/instagram\/?|instagram\.com\/p\/signin|about\.instagram\.com|facebook\.com\/instagram\/?|linkedin\.com\/?(?:$|\?|#)|linkedin\.com\/company\/linkedin\/?|x\.com\/?(?:$|\?|#)|x\.com\/explore\/?|twitter\.com\/?(?:$|\?|#)|twitter\.com\/explore\/?|tiktok\.com\/?(?:$|\?|#)|reddit\.com\/?(?:$|\?|#)|forex\.com\/?(?:en\/?)?$/.test(
      urlText
    )
  ) {
    return false;
  }
  const junkTerms = [
    "bbc bitesize",
    "food group",
    "burj khalifa",
    "google maps",
    "apple maps",
    "tripadvisor",
    "wikipedia",
    "qwant",
    "murena",
    "lilo org",
    "lilo.org",
    "dictionary",
    "definition",
    "pronunciation",
    "usage notes",
    "oxfordlearnersdictionaries",
    "merriam-webster",
    "cambridge dictionary",
    "collins dictionary",
    "vocabulary.com",
    "thesaurus",
    "academia.edu",
    "academia residence",
    "select your room",
    "bergamo-it.com",
    "italia.it",
    "what to see",
    "cursor: ai coding",
    "learn cursor",
    "udemy",
    "fundacao bradesco",
    "fundação bradesco",
    "escola virtual",
    "sebrae",
    "edutin",
    "cursos online",
    "curso online",
    "romanian academy",
    "barça academy",
    "barca academy",
    "bloomberg",
    "reuters",
    "cnbc",
    "mining weekly",
    "miningweekly",
    "focus-economics",
    "yahoo finance",
    "equity research",
    "investment banking",
    "credit analyst",
    "fixed income analyst",
    "bank analyst",
    "chief economist",
    "macroeconomist",
    "weather",
    "fxstreet",
    "currency exchange rates",
    "international money transfers",
    "how to start forex trading",
    "how to start trading",
    "step-by-step beginner",
    "trading simulator",
    "practice day trading",
    "track all markets",
    "investing.com",
    "investopedia",
    "interactive brokers",
    "ishares",
    "marketwatch",
    "etf",
    "msci",
    "quality factor etf",
    "cheyenne frontier days",
    "frontier days",
    "computational fluid dynamics"
  ];
  if (junkTerms.some((term) => contentText.includes(term))) return false;
  if (/\bacademia\b/.test(contentText) && !/forex|fx |trading|trader|broker|invest|financial|financ|curso|course|educacion|educacao|mentor|signals|community|comunidad|comunidade/.test(text)) {
    return false;
  }
  if (/\b(curso|cursos|course|courses|academy|academia|school|escola|universidad|university)\b/.test(contentText) && !/forex|fx |xauusd|gold|trading|trader|broker|corretora|copy trading|signals|sinais|señales|senales|invest|financial|financ/.test(text)) {
    return false;
  }
  if (/\b(analyst|economist|research|bank|banco|finance news|market news)\b/.test(contentText) && !/forex trader|fx trader|xauusd|gold trader|portfolio manager|fund manager|asset manager|copy trading|pamm|mam|introducing broker|affiliate|investment adviser/.test(text)) {
    return false;
  }
  if (["social", "forum", "specialist", "intent"].includes(intent) && !hasSearchableLeadSignal(result)) {
    if (!(platformCandidate && queryHasLeadIntent(queryText))) return false;
  }
  if (intent === "partner" && !hasSearchableLeadSignal(result) && !/forex expo|trading expo|money expo|traders fair|asset management|wealth management|family office|investment fund|fund manager|portfolio manager|hedge fund|fintech|payments/i.test(text)) {
    return false;
  }
  if (intent !== "forum" && intent !== "intent" && intent !== "social") {
    if (text.includes("forex factory")) return false;
    if (/tradingview\.com\/?(?:chart\/?)?(?:\s|$)/.test(text)) return false;
  }

  const commonTerms = [
    "forex",
    "fx ",
    "trading",
    "trader",
    "broker",
    "brokers",
    "brokerage",
    "corretora",
    "corretoras",
    "cfd",
    "cfds",
    "affiliate",
    "introducing broker",
    "financial education",
    "investment",
    "investing",
    "asset management",
    "wealth management",
    "family office",
    "investment fund",
    "fund manager",
    "portfolio manager",
    "hedge fund",
    "prop trading",
    "prop firm",
    "funded trader",
    "funded trading",
    "trading desk",
    "forex expo",
    "trading expo",
    "money expo",
    "traders fair",
    "conference",
    "summit",
    "exhibitor",
    "speaker",
    "sponsor",
    "academy",
    "academia",
    "curso",
    "financial education",
    "fintech",
    "payments",
    "copy trading",
    "linkedin",
    "instagram",
    "twitter",
    "x.com",
    "reddit",
    "forum",
    "forexfactory",
    "babypips",
    "tradingview",
    "myfxbook",
    "mql5",
    "fxblue",
    "zulutrade",
    "darwinex",
    "signalstart",
    "collective2",
    "facebook",
    "tiktok",
    "threads",
    "telegram",
    "discord",
    "investment adviser",
    "company registration",
    "shareholder",
    "beneficial owner",
    "which broker",
    "recommend broker",
    "best broker",
    "looking for broker",
    "procuro corretora",
    "busco broker"
  ];
  const recruitmentTerms = [
    "business development",
    "partnership",
    "affiliate manager",
    "country manager",
    "regional manager",
    "sales manager",
    "exness",
    "xm",
    "octa",
    "fbs",
    "hfm",
    "tickmill",
    "pepperstone",
    "deriv",
    "avatrade"
  ];
  const partnerTerms = [
    "introducing broker",
    "forex affiliate",
    "affiliate program",
    "trading academy",
    "forex signals",
    "telegram",
    "discord",
    "youtube",
    "community",
    "educator",
    "exhibitor",
    "speaker",
    "sponsor",
    "expo",
    "summit",
    "asset management",
    "wealth management",
    "family office",
    "investment fund",
    "fund manager",
    "portfolio manager",
    "prop firm",
    "funded trader",
    "trading academy",
    "financial education",
    "which broker",
    "recommend broker",
    "best broker",
    "looking for broker",
    "procuro corretora",
    "busco broker",
    "corretora"
  ];
  const ecosystemTerms = [
    "forex expo",
    "trading expo",
    "money expo",
    "traders fair",
    "finance magnates",
    "ifx expo",
    "forex expo dubai",
    "wiki finance expo",
    "smart vision investment expo",
    "expo trading",
    "conference",
    "summit",
    "exhibitor",
    "exhibitors",
    "speaker",
    "speakers",
    "sponsor",
    "sponsors",
    "attendee",
    "attendees",
    "asset management",
    "wealth management",
    "family office",
    "investment fund",
    "fund manager",
    "portfolio manager",
    "hedge fund",
    "gestora de recursos",
    "gestor de inversiones",
    "administradora de fondos",
    "investment adviser",
    "prop firm",
    "proprietary trading",
    "funded trader",
    "funded trading",
    "trading desk",
    "pamm",
    "mam account",
    "trading academy",
    "forex academy",
    "financial education",
    "educacion financiera",
    "educacao financeira",
    "fintech",
    "payments",
    "meetup",
    "community manager"
  ];
  const ecosystemDomains = [
    "ifxexpo.com",
    "forexexpo.com",
    "moneyexpo.com",
    "tradersfair.com",
    "financemagnates.com",
    "events.financemagnates.com",
    "wikifinanceexpo.com",
    "smartvisioninvestmentexpo.com",
    "adviserinfo.sec.gov",
    "sec.gov",
    "register.fca.org.uk",
    "fca.org.uk",
    "cvm.gov.br",
    "cadastro.cvm.gov.br",
    "gov.br",
    "cnmv.es",
    "cmfchile.cl",
    "superfinanciera.gov.co",
    "asic.gov.au",
    "mas.gov.sg",
    "sfc.hk",
    "dfsa.ae",
    "adgm.com",
    "opencorporates.com",
    "company-information.service.gov.uk",
    "companieshouse.gov.uk"
  ];
  const socialTerms = [
    "linkedin.com/in",
    "linkedin.com/posts",
    "linkedin.com/feed/update",
    "linkedin.com/company",
    "instagram.com",
    "x.com",
    "twitter.com",
    "facebook.com",
    "tiktok.com",
    "threads.net",
    "linktr.ee",
    "beacons.ai",
    "bio.link",
    "allmylinks.com",
    "t.me",
    "discord.gg",
    "discord.com",
    "disboard.org",
    "trading educator",
    "forex trader",
    "trading community",
    "signals",
    "mentor",
    "academy",
    "whatsapp",
    "telegram"
  ];
  const forumTerms = [
    "reddit.com/r/forex",
    "reddit.com/r/daytrading",
    "reddit.com/r/algotrading",
    "forexfactory.com",
    "babypips.com",
    "tradingview.com/u",
    "tradingview.com/ideas",
    "elite trader",
    "forum",
    "thread",
    "which broker",
    "recommend broker",
    "best broker",
    "broker recommendation",
    "looking for broker",
    "procuro corretora",
    "busco broker"
  ];
  const specialistTerms = [
    "myfxbook.com",
    "mql5.com",
    "fxblue.com",
    "zulutrade.com",
    "darwinex.com",
    "signalstart.com",
    "collective2.com",
    "forexpeacearmy.com",
    "earnforex.com",
    "forex-station.com",
    "trade2win.com",
    "elitetrader.com",
    "pamm",
    "mam account",
    "copy trading",
    "signals",
    "xauusd",
    "gold trader",
    "money manager",
    "fund manager",
    "portfolio manager",
    "investment adviser",
    "company registration",
    "shareholder",
    "beneficial owner",
    "introducing broker",
    "affiliate",
    "cpa",
    "revenue share"
  ];

  const hasCommon = commonTerms.some((term) => text.includes(term));
  if (!hasCommon) return false;
  if (intent === "social") return socialTerms.some((term) => text.includes(term));
  if (intent === "forum") return forumTerms.some((term) => text.includes(term));
  if (intent === "specialist") return specialistTerms.some((term) => text.includes(term));
  if (intent === "recruitment") return recruitmentTerms.some((term) => text.includes(term)) || text.includes("linkedin.com/in");
  if (intent === "ecosystem") {
    const domain = domainOf(result.url);
    return (
      ecosystemTerms.some((term) => text.includes(term)) ||
      ecosystemDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))
    );
  }
  return partnerTerms.some((term) => text.includes(term)) || hasCommon;
}

function siteConstraint(query = "") {
  const match = String(query).match(/\bsite:([a-z0-9.-]+)((?:\/[^\s"]*)?)/i);
  if (!match) return null;
  return {
    domain: match[1].replace(/^www\./i, "").toLowerCase(),
    pathPrefix: String(match[2] || "").replace(/\/$/, "").toLowerCase()
  };
}

function siteConstraintDomain(query = "") {
  return siteConstraint(query)?.domain || "";
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

function parseDuckDuckGo(html, query, intent) {
  const $ = cheerio.load(html);
  const results = [];
  $(".result, .web-result, .result__body").each((_, element) => {
    const link = $(element).find("a.result__a, .result__title a, a").first();
    const rawHref = link.attr("href");
    const url = cleanSearchRedirect(rawHref);
    const title = link.text();
    const snippet = $(element).find(".result__snippet, .result__extras__url").first().text() || $(element).text();
    const result = resultFrom(url, title, snippet, "duckduckgo", query, intent);
    if (result) results.push(result);
  });
  return results;
}

function parseBing(html, query, intent) {
  const $ = cheerio.load(html);
  const results = [];
  $("li.b_algo").each((_, element) => {
    const link = $(element).find("h2 a").first();
    const url = cleanSearchRedirect(link.attr("href"));
    const title = link.text();
    const snippet = $(element).find(".b_caption p").first().text() || $(element).text();
    const result = resultFrom(url, title, snippet, "bing", query, intent);
    if (result) results.push(result);
  });
  return results;
}

function parseBingRss(xml, query, intent) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const results = [];
  $("item").each((_, element) => {
    const item = $(element);
    const url = cleanSearchRedirect(item.find("link").first().text());
    const title = item.find("title").first().text();
    const snippet = item.find("description").first().text();
    const result = resultFrom(url, title, snippet, "bing-rss", query, intent);
    if (result) results.push(result);
  });
  return results;
}

export function cleanResultTitle(rawTitle = "", url = "") {
  let title = normalizeWhitespace(rawTitle);
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const tail = decodeURIComponent(parts[parts.length - 1] || "");
    if (tail && tail.length >= 4) {
      const index = title.toLowerCase().lastIndexOf(tail.toLowerCase());
      if (index >= 0 && index + tail.length < title.length) {
        title = title.slice(index + tail.length);
      }
    }
  } catch {
    // Keep original title.
  }
  title = title
    .replace(/^(?:[a-z.]+)?https?:\/\/[^\s]+(?:\s*›\s*[^A-Z#@]*)*/i, "")
    .replace(/^(?:members|signals|posts|pulse|in|r|u|companies)\s*›\s*[^A-Z#@]*/i, "")
    .replace(/^(?:linkedin|instagram|myfxbook|mql5|telegram|t\.me|opencorporates|tiktok|x|twitter|facebook)\s*/i, "")
    .replace(/^[›|:;,\-\s]+/, "");
  return normalizeWhitespace(title) || titleFromUrl(url);
}

function parseYahoo(html, query, intent) {
  const $ = cheerio.load(html);
  const results = [];
  $("a[href]").each((_, element) => {
    const link = $(element);
    const rawHref = link.attr("href");
    const url = cleanSearchRedirect(rawHref);
    if (!url) return;
    const domain = domainOf(url);
    if (domain.includes("yahoo.") || domain.includes("bing.") || domain.includes("microsoft.")) return;
    const title = cleanResultTitle(link.text(), url);
    if (!title || title.length < 10) return;
    const container = link.closest("li, div");
    const snippet = normalizeWhitespace(container.text()).replace(title, "");
    const result = resultFrom(url, title, snippet, "yahoo", query, intent);
    if (result) results.push(result);
  });
  return results;
}

function parseBraveHtml(html, query, intent) {
  const $ = cheerio.load(html);
  const results = [];
  $("a[href]").each((_, element) => {
    const link = $(element);
    const url = cleanSearchRedirect(link.attr("href"));
    if (!url) return;
    const domain = domainOf(url);
    if (domain.includes("brave.") || domain.includes("search.brave.") || domain.includes("bravecdn.")) return;
    const title = cleanResultTitle(link.text(), url);
    if (!title || title.length < 8) return;
    const snippet = normalizeWhitespace(link.closest("div, article, section").text()).replace(title, "");
    const result = resultFrom(url, title, snippet, "brave-html", query, intent);
    if (result) results.push(result);
  });
  return results;
}

function parseQwant(html, query, intent) {
  const $ = cheerio.load(html);
  const results = [];
  $("a[href]").each((_, element) => {
    const link = $(element);
    const url = cleanSearchRedirect(link.attr("href"));
    if (!url) return;
    const title = normalizeWhitespace(link.text()) || titleFromUrl(url);
    const result = resultFrom(url, title, `Qwant web result for ${query}`, "qwant", query, intent);
    if (result) results.push(result);
  });

  const decodedHtml = html
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
  const matches = decodedHtml.match(/https?:\/\/[^"'<>\s)\\]+/gi) || [];
  for (const match of matches) {
    const url = cleanSearchRedirect(match.replace(/[.,;]+$/, ""));
    if (!url) continue;
    const result = resultFrom(url, titleFromUrl(url), `Qwant extracted URL for ${query}`, "qwant", query, intent);
    if (result) results.push(result);
  }
  return results;
}

function parseGoogle(html, query, intent) {
  const $ = cheerio.load(html);
  const results = [];
  $("a[href]").each((_, element) => {
    const link = $(element);
    const rawHref = link.attr("href");
    let url = cleanSearchRedirect(rawHref);
    if (!url && rawHref?.startsWith("/url?")) {
      url = cleanSearchRedirect(`https://www.google.com${rawHref}`);
    }
    if (!url) return;
    const domain = domainOf(url);
    if (domain.includes("google.") || domain.includes("gstatic.") || domain.includes("webcache")) return;
    const title = normalizeWhitespace(link.text());
    if (!title || title.length < 8) return;
    const container = link.closest("div");
    const snippet = normalizeWhitespace(container.text()).replace(title, "");
    const result = resultFrom(url, title, snippet, "google", query, intent);
    if (result) results.push(result);
  });

  const decodedHtml = html
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\x3d/g, "=")
    .replace(/\\x26/g, "&");
  const urlPatterns = [
    /\/url\?q=(https?:\/\/[^&"'<\s]+)/gi,
    /href="(https?:\/\/[^"'<\s]+)"/gi,
    /(https?:\/\/[a-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)/gi
  ];
  for (const pattern of urlPatterns) {
    let match;
    while ((match = pattern.exec(decodedHtml))) {
      const candidate = safeUrl(decodeURIComponent(match[1]));
      if (!candidate) continue;
      const domain = domainOf(candidate);
      if (
        domain.includes("google.") ||
        domain.includes("gstatic.") ||
        domain.includes("schema.org") ||
        domain.includes("w3.org")
      ) {
        continue;
      }
      const result = resultFrom(candidate, titleFromUrl(candidate), "", "google", query, intent);
      if (result) results.push(result);
    }
  }

  return results;
}

function parseYouTube(html, query, intent) {
  const channelHandles = unique([...html.matchAll(/"canonicalBaseUrl":"([^"]+)"/g)].map((match) => match[1]));
  const videoTitles = unique([...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]+)"/g)].map((match) => match[1]))
    .slice(0, 8)
    .join("; ");
  return channelHandles.slice(0, 20).map((handle) => {
    const url = `https://www.youtube.com${handle}`;
    const title = handle.replace(/^\/@?/, "@");
    return resultFrom(
      url,
      title,
      videoTitles ? `YouTube channel candidate. Related titles: ${videoTitles}` : "YouTube channel candidate.",
      "youtube",
      query,
      intent
    );
  }).filter(Boolean);
}

async function searchBrave(query, intent, limit) {
  if (!process.env.BRAVE_SEARCH_API_KEY) return { results: [], errors: [] };
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY
        }
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const results = (data.web?.results || [])
      .map((item) => resultFrom(item.url, item.title, item.description, "brave", query, intent))
      .filter(Boolean);
    return { results, errors: [] };
  } catch (error) {
    return { results: [], errors: [`brave: ${error.message}`] };
  }
}

async function searchSerpApi(query, intent, limit) {
  if (!process.env.SERPAPI_KEY) return { results: [], errors: [] };
  try {
    const response = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${Math.min(limit, 20)}&api_key=${encodeURIComponent(process.env.SERPAPI_KEY)}`
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const results = (data.organic_results || [])
      .map((item) => resultFrom(item.link, item.title, item.snippet, "serpapi", query, intent))
      .filter(Boolean);
    return { results, errors: [] };
  } catch (error) {
    return { results: [], errors: [`serpapi: ${error.message}`] };
  }
}

function shouldUseYouTubeEngine(query = "") {
  return /(?:site:youtube\.com|youtube\.com|youtu\.be|\byoutube\b)/i.test(String(query));
}

function enginesForQuery(query, intent, engines = SEARCH_ENGINES) {
  const broadIntent = ["intent", "social", "forum", "specialist", "ecosystem", "recruitment"].includes(intent);
  const base = broadIntent ? unique(["bing-rss", ...engines]) : unique([...engines]);
  const wantsYouTube = shouldUseYouTubeEngine(query) || base.includes("youtube");
  const withoutYouTube = base.filter((engine) => engine !== "youtube");
  return wantsYouTube ? unique([...withoutYouTube, "youtube"]) : withoutYouTube;
}

function searchUrlForEngine(engine, query, limit) {
  if (engine === "youtube") return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  if (engine === "yahoo") return `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  if (engine === "brave-html") return `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  if (engine === "bing-rss") return `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  if (engine === "qwant") return `https://www.qwant.com/?q=${encodeURIComponent(query)}&t=web`;
  if (engine === "google") return `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit, 10)}&hl=en`;
  if (engine === "bing") {
    return `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}&cc=US&setlang=en-US&ensearch=1`;
  }
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

function parseEngineResults(engine, html, query, intent) {
  if (engine === "youtube") return parseYouTube(html, query, intent);
  if (engine === "yahoo") return parseYahoo(html, query, intent);
  if (engine === "brave-html") return parseBraveHtml(html, query, intent);
  if (engine === "bing-rss") return parseBingRss(html, query, intent);
  if (engine === "qwant") return parseQwant(html, query, intent);
  if (engine === "google") return parseGoogle(html, query, intent);
  if (engine === "bing") return parseBing(html, query, intent);
  return parseDuckDuckGo(html, query, intent);
}

async function runSearchEngine(engine, query, intent, limit) {
  try {
    const html = await fetchText(searchUrlForEngine(engine, query, limit), 14000);
    return {
      results: parseEngineResults(engine, html, query, intent),
      errors: []
    };
  } catch (error) {
    return { results: [], errors: [`${engine}: ${error.message}`] };
  }
}

function preferredPlatforms(intent) {
  if (intent === "social") {
    return [
      "LinkedIn",
      "Instagram",
      "X/Twitter",
      "TikTok",
      "Telegram",
      "Discord",
      "Threads",
      "Facebook",
      "Link Hub",
      "Reddit",
      "YouTube",
      "Web"
    ];
  }
  if (intent === "specialist" || intent === "forum") {
    return [
      "Myfxbook",
      "MQL5",
      "FXBlue",
      "ZuluTrade",
      "Darwinex",
      "SignalStart",
      "Collective2",
      "TradingView",
      "ForexFactory",
      "BabyPips",
      "Reddit",
      "Telegram",
      "Discord",
      "Web"
    ];
  }
  if (intent === "ecosystem") {
    return ["Regulatory Registry", "Company Registry", "LinkedIn", "Web", "Myfxbook", "MQL5", "Instagram", "X/Twitter"];
  }
  if (intent === "recruitment") return ["LinkedIn", "Web", "X/Twitter", "Instagram"];
  if (intent === "intent") return ["LinkedIn", "X/Twitter", "Reddit", "TradingView", "ForexFactory", "Telegram", "Web"];
  return ["LinkedIn", "Instagram", "Myfxbook", "MQL5", "X/Twitter", "Telegram", "Discord", "Web", "YouTube"];
}

function platformForResult(result) {
  return result.platform || platformFromUrl(result.url) || result.source || "Web";
}

function diversifyResults(results, limit, query, intent) {
  const requiredDomain = siteConstraintDomain(query);
  const order = preferredPlatforms(intent);
  const rank = (platform) => {
    const index = order.indexOf(platform);
    return index === -1 ? order.length + 1 : index;
  };
  const ordered = results
    .map((result, index) => ({ result, index, platform: platformForResult(result) }))
    .sort((a, b) => rank(a.platform) - rank(b.platform) || a.index - b.index);

  if (requiredDomain) return ordered.slice(0, limit).map((item) => item.result);

  const buckets = new Map();
  for (const item of ordered) {
    if (!buckets.has(item.platform)) buckets.set(item.platform, []);
    buckets.get(item.platform).push(item);
  }

  const platforms = [...buckets.keys()].sort((a, b) => rank(a) - rank(b));
  const selected = [];
  const selectedKeys = new Set();
  const perPlatformCounts = new Map();
  const capFor = (platform) => (platform === "YouTube" ? 1 : Math.max(2, Math.ceil(limit / 3)));

  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const platform of platforms) {
      const count = perPlatformCounts.get(platform) || 0;
      if (count >= capFor(platform)) continue;
      const bucket = buckets.get(platform) || [];
      const item = bucket.shift();
      if (!item) continue;
      const key = item.result.url.replace(/\/$/, "").toLowerCase();
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selected.push(item.result);
      perPlatformCounts.set(platform, count + 1);
      progressed = true;
      if (selected.length >= limit) break;
    }
  }

  for (const item of ordered) {
    if (selected.length >= limit) break;
    const key = item.result.url.replace(/\/$/, "").toLowerCase();
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selected.push(item.result);
  }

  return selected;
}

export async function searchOne(query, intent = "partner", limit = 10, engines = SEARCH_ENGINES) {
  const all = [];
  const errors = [];
  const enginesToRun = enginesForQuery(query, intent, engines);

  const providerJobs = [
    searchBrave(query, intent, limit),
    searchSerpApi(query, intent, limit),
    ...enginesToRun.map((engine) => runSearchEngine(engine, query, intent, limit))
  ];
  const providerResults = await Promise.all(providerJobs);
  for (const provider of providerResults) {
    all.push(...provider.results);
    errors.push(...provider.errors);
  }

  const seen = new Set();
  const candidates = [];
  for (const result of all) {
    if (!matchesSiteConstraint(result, query)) continue;
    if (!isRelevantResult(result, intent)) continue;
    const key = result.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(result);
  }

  return { results: diversifyResults(candidates, limit, query, intent), errors };
}

function shouldFetchPage(url) {
  const domain = domainOf(url);
  return !PAGE_FETCH_DENYLIST.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

export function extractEmails(text) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return cleanEmails(matches);
}

function extractSocialLinks($, baseUrl) {
  const links = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const absolute = safeUrl(new URL(href, baseUrl).toString());
    if (!absolute) return;
    const lower = absolute.toLowerCase();
    if (
      lower.includes("linkedin.com") ||
      lower.includes("youtube.com") ||
      lower.includes("instagram.com") ||
      lower.includes("x.com/") ||
      lower.includes("twitter.com/") ||
      lower.includes("facebook.com/") ||
      lower.includes("tiktok.com/") ||
      lower.includes("t.me/") ||
      lower.includes("telegram") ||
      lower.includes("reddit.com/") ||
      lower.includes("tradingview.com/") ||
      lower.includes("forexfactory.com/") ||
      lower.includes("babypips.com/") ||
      lower.includes("discord.gg") ||
      lower.includes("discord.com") ||
      lower.includes("threads.net") ||
      lower.includes("linktr.ee") ||
      lower.includes("beacons.ai") ||
      lower.includes("bio.link") ||
      lower.includes("msha.ke") ||
      lower.includes("solo.to") ||
      lower.includes("allmylinks.com") ||
      lower.includes("bit.ly") ||
      lower.includes("calendly.com") ||
      lower.includes("wa.me/") ||
      lower.includes("whatsapp")
    ) {
      links.push(absolute);
    }
  });
    return cleanLinks(links).slice(0, 12);
}

function extractContactLinks($, baseUrl) {
  const links = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const label = normalizeWhitespace($(element).text()).toLowerCase();
    if (!href) return;
    const absolute = safeUrl(new URL(href, baseUrl).toString());
    if (!absolute) return;
    const lower = absolute.toLowerCase();
    if (
      label.includes("contact") ||
      label.includes("contacto") ||
      label.includes("contato") ||
      label.includes("partner") ||
      label.includes("affiliate") ||
      label.includes("about") ||
      label.includes("sobre") ||
      label.includes("whatsapp") ||
      lower.includes("contact") ||
      lower.includes("contacto") ||
      lower.includes("contato") ||
      lower.includes("partner") ||
      lower.includes("affiliate") ||
      lower.includes("about") ||
      lower.includes("sobre") ||
      lower.includes("whatsapp") ||
      lower.includes("calendly")
    ) {
      links.push(absolute);
    }
  });
    return cleanLinks(links).slice(0, 8);
}

export async function enrichResult(result) {
  if (!shouldFetchPage(result.url)) {
    return {
      ...result,
      fetchStatus: "skipped-social-or-platform"
    };
  }

  try {
    const html = await fetchText(result.url, 13000);
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, iframe").remove();
    const pageTitle = normalizeWhitespace($("title").first().text());
    const pageDescription = normalizeWhitespace(
      $('meta[name="description"]').attr("content") ||
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="twitter:description"]').attr("content") ||
        ""
    );
    const bodyText = normalizeWhitespace($("body").text()).slice(0, 8000);
    const emails = extractEmails(html + " " + bodyText);
    const socialLinks = extractSocialLinks($, result.url);
    const contactLinks = extractContactLinks($, result.url);

    return {
      ...result,
      pageTitle,
      pageDescription,
      pageText: bodyText,
      emails,
      socialLinks,
      contactLinks,
      fetchStatus: "ok"
    };
  } catch (error) {
    return {
      ...result,
      fetchStatus: `failed: ${error.message}`
    };
  }
}
