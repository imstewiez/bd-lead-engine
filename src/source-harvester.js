import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import {
  ECOSYSTEM_QUERY_TEMPLATES,
  FORUM_QUERY_TEMPLATES,
  INTENT_POST_QUERY_TEMPLATES,
  PARTNER_QUERY_TEMPLATES,
  RECRUITMENT_QUERY_TEMPLATES,
  SEARCH_PROFILES,
  SOCIAL_QUERY_TEMPLATES,
  SPECIALIST_QUERY_TEMPLATES
} from "./config.js";
import { classifyResult } from "./classify.js";
import { cleanEmails, cleanForms, cleanLinks, cleanPhoneNumbers, hasDirectOutboundPath, isUsefulDirectContactUrl } from "./contact-cleaner.js";
import { deepEnrichResult } from "./deep.js";
import { exportLeads } from "./exporter.js";
import { hasStrictTradingIcp, isHardRejectedLead } from "./lead-quality.js";
import { getRootDir, readDb, upsertLeads } from "./store.js";
import { enrichResult, extractEmails, fetchHtml, resultFrom, searchOne } from "./search.js";
import {
  domainOf,
  idForLead,
  normalizeWhitespace,
  nowIso,
  platformFromUrl,
  safeUrl,
  sleep,
  titleFromUrl,
  unique
} from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "source-harvester-status.json");
const logPath = path.join(dataDir, "source-harvester.log");
const stopPath = path.join(dataDir, "source-harvester-stop");
const SEARCH_ENGINES_NO_YOUTUBE = ["yahoo", "bing-rss", "bing"];

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.split("="))
    .filter(([key]) => key?.startsWith("--"))
    .map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"])
);

