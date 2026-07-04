import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function stripHtml(value = "") {
  return normalizeWhitespace(String(value).replace(/<[^>]*>/g, " "));
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function cleanSearchRedirect(value) {
  if (!value) return null;
  try {
    const yahooTarget = String(value).match(/\/RU=([^/]+)/);
    if (yahooTarget) return safeUrl(decodeURIComponent(yahooTarget[1]));
    const url = new URL(value, "https://example.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return safeUrl(decodeURIComponent(uddg));
    const target = url.searchParams.get("url") || url.searchParams.get("u");
    if (target && /^https?:/i.test(target)) return safeUrl(target);
    if (target && target.startsWith("a1")) {
      const encoded = target.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      if (/^https?:/i.test(decoded)) return safeUrl(decoded);
    }
    return safeUrl(url.href.replace("https://example.com", ""));
  } catch {
    return safeUrl(value);
  }
}

export function domainOf(value = "") {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function platformFromUrl(value = "") {
  const domain = domainOf(value);
  if (!domain) return "";
  if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) return "LinkedIn";
  if (domain === "instagram.com" || domain.endsWith(".instagram.com")) return "Instagram";
  if (domain === "x.com" || domain === "twitter.com") return "X/Twitter";
  if (domain === "youtube.com" || domain.endsWith(".youtube.com") || domain === "youtu.be") return "YouTube";
  if (domain === "facebook.com" || domain.endsWith(".facebook.com")) return "Facebook";
  if (domain === "tiktok.com" || domain.endsWith(".tiktok.com")) return "TikTok";
  if (domain === "threads.net" || domain.endsWith(".threads.net")) return "Threads";
  if (domain === "reddit.com" || domain.endsWith(".reddit.com")) return "Reddit";
  if (domain === "t.me" || domain === "telegram.me" || domain.endsWith(".telegram.org")) return "Telegram";
  if (domain === "discord.gg" || domain === "discord.com") return "Discord";
  if (domain === "tradingview.com" || domain.endsWith(".tradingview.com")) return "TradingView";
  if (domain === "myfxbook.com" || domain.endsWith(".myfxbook.com")) return "Myfxbook";
  if (domain === "mql5.com" || domain.endsWith(".mql5.com")) return "MQL5";
  if (domain === "fxblue.com" || domain.endsWith(".fxblue.com")) return "FXBlue";
  if (domain === "zulutrade.com" || domain.endsWith(".zulutrade.com")) return "ZuluTrade";
  if (domain === "darwinex.com" || domain.endsWith(".darwinex.com")) return "Darwinex";
  if (domain === "signalstart.com" || domain.endsWith(".signalstart.com")) return "SignalStart";
  if (domain === "collective2.com" || domain.endsWith(".collective2.com")) return "Collective2";
  if (domain === "forexfactory.com" || domain.endsWith(".forexfactory.com")) return "ForexFactory";
  if (domain === "babypips.com" || domain.endsWith(".babypips.com")) return "BabyPips";
  if (
    domain === "adviserinfo.sec.gov" ||
    domain === "sec.gov" ||
    domain.endsWith(".fca.org.uk") ||
    domain === "register.fca.org.uk" ||
    domain.endsWith(".cvm.gov.br") ||
    domain.endsWith(".cnmv.es") ||
    domain.endsWith(".cmfchile.cl") ||
    domain.endsWith(".superfinanciera.gov.co") ||
    domain.endsWith(".asic.gov.au") ||
    domain.endsWith(".mas.gov.sg") ||
    domain.endsWith(".sfc.hk") ||
    domain.endsWith(".dfsa.ae") ||
    domain.endsWith(".adgm.com")
  ) {
    return "Regulatory Registry";
  }
  if (
    domain === "opencorporates.com" ||
    domain.endsWith(".opencorporates.com") ||
    domain.includes("company-information.service.gov.uk") ||
    domain.endsWith(".companieshouse.gov.uk")
  ) {
    return "Company Registry";
  }
  if (domain === "linktr.ee" || domain === "beacons.ai" || domain === "bio.link" || domain === "msha.ke" || domain === "solo.to") {
    return "Link Hub";
  }
  return "Web";
}

export function idForLead(url, title = "") {
  const base = `${domainOf(url)}|${url || ""}|${title.toLowerCase()}`;
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 16);
}

export function includesAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

export function countMatches(text, terms) {
  const lower = text.toLowerCase();
  return terms.reduce((count, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = lower.match(new RegExp(escaped.toLowerCase(), "g"));
    return count + (matches ? matches.length : 0);
  }, 0);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function toCsvCell(value) {
  if (Array.isArray(value)) return toCsvCell(value.join("; "));
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function pickFirstSentence(value = "", fallback = "") {
  const text = normalizeWhitespace(value);
  if (!text) return fallback;
  const sentence = text.split(/(?<=[.!?])\s+/)[0];
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
}

export function cap(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function titleFromUrl(url = "") {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .join(" ")
      .replace(/[-_]/g, " ");
    return normalizeWhitespace(parts || parsed.hostname.replace(/^www\./, ""));
  } catch {
    return "";
  }
}