function numberArg(name, fallback) {
  const parsed = Number(args.get(name) || process.env[name.toUpperCase()] || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolArg(name, fallback) {
  const value = args.get(name);
  if (value == null) return fallback;
  return value !== "false";
}

const options = {
  regionSet: args.get("region") || args.get("regionSet") || "global",
  concurrency: Math.max(1, Math.min(numberArg("concurrency", 6), 12)),
  batchSize: Math.max(10, Math.min(numberArg("batchSize", 120), 400)),
  limitPerQuery: Math.max(3, Math.min(numberArg("limitPerQuery", 8), 20)),
  delayMs: Math.max(2000, numberArg("delayMs", 12000)),
  maxCycles: Math.max(0, numberArg("maxCycles", 0)),
  queryOffset: Math.max(0, numberArg("queryOffset", 0)),
  fetchPages: boolArg("fetchPages", true),
  deepPerLead: boolArg("deepPerLead", true),
  storePerLead: boolArg("storePerLead", false),
  maxContactPages: Math.max(1, Math.min(numberArg("maxContactPages", 5), 12)),
  maxExternalWebsites: Math.max(0, Math.min(numberArg("maxExternalWebsites", 3), 8)),
  maxTrailQueries: Math.max(2, Math.min(numberArg("maxTrailQueries", 12), 24)),
  trailLimit: Math.max(2, Math.min(numberArg("trailLimit", 5), 12)),
  exportEveryCycle: boolArg("exportEveryCycle", true),
  minScore: Math.max(30, Math.min(numberArg("minScore", 38), 80))
};

const DIRECT_QUERY_PACK = [
  { intent: "social", source: "linkedin-ib", text: "site:linkedin.com/in \"introducing broker\" \"forex\"" },
  { intent: "social", source: "linkedin-affiliate", text: "site:linkedin.com/in \"forex affiliate\"" },
  { intent: "social", source: "linkedin-revshare", text: "site:linkedin.com/in \"forex\" \"revenue share\"" },
  { intent: "social", source: "linkedin-cpa", text: "site:linkedin.com/in \"forex\" \"CPA\" \"affiliate\"" },
  { intent: "social", source: "linkedin-pamm", text: "site:linkedin.com/in \"PAMM\" \"forex\"" },
  { intent: "social", source: "linkedin-mam", text: "site:linkedin.com/in \"MAM\" \"forex\"" },
  { intent: "social", source: "linkedin-copy", text: "site:linkedin.com/in \"copy trading\" \"forex\"" },
  { intent: "social", source: "linkedin-community", text: "site:linkedin.com/in \"trading community\" \"founder\" \"forex\"" },
  { intent: "social", source: "linkedin-academy", text: "site:linkedin.com/in \"forex academy\" \"founder\"" },
  { intent: "social", source: "linkedin-signal-founder", text: "site:linkedin.com/in \"forex signals\" \"founder\"" },
  { intent: "social", source: "linkedin-telegram-founder", text: "site:linkedin.com/in \"telegram\" \"forex\" \"founder\"" },
  { intent: "social", source: "linkedin-discord-community", text: "site:linkedin.com/in \"discord\" \"forex\" \"community\"" },
  { intent: "social", source: "linkedin-trader-xauusd", text: "site:linkedin.com/in \"XAUUSD\" \"trader\"" },
  { intent: "social", source: "linkedin-fund-manager", text: "site:linkedin.com/in \"fund manager\" \"forex\"" },
  { intent: "social", source: "linkedin-investment-adviser", text: "site:linkedin.com/in \"investment adviser\" \"forex\"" },
  { intent: "recruitment", source: "linkedin-broker-bd", text: "site:linkedin.com/in \"business development\" \"forex broker\"" },
  { intent: "recruitment", source: "linkedin-affiliate-manager", text: "site:linkedin.com/in \"affiliate manager\" \"forex\"" },
  { intent: "recruitment", source: "linkedin-partnership-manager", text: "site:linkedin.com/in \"partnership manager\" \"forex broker\"" },
  { intent: "intent", source: "linkedin-posts-broker", text: "site:linkedin.com/posts \"forex\" \"looking for broker\"" },
  { intent: "intent", source: "linkedin-posts-recommend", text: "site:linkedin.com/posts \"forex\" \"recommend broker\"" },
  { intent: "intent", source: "linkedin-posts-ib", text: "site:linkedin.com/posts \"forex\" \"introducing broker\"" },
  { intent: "intent", source: "linkedin-feed-broker", text: "site:linkedin.com/feed/update \"forex\" \"looking for broker\"" },
  { intent: "social", source: "instagram-whatsapp", text: "site:instagram.com \"forex trader\" \"whatsapp\"" },
  { intent: "social", source: "instagram-signals", text: "site:instagram.com \"forex signals\" \"whatsapp\"" },
  { intent: "social", source: "instagram-xauusd", text: "site:instagram.com \"xauusd\" \"whatsapp\"" },
  { intent: "social", source: "instagram-gold", text: "site:instagram.com \"gold trader\" \"telegram\"" },
  { intent: "social", source: "instagram-academy", text: "site:instagram.com \"forex academy\" \"whatsapp\"" },
  { intent: "social", source: "instagram-mentor", text: "site:instagram.com \"trading mentor\" \"forex\"" },
  { intent: "social", source: "instagram-linktree", text: "site:instagram.com \"forex\" \"linktr.ee\" \"whatsapp\"" },
  { intent: "social", source: "instagram-beacons", text: "site:instagram.com \"forex\" \"beacons.ai\" \"whatsapp\"" },
  { intent: "social", source: "x-looking", text: "site:x.com \"forex\" \"looking for broker\"" },
  { intent: "social", source: "x-recommend", text: "site:x.com \"forex\" \"recommend broker\"" },
  { intent: "social", source: "x-ib", text: "site:x.com \"forex\" \"introducing broker\"" },
  { intent: "social", source: "x-affiliate", text: "site:x.com \"forex\" \"affiliate\" \"CPA\"" },
  { intent: "social", source: "x-xauusd", text: "site:x.com \"xauusd\" \"signals\"" },
  { intent: "social", source: "x-gold-telegram", text: "site:x.com \"gold trader\" \"telegram\"" },
  { intent: "social", source: "twitter-looking", text: "site:twitter.com \"forex\" \"looking for broker\"" },
  { intent: "social", source: "twitter-xauusd", text: "site:twitter.com \"xauusd\" \"signals\"" },
  { intent: "social", source: "tiktok-trader", text: "\"forex trader\" \"tiktok.com/@\"" },
  { intent: "social", source: "tiktok-xauusd", text: "\"xauusd\" \"tiktok.com/@\" \"trader\"" },
  { intent: "social", source: "tiktok-signals", text: "\"forex signals\" \"tiktok.com/@\"" },
  { intent: "social", source: "telegram-signals", text: "site:t.me \"forex signals\"" },
  { intent: "social", source: "telegram-xauusd", text: "site:t.me \"xauusd\" \"signals\"" },
  { intent: "social", source: "telegram-copy", text: "site:t.me \"forex\" \"copy trading\"" },
  { intent: "social", source: "telegram-ib", text: "site:t.me \"forex\" \"IB\"" },
  { intent: "social", source: "discord-forex", text: "site:discord.gg \"forex\" \"trading\"" },
  { intent: "social", source: "discord-xauusd", text: "site:discord.gg \"xauusd\"" },
  { intent: "forum", source: "reddit-broker", text: "site:reddit.com/r/Forex \"which broker\"" },
  { intent: "forum", source: "reddit-recommend", text: "site:reddit.com/r/Forex \"recommend broker\"" },
  { intent: "forum", source: "reddit-ib", text: "site:reddit.com/r/Forex \"introducing broker\"" },
  { intent: "forum", source: "tradingview-signals", text: "site:tradingview.com/u/ \"forex\" \"signals\"" },
  { intent: "forum", source: "tradingview-xauusd", text: "site:tradingview.com/u/ \"xauusd\" \"signals\"" },
  { intent: "forum", source: "forexfactory-broker", text: "site:forexfactory.com/thread \"which broker\" \"forex\"" },
  { intent: "forum", source: "babypips-broker", text: "site:forums.babypips.com \"recommend broker\" \"forex\"" },
  { intent: "specialist", source: "myfxbook-members", text: "site:myfxbook.com/members \"forex\" \"manager\"" },
  { intent: "specialist", source: "myfxbook-xauusd", text: "site:myfxbook.com/members \"XAUUSD\"" },
  { intent: "specialist", source: "myfxbook-copy", text: "site:myfxbook.com/members \"copy trading\"" },
  { intent: "specialist", source: "mql5-signals-forex", text: "site:mql5.com/en/signals \"forex\" \"growth\"" },
  { intent: "specialist", source: "mql5-signals-xauusd", text: "site:mql5.com/en/signals \"XAUUSD\"" },
  { intent: "specialist", source: "mql5-users-signals", text: "site:mql5.com/en/users \"forex\" \"signals\"" },
  { intent: "specialist", source: "fxblue-users", text: "site:fxblue.com/users \"forex\"" },
  { intent: "specialist", source: "zulutrade", text: "site:zulutrade.com/trader \"forex\"" },
  { intent: "specialist", source: "darwinex", text: "site:darwinex.com/darwin \"forex\"" },
  { intent: "specialist", source: "signalstart", text: "site:signalstart.com/analysis \"forex\"" },
  { intent: "ecosystem", source: "ifx-expo", text: "site:ifxexpo.com \"exhibitors\" \"forex\"" },
  { intent: "ecosystem", source: "money-expo", text: "site:moneyexpo.com \"forex\" \"exhibitors\"" },
  { intent: "ecosystem", source: "traders-fair", text: "site:tradersfair.com \"forex\" \"exhibitors\"" },
  { intent: "ecosystem", source: "finance-magnates-speakers", text: "site:financemagnates.com \"forex\" \"summit\" \"speakers\"" },
  { intent: "ecosystem", source: "sec-adv", text: "site:adviserinfo.sec.gov \"foreign exchange\" \"investment adviser\"" },
  { intent: "ecosystem", source: "sec-form-adv", text: "site:sec.gov \"Form ADV\" \"currency trading\"" },
  { intent: "ecosystem", source: "fca-register", text: "site:register.fca.org.uk \"foreign exchange\" \"investment\"" },
  { intent: "ecosystem", source: "cvm-consultor", text: "site:cadastro.cvm.gov.br \"consultor\" \"derivativos\"" },
  { intent: "ecosystem", source: "cnmv-gestora", text: "site:cnmv.es \"divisas\" \"gestora\"" },
  { intent: "ecosystem", source: "cmf-adviser", text: "site:cmfchile.cl \"asesor\" \"inversiones\" \"divisas\"" },
  { intent: "ecosystem", source: "opencorporates-forex", text: "site:opencorporates.com \"forex\" \"trading\" \"director\"" },
  { intent: "ecosystem", source: "opencorporates-fx", text: "site:opencorporates.com \"foreign exchange\" \"director\"" },
  { intent: "ecosystem", source: "companies-house", text: "site:find-and-update.company-information.service.gov.uk \"trading academy\" \"director\"" },
  { intent: "ecosystem", source: "hotmart-course", text: "site:hotmart.com \"forex\" \"curso\"" },
  { intent: "ecosystem", source: "kiwify-course", text: "site:kiwify.com.br \"forex\" \"curso\"" },
  { intent: "ecosystem", source: "meetup", text: "site:meetup.com \"forex trading\"" }
];

const TEMPLATE_GROUPS = [
  { intent: "social", source: "social-template", templates: SOCIAL_QUERY_TEMPLATES },
  { intent: "intent", source: "intent-template", templates: INTENT_POST_QUERY_TEMPLATES },
  { intent: "specialist", source: "specialist-template", templates: SPECIALIST_QUERY_TEMPLATES },
  { intent: "forum", source: "forum-template", templates: FORUM_QUERY_TEMPLATES },
  { intent: "ecosystem", source: "ecosystem-template", templates: ECOSYSTEM_QUERY_TEMPLATES },
  { intent: "partner", source: "partner-template", templates: PARTNER_QUERY_TEMPLATES },
  { intent: "recruitment", source: "recruitment-template", templates: RECRUITMENT_QUERY_TEMPLATES }
];

const DIRECT_SOURCE_PACK = [
  { intent: "specialist", source: "mql5-direct-xauusd-mt5", direct: "mql5-signals", platform: "mt5", term: "xauusd", page: 1, text: "direct:mql5 signals mt5 xauusd page 1" },
  { intent: "specialist", source: "mql5-direct-gold-mt5", direct: "mql5-signals", platform: "mt5", term: "gold", page: 1, text: "direct:mql5 signals mt5 gold page 1" },
  { intent: "specialist", source: "mql5-direct-forex-mt5", direct: "mql5-signals", platform: "mt5", term: "forex", page: 1, text: "direct:mql5 signals mt5 forex page 1" },
  { intent: "specialist", source: "mql5-direct-copy-mt5", direct: "mql5-signals", platform: "mt5", term: "copy trading", page: 1, text: "direct:mql5 signals mt5 copy trading page 1" },
  { intent: "specialist", source: "mql5-direct-xauusd-mt4", direct: "mql5-signals", platform: "mt4", term: "xauusd", page: 1, text: "direct:mql5 signals mt4 xauusd page 1" },
  { intent: "specialist", source: "mql5-direct-forex-mt4", direct: "mql5-signals", platform: "mt4", term: "forex", page: 1, text: "direct:mql5 signals mt4 forex page 1" },
  { intent: "specialist", source: "mql5-direct-xauusd-mt5-p2", direct: "mql5-signals", platform: "mt5", term: "xauusd", page: 2, text: "direct:mql5 signals mt5 xauusd page 2" },
  { intent: "specialist", source: "mql5-direct-forex-mt5-p2", direct: "mql5-signals", platform: "mt5", term: "forex", page: 2, text: "direct:mql5 signals mt5 forex page 2" },
  { intent: "social", source: "tiktok-direct-forex-trader", direct: "tiktok-search", term: "forex trader", text: "direct:tiktok user search forex trader" },
  { intent: "social", source: "tiktok-direct-xauusd", direct: "tiktok-search", term: "xauusd trader", text: "direct:tiktok user search xauusd trader" },
  { intent: "social", source: "tiktok-direct-forex-signals", direct: "tiktok-search", term: "forex signals", text: "direct:tiktok user search forex signals" }
];

function expandedDirectSourcePack() {
  const direct = [...DIRECT_SOURCE_PACK];
  const mql5Terms = ["xauusd", "gold", "forex", "copy trading", "pamm", "scalping", "algo trading", "mt5"];
  for (const platform of ["mt5", "mt4"]) {
    for (const term of mql5Terms) {
      for (let page = 1; page <= 8; page += 1) {
        direct.push({
          intent: "specialist",
          source: `mql5-direct-${platform}-${term.replace(/\s+/g, "-")}-p${page}`,
          direct: "mql5-signals",
          platform,
          term,
          page,
          text: `direct:mql5 signals ${platform} ${term} page ${page}`
        });
      }
    }
  }
  return direct;
}

function isYouTubeQuery(text = "") {
  return /youtube\.com|youtu\.be|\byoutube\b/i.test(String(text));
}

function deSlug(value = "") {
  return normalizeWhitespace(
    decodeURIComponent(String(value))
      .replace(/^@/, "")
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

function handleFromText(text = "") {
  const match = String(text).match(/@([a-z0-9._-]{3,40})/i);
  return match ? match[1].replace(/[._-]+$/, "") : "";
}

function profileNameFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();
    const second = parts[1] || "";
    if ((domain === "linkedin.com" || domain.endsWith(".linkedin.com")) && ["in", "company"].includes(first) && second) {
      return deSlug(second);
    }
    if ((domain === "instagram.com" || domain.endsWith(".instagram.com")) && parts[0]) return `@${parts[0]}`;
    if ((domain === "x.com" || domain === "twitter.com") && parts[0]) return `@${parts[0]}`;
    if ((domain === "tiktok.com" || domain.endsWith(".tiktok.com")) && parts[0]?.startsWith("@")) return parts[0];
    if ((domain === "t.me" || domain === "telegram.me") && parts[0]) return `@${parts[0]}`;
    if ((domain === "myfxbook.com" || domain.endsWith(".myfxbook.com")) && first === "members" && second) return deSlug(second);
    if ((domain === "mql5.com" || domain.endsWith(".mql5.com")) && first === "en" && second === "users" && parts[2]) return deSlug(parts[2]);
    if ((domain === "tradingview.com" || domain.endsWith(".tradingview.com")) && first === "u" && second) return deSlug(second);
  } catch {
    return "";
  }
  return "";
}

function canonicalizeUrl(url = "", text = "") {
  const clean = safeUrl(url);
  if (!clean || isYouTubeQuery(clean)) return null;
  try {
    const parsed = new URL(clean);
    parsed.hash = "";
    const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    const first = (parts[0] || "").toLowerCase();
    const second = (parts[1] || "").toLowerCase();

    if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) {
      if (["in", "company"].includes(first) && parts[1]) {
        parsed.pathname = `/${first}/${parts[1]}`;
        parsed.search = "";
        return parsed.toString();
      }
      if (first === "posts" || (first === "feed" && second === "update")) return parsed.toString();
      return null;
    }

    if (domain === "instagram.com" || domain.endsWith(".instagram.com")) {
      if (parts[0] && !["p", "reel", "reels", "stories", "explore", "accounts", "about", "privacy", "terms"].includes(first)) {
        parsed.pathname = `/${parts[0]}/`;
        parsed.search = "";
        return parsed.toString();
      }
      const handle = handleFromText(text);
      if (handle) return `https://www.instagram.com/${handle}/`;
      return null;
    }

    if (domain === "x.com" || domain === "twitter.com") {
      if (!parts[0] || ["i", "share", "intent", "search", "home", "tos", "privacy", "settings", "hashtag"].includes(first)) return null;
      return `https://x.com/${parts[0]}`;
    }

    if (domain === "tiktok.com" || domain.endsWith(".tiktok.com")) {
      const handle = parts.find((part) => part.startsWith("@"));
      if (!handle) return null;
      return `https://www.tiktok.com/${handle}`;
    }

    if (domain === "t.me" || domain === "telegram.me") {
      if (!parts[0] || ["share", "iv", "proxy"].includes(first)) return null;
      return `https://t.me/${parts[0]}`;
    }

    if (domain === "discord.gg" && parts[0]) return `https://discord.gg/${parts[0]}`;
    if (domain === "discord.com" && first === "invite" && parts[1]) return `https://discord.com/invite/${parts[1]}`;
    if (domain === "disboard.org" || domain.endsWith(".disboard.org")) return clean;

    if ((domain === "tradingview.com" || domain.endsWith(".tradingview.com")) && first === "u" && parts[1]) {
      return `https://www.tradingview.com/u/${parts[1]}/`;
    }

    if ((domain === "myfxbook.com" || domain.endsWith(".myfxbook.com")) && ["members", "portfolio", "community"].includes(first)) return clean;
    if ((domain === "mql5.com" || domain.endsWith(".mql5.com")) && first === "en" && ["signals", "users", "forum", "market"].includes(second)) return clean;
    if ((domain === "fxblue.com" || domain.endsWith(".fxblue.com")) && first === "users") return clean;
    if ((domain === "zulutrade.com" || domain.endsWith(".zulutrade.com")) && first === "trader") return clean;
    if ((domain === "darwinex.com" || domain.endsWith(".darwinex.com")) && first === "darwin") return clean;
    if ((domain === "signalstart.com" || domain.endsWith(".signalstart.com")) && first === "analysis") return clean;
    if (domain === "collective2.com" || domain.endsWith(".collective2.com")) return clean;

    if (domain === "reddit.com" || domain.endsWith(".reddit.com")) return clean;
    if (domain === "forexfactory.com" || domain.endsWith(".forexfactory.com")) return clean;
    if (domain === "babypips.com" || domain.endsWith(".babypips.com")) return clean;
    if (domain === "linktr.ee" || domain === "beacons.ai" || domain === "bio.link" || domain === "allmylinks.com" || domain === "carrd.co") return clean;

    return clean;
  } catch {
    return null;
  }
}

function platformHasDirectPath(url = "") {
  const platform = platformFromUrl(url);
  if (["Myfxbook", "MQL5", "FXBlue", "ZuluTrade", "Darwinex", "SignalStart", "Collective2", "TradingView"].includes(platform)) return true;
  return isUsefulDirectContactUrl(url);
}

function shouldLightEnrich(lead) {
  if (!options.fetchPages) return false;
  const platform = lead.platform || platformFromUrl(lead.url);
  if (["LinkedIn", "Instagram", "X/Twitter", "TikTok", "Telegram", "Discord", "Facebook", "Threads", "Reddit"].includes(platform)) return false;
  return ["Web", "Link Hub", "Company Registry", "Regulatory Registry"].includes(platform) || /hotmart|kiwify|eduzz|meetup|ifxexpo|moneyexpo|tradersfair|financemagnates/i.test(lead.domain || "");
}

function resultToCandidate(result, query) {
  const rawText = normalizeWhitespace([result.title, result.snippet, result.url, query.text].filter(Boolean).join(" "));
  const canonicalUrl = canonicalizeUrl(result.url, rawText);
  if (!canonicalUrl) return null;

  const platform = platformFromUrl(canonicalUrl);
  const fallbackName = profileNameFromUrl(canonicalUrl);
  const resultName = normalizeWhitespace(result.name || result.title || titleFromUrl(canonicalUrl));
  const genericName = /^(?:linkedin|instagram|x|twitter|tiktok|telegram|reddit|profile|posts?|people)$/i.test(resultName);
  const name = genericName ? fallbackName || resultName : resultName || fallbackName || titleFromUrl(canonicalUrl);
  const directLinks = platformHasDirectPath(canonicalUrl) ? [canonicalUrl] : [];
  const originalUrl = safeUrl(result.url);
  const contextSnippet = normalizeWhitespace(
    [
      result.snippet,
      `Matched public source: ${query.text}.`,
      query.source ? `Source pack: ${query.source}.` : ""
    ].filter(Boolean).join(" ")
  );

  return {
    ...result,
    id: idForLead(canonicalUrl, `${platform}:${canonicalUrl.toLowerCase()}`),
    source: result.source || "source-harvester",
    sourceIntent: query.intent,
    query: query.text,
    url: canonicalUrl,
    domain: domainOf(canonicalUrl),
    platform,
    title: normalizeWhitespace(result.title || name),
    name,
    snippet: contextSnippet,
    emails: cleanEmails([...(result.emails || []), ...extractEmails(rawText)]),
    socialLinks: cleanLinks([
      ...(result.socialLinks || []),
      ...(platform && platform !== "Web" && platform !== "Company Registry" && platform !== "Regulatory Registry" ? [canonicalUrl] : [])
    ], { allowYouTubeChannels: false, allowShorteners: true }),
    contactLinks: cleanLinks([...(result.contactLinks || []), ...directLinks], { allowYouTubeChannels: false, allowShorteners: true }),
    relatedLinks: unique([...(result.relatedLinks || []), originalUrl && originalUrl !== canonicalUrl ? originalUrl : ""].filter(Boolean)),
    discoverySource: "source-harvester",
    sourcePack: query.source || ""
  };
}

async function maybeEnrich(candidate) {
  if (!shouldLightEnrich(candidate)) return candidate;
  try {
    const enriched = await enrichResult(candidate);
    return {
      ...enriched,
      snippet: normalizeWhitespace([candidate.snippet, enriched.pageDescription].filter(Boolean).join(" ")).slice(0, 1200),
      relatedLinks: unique([...(candidate.relatedLinks || []), ...(enriched.relatedLinks || [])]),
      contactLinks: cleanLinks([...(candidate.contactLinks || []), ...(enriched.contactLinks || [])], {
        allowYouTubeChannels: false,
        allowShorteners: true
      }),
      socialLinks: cleanLinks([...(candidate.socialLinks || []), ...(enriched.socialLinks || [])], {
        allowYouTubeChannels: false,
        allowShorteners: true
      }),
      emails: cleanEmails([...(candidate.emails || []), ...(enriched.emails || [])])
    };
  } catch {
    return candidate;
  }
}

function mergeCandidateEnrichment(base, enriched) {
  return {
    ...base,
    ...enriched,
    snippet: normalizeWhitespace([
      base.snippet,
      enriched.snippet,
      enriched.pageDescription
    ].filter(Boolean).join(" ")).slice(0, 1400),
    emails: cleanEmails([...(base.emails || []), ...(enriched.emails || [])]),
    phoneNumbers: cleanPhoneNumbers([...(base.phoneNumbers || []), ...(enriched.phoneNumbers || [])]),
    forms: cleanForms([...(base.forms || []), ...(enriched.forms || [])]),
    contactLinks: cleanLinks([...(base.contactLinks || []), ...(enriched.contactLinks || [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    socialLinks: cleanLinks([...(base.socialLinks || []), ...(enriched.socialLinks || [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    websiteLinks: cleanLinks([...(base.websiteLinks || []), ...(enriched.websiteLinks || [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    relatedLinks: unique([...(base.relatedLinks || []), ...(enriched.relatedLinks || [])]).slice(0, 30),
    contactSources: unique([...(base.contactSources || []), ...(enriched.contactSources || [])]).slice(0, 20),
    decisionMakerLinks: unique([...(base.decisionMakerLinks || []), ...(enriched.decisionMakerLinks || [])]).slice(0, 12),
    decisionMakers: [...(base.decisionMakers || []), ...(enriched.decisionMakers || [])].slice(0, 10),
    contactConfidence: Math.max(Number(base.contactConfidence || 0), Number(enriched.contactConfidence || 0)),
    bestContact: enriched.bestContact || base.bestContact || "",
    bestContactType: enriched.bestContactType || base.bestContactType || ""
  };
}

async function enrichCandidate(candidate) {
  const light = await maybeEnrich(candidate);
  if (!options.deepPerLead) return light;
  try {
    const deep = await deepEnrichResult(light, {
      searchContacts: true,
      maxContactPages: options.maxContactPages,
      maxExternalWebsites: options.maxExternalWebsites,
      maxTrailQueries: options.maxTrailQueries,
      trailLimit: options.trailLimit
    });
    return mergeCandidateEnrichment(light, deep);
  } catch (error) {
    return {
      ...light,
      enrichmentErrors: unique([...(light.enrichmentErrors || []), error.message]).slice(0, 8)
    };
  }
}

function hasUsefulPath(lead) {
  if (cleanEmails(lead.emails || []).length) return true;
  if (hasDirectOutboundPath(lead)) return true;
  if (platformHasDirectPath(lead.url)) return true;
  return cleanLinks([...(lead.socialLinks || []), ...(lead.contactLinks || [])], {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).some(isUsefulDirectContactUrl);
}

function passesQualityGate(lead) {
  if (isYouTubeQuery(lead.url) || isHardRejectedLead(lead)) return false;
  if (lead.segment === "Broker Site" && lead.leadType !== "recruitment") return false;
  if (!["partner", "recruitment", "institution"].includes(lead.leadType)) return false;
  if (!hasStrictTradingIcp(lead)) return false;

  const hasPath = hasUsefulPath(lead);
  if (lead.score >= 58 && hasPath) return true;
  if (lead.score >= options.minScore && hasPath && ["LinkedIn", "Instagram", "X/Twitter", "TikTok", "Telegram", "Discord", "TradingView", "Myfxbook", "MQL5"].includes(lead.platform)) return true;
  if (lead.score >= 52 && ["specialist", "ecosystem", "forum", "intent"].includes(lead.sourceIntent)) return true;
  return false;
}

function finalizeLead(classified, query) {
  const direct = platformHasDirectPath(classified.url) ? [classified.url] : [];
  const sourceEvidence = query.source ? `Found via ${query.source}` : "Found via source harvester";
  return {
    ...classified,
    discoverySource: "source-harvester",
    sourcePack: query.source || "",
    contactLinks: cleanLinks([...(classified.contactLinks || []), ...direct], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    socialLinks: cleanLinks([...(classified.socialLinks || []), ...(classified.platform !== "Web" ? [classified.url] : [])], {
      allowYouTubeChannels: false,
      allowShorteners: true
    }),
    evidence: unique([...(classified.evidence || []), sourceEvidence]).slice(0, 8)
  };
}

function queryPriority(query) {
  if (query.direct === "tiktok-search") return -52;
  if (query.direct === "mql5-signals") return -40;
  const text = query.text.toLowerCase();
  let score = 0;
  if (/linkedin\.com\/in/.test(text)) score -= 70;
  if (/linkedin\.com\/posts|linkedin\.com\/feed/.test(text)) score -= 62;
  if (/instagram\.com/.test(text)) score -= 58;
  if (/\bx\.com\b|twitter\.com/.test(text)) score -= 54;
  if (/tiktok\.com/.test(text)) score -= 50;
  if (/t\.me|telegram/.test(text)) score -= 48;
  if (/discord/.test(text)) score -= 44;
  if (/myfxbook|mql5|fxblue|zulutrade|darwinex|signalstart|collective2/.test(text)) score -= 42;
  if (/forexfactory|babypips|tradingview|reddit/.test(text)) score -= 38;
  if (/adviserinfo|sec\.gov|fca|cvm|cnmv|cmfchile|superfinanciera|opencorporates|company-information|companieshouse/.test(text)) score -= 32;
  if (/whatsapp|contact|contato|contacto|calendly|telegram/.test(text)) score -= 8;
  if (/introducing broker|affiliate|cpa|revenue share|pamm|mam|copy trading|signals|xauusd|looking for broker|recommend broker/.test(text)) score -= 10;
  return score;
}

function expandTemplate(template, profile) {
  if (!template.includes("{region}")) return [template];
  return profile.regions.map((region) => template.replace("{region}", region));
}

function buildQueryPool() {
  const profile = SEARCH_PROFILES[options.regionSet] || SEARCH_PROFILES.global;
  const queries = [...expandedDirectSourcePack(), ...DIRECT_QUERY_PACK];

  for (const group of TEMPLATE_GROUPS) {
    for (const template of group.templates) {
      if (isYouTubeQuery(template)) continue;
      for (const text of expandTemplate(template, profile)) {
        queries.push({ intent: group.intent, source: group.source, text });
      }
    }
  }

  for (const region of profile.regions) {
    queries.push(
      { intent: "social", source: "linkedin-region-ib", text: `site:linkedin.com/in "introducing broker" "forex" "${region}"` },
      { intent: "social", source: "instagram-region-whatsapp", text: `site:instagram.com "forex trader" "whatsapp" "${region}"` },
      { intent: "social", source: "tiktok-region", text: `"forex trader" "tiktok.com/@" "${region}"` },
      { intent: "specialist", source: "money-manager-region", text: `"forex money manager" "contact" "${region}"` },
      { intent: "ecosystem", source: "academy-region", text: `"trading academy" "forex" "contact" "${region}"` },
      { intent: "intent", source: "broker-intent-region", text: `"looking for a forex broker" "${region}"` }
    );
  }

  const seen = new Set();
  return queries
    .filter((query) => query.text && !isYouTubeQuery(query.text))
    .filter((query) => {
      const key = query.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => queryPriority(a) - queryPriority(b));
}

function rotatedBatch(pool, cycle) {
  const start = (options.queryOffset + (cycle - 1) * options.batchSize) % pool.length;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  return rotated.slice(0, options.batchSize);
}

async function appendLog(message) {
  await fs.mkdir(dataDir, { recursive: true });
  const line = `${nowIso()} ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
  console.log(message);
}

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

async function stopRequested() {
  try {
    await fs.access(stopPath);
    return true;
  } catch {
    return false;
  }
}

async function clearStopFile() {
  await fs.rm(stopPath, { force: true }).catch(() => {});
}

async function runPool(items, concurrency, worker) {
  const output = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      output.push(await worker(current));
    }
  });
  await Promise.all(workers);
  return output;
}

function resultFromDirect(url, title, snippet, query) {
  return resultFrom(url, title, snippet, query.direct || "direct", query.text, query.intent);
}

async function scrapeMql5Signals(query) {
  const page = Math.max(1, Number(query.page || 1));
  const platform = query.platform === "mt4" ? "mt4" : "mt5";
  const url = `https://www.mql5.com/en/signals/${platform}/page${page}?term=${encodeURIComponent(query.term || "forex")}`;
  const { html } = await fetchHtml(url, 18000);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  $(`a[href*="/en/signals/"]`).each((_, element) => {
    const href = $(element).attr("href") || "";
    if (!/\/en\/signals\/\d+/i.test(href)) return;
    const link = safeUrl(new URL(href, url).toString());
    if (!link || seen.has(link)) return;
    seen.add(link);
    const tile = $(element).closest("li, article, div");
    const text = normalizeWhitespace(tile.text() || $(element).text());
    const title = normalizeWhitespace($(element).text()) || titleFromUrl(link);
    const snippet = normalizeWhitespace([
      text,
      `MQL5 public signal provider matched ${query.term || "forex"}.`,
      "Potential copy trading, signal provider, money manager or high-calibre trader lead."
    ].join(" "));
    const result = resultFromDirect(link, title, snippet, query);
    if (result) results.push(result);
  });
  return results.slice(0, options.limitPerQuery * 3);
}

async function scrapeTikTokSearch(query) {
  const url = `https://www.tiktok.com/search/user?q=${encodeURIComponent(query.term || "forex trader")}`;
  const { html } = await fetchHtml(url, 18000);
  const decoded = html
    .replace(/\\u002F/g, "/")
    .replace(/\\u003A/g, ":")
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, "\"");
  const handles = unique([
    ...[...decoded.matchAll(/https?:\/\/(?:www\.)?tiktok\.com\/@([a-z0-9._-]{3,40})/gi)].map((match) => match[1]),
    ...[...decoded.matchAll(/"uniqueId"\s*:\s*"([a-z0-9._-]{3,40})"/gi)].map((match) => match[1]),
    ...[...decoded.matchAll(/\/@([a-z0-9._-]{3,40})/gi)].map((match) => match[1])
  ])
    .filter((handle) => !/^(?:discover|tag|music|legal|about|login|signup)$/i.test(handle))
    .slice(0, options.limitPerQuery * 3);

  return handles
    .map((handle) => {
      const profileUrl = `https://www.tiktok.com/@${handle}`;
      return resultFromDirect(
        profileUrl,
        `@${handle}`,
        `TikTok public user/profile found for "${query.term}". Matched forex/trading search context: ${query.term}.`,
        query
      );
    })
    .filter(Boolean);
}

async function directResults(query) {
  if (query.direct === "mql5-signals") return scrapeMql5Signals(query);
  if (query.direct === "tiktok-search") return scrapeTikTokSearch(query);
  return [];
}

async function processQuery(query, runId) {
  const errors = [];
  const accepted = [];
  const stored = { created: [], updated: [], total: 0 };
  try {
    const rawResults = query.direct
      ? await directResults(query)
      : await searchOne(query.text, query.intent, options.limitPerQuery, SEARCH_ENGINES_NO_YOUTUBE).then((search) => {
          errors.push(...search.errors);
          return search.results;
        });
    for (const result of rawResults) {
      const candidate = resultToCandidate(result, query);
      if (!candidate) continue;
      const enriched = await enrichCandidate(candidate);
      const classified = classifyResult(enriched, query.intent);
      const lead = finalizeLead(classified, query);
      if (!passesQualityGate(lead)) continue;
      accepted.push(lead);
      if (options.storePerLead) {
        const perLeadStored = await upsertLeads([lead], `${runId}_${lead.id}`);
        stored.created.push(...perLeadStored.created);
        stored.updated.push(...perLeadStored.updated);
        stored.total = perLeadStored.total;
        if (options.exportEveryCycle) {
          await exportLeads({
            csvName: "autopilot-leads.csv",
            jsonName: "autopilot-leads.json"
          });
        }
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { query, accepted, errors, stored };
}

function countByPlatform(leads) {
  return leads.reduce((acc, lead) => {
    const key = lead.platform || platformFromUrl(lead.url) || "Web";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

await clearStopFile();
const queryPool = buildQueryPool();
let cycle = 0;
let totals = { created: 0, updated: 0, accepted: 0, exported: 0, total: 0 };

await appendLog(`[source-harvester] Started with ${JSON.stringify(options)}; queryPool=${queryPool.length}`);
await writeStatus({ status: "running", phase: "started", options, queryPool: queryPool.length, totals });

while (!(await stopRequested())) {
  cycle += 1;
  const batch = rotatedBatch(queryPool, cycle);
  await appendLog(`[source-harvester] Cycle ${cycle} started; batch=${batch.length}; first="${batch[0]?.text || ""}"`);
  await writeStatus({ status: "running", phase: "search", cycle, options, queryPool: queryPool.length, batchSize: batch.length, totals });

  const runId = `source_harvester_${Date.now()}_${cycle}`;
  const queryResults = await runPool(batch, options.concurrency, (query) => processQuery(query, runId));
  const accepted = queryResults.flatMap((result) => result.accepted);
  const errors = queryResults.flatMap((result) => result.errors.map((message) => ({ query: result.query.text, message })));
  const uniqueLeads = [...new Map(accepted.map((lead) => [lead.id, lead])).values()];

  let stored = { created: [], updated: [], total: totals.total };
  if (options.storePerLead) {
    stored = {
      created: queryResults.flatMap((result) => result.stored?.created || []),
      updated: queryResults.flatMap((result) => result.stored?.updated || []),
      total: (await readDb()).leads.length
    };
  } else if (uniqueLeads.length) {
    stored = await upsertLeads(uniqueLeads, runId);
  }

  totals = {
    created: totals.created + stored.created.length,
    updated: totals.updated + stored.updated.length,
    accepted: totals.accepted + uniqueLeads.length,
    exported: totals.exported,
    total: stored.total || (await readDb()).leads.length
  };

  let exportResult = null;
  if (options.exportEveryCycle) {
    exportResult = await exportLeads({
      csvName: "autopilot-leads.csv",
      jsonName: "autopilot-leads.json"
    });
    totals.exported = exportResult.exported;
    totals.total = exportResult.total;
  }

  const platformCounts = countByPlatform(uniqueLeads);
  await appendLog(
    `[source-harvester] Cycle ${cycle} complete. accepted=${uniqueLeads.length}; new=${stored.created.length}; updated=${stored.updated.length}; total=${totals.total}; qualified=${exportResult?.exported ?? totals.exported}; platforms=${JSON.stringify(platformCounts)}; errors=${errors.length}`
  );
  await writeStatus({
    status: "running",
    phase: "waiting",
    cycle,
    options,
    queryPool: queryPool.length,
    batchSize: batch.length,
    lastAccepted: uniqueLeads.length,
    lastCreated: stored.created.length,
    lastUpdated: stored.updated.length,
    lastPlatforms: platformCounts,
    lastErrors: errors.slice(0, 25),
    totals
  });

  if (options.maxCycles > 0 && cycle >= options.maxCycles) break;
  if (!(await stopRequested())) await sleep(options.delayMs);
}

const finalExport = await exportLeads({
  csvName: "autopilot-leads.csv",
  jsonName: "autopilot-leads.json"
});
await writeStatus({
  status: "stopped",
  phase: "stopped",
  cycle,
  options,
  queryPool: queryPool.length,
  totals: { ...totals, exported: finalExport.exported, total: finalExport.total }
});
await appendLog(`[source-harvester] Stopped. total=${finalExport.total}; qualified=${finalExport.exported}; contactable=${finalExport.contactable}`);
