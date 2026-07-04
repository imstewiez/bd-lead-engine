import { domainOf, normalizeWhitespace, safeUrl, unique } from "./utils.js";

export const LINK_HUB_DOMAINS = [
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "msha.ke",
  "solo.to",
  "allmylinks.com",
  "carrd.co",
  "taplink.cc",
  "flow.page",
  "lnk.bio",
  "stan.store",
  "koji.to"
];

const SHORTENER_DOMAINS = [
  "bit.ly",
  "tinyurl.com",
  "cutt.ly",
  "shorturl.at",
  "rebrand.ly",
  "t.co",
  "is.gd",
  "buff.ly"
];

const BLOCKED_LINK_DOMAINS = [
  "google.com",
  "googlevideo.com",
  "googleusercontent.com",
  "ggpht.com",
  "gstatic.com",
  "ytimg.com",
  "youtubei.googleapis.com",
  "youtubei-att.googleapis.com",
  "payments.youtube.com",
  "studio.youtube.com",
  "accountlinking-pa-clients6.youtube.com",
  "schema.org",
  "w3.org",
  "doubleclick.net",
  "googletagmanager.com",
  "google-analytics.com",
  "intercom.io",
  "intercomcdn.com",
  "js.intercomcdn.com",
  "intercom-sheets.com",
  "intercom-help.com",
  "vidiq.com",
  "patreon.com",
  "amazon.com",
  "eventbrite.com",
  "grammarly.com",
  "readymag.com",
  "theice.com",
  "houstondynamo.com",
  "readytogo.net",
  "moneysavingexpert.com",
  "studio1.de",
  "socialmediastatistik.de",
  "jsonplaceholder.typicode.com",
  "tiktokcdn.com",
  "tiktokcdn-eu.com",
  "tiktokv.eu",
  "tiktokw.eu",
  "twimg.com",
  "pbs.twimg.com",
  "abs.twimg.com",
  "video.twimg.com",
  "ton.twimg.com",
  "cdn.syndication.twimg.com",
  "static.wixstatic.com",
  "static.parastorage.com",
  "music.wixstatic.com",
  "unpkg.com",
  "jsdelivr.net"
];

const BROKER_OR_REFERRAL_DOMAINS = [
  "xm.com",
  "xmglobal.com",
  "pocketoption.com",
  "olymptrade.com",
  "exness.com",
  "hfm.com",
  "hotforex.com",
  "tickmill.com",
  "icmarkets.com",
  "pepperstone.com",
  "avatrade.com",
  "ig.com",
  "admiralmarkets.com",
  "admirals.com",
  "xtb.com",
  "deriv.com",
  "fbs.com",
  "octafx.com",
  "octa.com",
  "roboforex.com",
  "fxtm.com",
  "vantage.co",
  "fxpro.com",
  "litefinance.com",
  "m4markets.com",
  "gdmfx.com",
  "activtrades.com",
  "activtrades.bs",
  "activtrades.mu",
  "icm.com",
  "icm.ae",
  "paxcapitals.com",
  "homebroker.com",
  "insurebroker.pt",
  "ifcmarkets.com",
  "ampglobal.com",
  "atfx.com",
  "multibankfx.com",
  "multibankgroup.com",
  "blackbull.com",
  "orbex.com",
  "tigerwit.com",
  "xtreamforex.com",
  "iqoption.com",
  "zeromarkets.com",
  "exness-track.com",
  "exnesstrack.net",
  "one.exness-track.com",
  "one.exnesstrack.net",
  "myforexfunds.com",
  "radexmarkets.com",
  "ptfbs.com",
  "qxbroker.com",
  "ictrading.com",
  "dooprime.com",
  "infinox.com",
  "spartanbrokers.com",
  "puprime.com",
  "vexatrade.ai",
  "gate.com",
  "fundednext.com",
  "the5ers.com",
  "x-funded.com",
  "equiticlients.com",
  "binary.com",
  "bybit.com",
  "binance.com",
  "coinbase.com",
  "kraken.com",
  "bit2me.com",
  "paybis.com",
  "simpleeswap.com",
  "tangem.com",
  "onekey.so",
  "genialinvestimentos.com.br",
  "assets.xm-cdn.com",
  "xm-cdn.com",
  "hugedomains.com",
  "godaddy.com",
  "namecheap.com"
];

const BAD_URL_PATTERNS = [
  /\/s\/desktop\//i,
  /\/jsbin\//i,
  /favicon/i,
  /initplayback/i,
  /error_204/i,
  /csi_204/i,
  /\/installer\/download\//i,
  /(?:\\n|%5cn|\/n[a-z0-9])/i,
  /cart\.php/i,
  /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|eot|mp4|webm|m3u8|pdf)\/?(?:[?#].*)?$/i
];

const BLOCKED_SOCIAL_HANDLES = [
  "whatsapp",
  "whatsappforbusiness",
  "whatsappbusiness",
  "meta",
  "tiktok",
  "twitter",
  "x",
  "linkedin",
  "instagram",
  "youtube",
  "vidiq",
  "vidiqapp",
  "grammarly",
  "eventbrite",
  "eventbritehelp",
  "paxcapitals",
  "yapo.cl",
  "kankyojpn.gov",
  "superhuman",
  "jotform",
  "whop",
  "whophq",
  "wordpresscom"
];

const BLOCKED_EMAIL_FRAGMENTS = [
  "linktr.ee",
  "vidiq.com",
  "patreon.com",
  "amazon.com",
  "eventbrite.com",
  "grammarly.com",
  "readymag.com",
  "theice.com",
  "houstondynamo.com",
  "readytogo.net",
  "moneysavingexpert.com",
  "studio1.de",
  "socialmediastatistik.de",
  "gdprlocal.com",
  "sentry.io",
  "sentry.wixpress.com",
  "wixpress.com",
  "wix.com",
  "tiktok.com",
  "twitter.com",
  "whatsapp.com",
  "intercom.io",
  "onekey.so",
  "vexatrade.ai",
  "puprime.com",
  "xtb.com",
  "xmglobal.com",
  "infinox.com",
  "fundednext.com",
  "the5ers.com",
  "x-funded.com",
  "fxpro.com",
  "litefinance.com",
  "m4markets.com",
  "gdmfx.com",
  "activtrades.com",
  "activtrades.bs",
  "activtrades.mu",
  "icm.com",
  "icm.ae",
  "paxcapitals.com",
  "homebroker.com",
  "insurebroker.pt",
  "skool.com",
  "businessinsider.com",
  "example.com",
  "example.org",
  "example.net",
  "exemplo.com",
  "email.com"
];

const FORM_JUNK_PATTERNS = [
  /login/i,
  /register/i,
  /registration/i,
  /sign[-_ ]?up/i,
  /signin/i,
  /shopping[_-]?cart/i,
  /domain[_-]?search/i,
  /password/i,
  /promo[_-]?code/i,
  /checkout/i
];

export function isShortenerUrl(url) {
  const domain = domainOf(url);
  return SHORTENER_DOMAINS.some((shortener) => domain === shortener || domain.endsWith(`.${shortener}`));
}

export function isLinkHubUrl(url) {
  const domain = domainOf(url);
  return LINK_HUB_DOMAINS.some((hub) => domain === hub || domain.endsWith(`.${hub}`));
}

export function isBlockedLinkUrl(url) {
  const clean = safeUrl(url);
  if (!clean) return true;
  const domain = domainOf(clean);
  if (!domain) return true;
  if (BLOCKED_LINK_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return true;
  return BAD_URL_PATTERNS.some((pattern) => pattern.test(clean));
}

export function isBrokerOrReferralUrl(url) {
  const clean = safeUrl(url);
  if (!clean) return false;
  const domain = domainOf(clean);
  if (BROKER_OR_REFERRAL_DOMAINS.some((broker) => domain === broker || domain.endsWith(`.${broker}`))) return true;
  try {
    const parsed = new URL(clean);
    const pathAndQuery = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    return /(?:^\/r\/|\/r\/|affiliate-program|register|registration|login|signup|sign-up|campaign|promo_code|utm_source=affiliate|utm_medium=affiliate|ref=|referral|affid|affiliate_id|partner_id|wpam_id|ppu=|clickid=|lid=)/i.test(
      pathAndQuery
    );
  } catch {
    return false;
  }
}

function isGenericWhatsAppUrl(url) {
  const clean = safeUrl(url);
  if (!clean) return true;
  if (/%20\d/i.test(clean)) return true;
  const domain = domainOf(clean);
  if (domain === "wa.me") {
    try {
      return !/\d{8,}/.test(new URL(clean).pathname);
    } catch {
      return true;
    }
  }
  if (domain === "api.whatsapp.com" || domain === "web.whatsapp.com") {
    try {
      return !/\d{8,}/.test(new URL(clean).searchParams.get("phone") || "");
    } catch {
      return true;
    }
  }
  if (domain === "whatsapp.com" || domain.endsWith(".whatsapp.com")) return true;
  return false;
}

function looksLikeProfilePath(url, blockedPrefixes = []) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return false;
    const first = parts[0].toLowerCase();
    if (blockedPrefixes.includes(first)) return false;
    if (BLOCKED_SOCIAL_HANDLES.includes(first)) return false;
    return /^[a-z0-9_.-]{2,80}$/i.test(first);
  } catch {
    return false;
  }
}

function isUsefulLinkHubProfileUrl(url) {
  return looksLikeProfilePath(url, [
    "s",
    "privacy",
    "marketplace",
    "features",
    "templates",
    "pricing",
    "link-in-bio",
    "solutions",
    "about",
    "blog",
    "help"
  ]);
}

export function isUsefulDirectContactUrl(url) {
  const clean = safeUrl(url);
  if (!clean || isBlockedLinkUrl(clean) || isBrokerOrReferralUrl(clean)) return false;
  const domain = domainOf(clean);
  if (domain === "wa.me" || domain === "api.whatsapp.com" || domain === "web.whatsapp.com") return !isGenericWhatsAppUrl(clean);
  if (domain === "calendly.com") return looksLikeProfilePath(clean, ["about", "pricing", "integrations"]);
  if (domain === "t.me" || domain === "telegram.me") return looksLikeProfilePath(clean, ["share", "iv", "proxy"]);
  if (domain === "discord.gg") return looksLikeProfilePath(clean);
  if (domain === "linkedin.com" || domain.endsWith(".linkedin.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      const section = (parts[0] || "").toLowerCase();
      if (section === "feed" && (parts[1] || "").toLowerCase() === "update") return true;
      if (!["in", "company", "posts"].includes(section) || parts.length < 2) return false;
      return !BLOCKED_SOCIAL_HANDLES.includes(parts[1].toLowerCase());
    } catch {
      return false;
    }
  }
  if (domain === "instagram.com" || domain.endsWith(".instagram.com")) {
    return looksLikeProfilePath(clean, ["p", "reel", "reels", "stories", "explore", "accounts", "about", "privacy", "terms"]);
  }
  if (domain === "x.com" || domain === "twitter.com") {
    return looksLikeProfilePath(clean, ["i", "share", "intent", "search", "home", "tos", "privacy", "settings"]);
  }
  if (domain === "threads.net" || domain.endsWith(".threads.net")) {
    return looksLikeProfilePath(clean, ["privacy", "terms", "login"]);
  }
  if (domain === "tiktok.com" || domain.endsWith(".tiktok.com")) {
    try {
      const pathname = new URL(clean).pathname;
      const handle = pathname.replace(/^\/@/, "").replace(/\/$/, "").toLowerCase();
      return /^\/@[^/]+\/?$/i.test(pathname) && !BLOCKED_SOCIAL_HANDLES.includes(handle);
    } catch {
      return false;
    }
  }
  if (domain === "facebook.com" || domain.endsWith(".facebook.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      if (!parts.length) return false;
      const first = parts[0].toLowerCase();
      const second = (parts[1] || "").toLowerCase();
      if (["groups", "pages"].includes(first) && parts[1]) return !BLOCKED_SOCIAL_HANDLES.includes(second);
      return parts.length === 1 && !["share", "privacy", "terms", "marketplace", "watch", "reel"].includes(first) && !BLOCKED_SOCIAL_HANDLES.includes(first);
    } catch {
      return false;
    }
  }
  if (domain === "reddit.com" || domain.endsWith(".reddit.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return ["user", "u"].includes((parts[0] || "").toLowerCase()) && parts[1];
    } catch {
      return false;
    }
  }
  if (domain === "tradingview.com" || domain.endsWith(".tradingview.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return (parts[0] || "").toLowerCase() === "u" && parts[1];
    } catch {
      return false;
    }
  }
  if (domain === "myfxbook.com" || domain.endsWith(".myfxbook.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return ["members", "portfolio", "community"].includes((parts[0] || "").toLowerCase()) && parts[1];
    } catch {
      return false;
    }
  }
  if (domain === "mql5.com" || domain.endsWith(".mql5.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return (parts[0] || "").toLowerCase() === "en" && ["signals", "users"].includes((parts[1] || "").toLowerCase()) && parts[2];
    } catch {
      return false;
    }
  }
  if (domain === "fxblue.com" || domain.endsWith(".fxblue.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return (parts[0] || "").toLowerCase() === "users" && parts[1];
    } catch {
      return false;
    }
  }
  if (domain === "zulutrade.com" || domain.endsWith(".zulutrade.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return (parts[0] || "").toLowerCase() === "trader" && parts[1];
    } catch {
      return false;
    }
  }
  if (domain === "darwinex.com" || domain.endsWith(".darwinex.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return (parts[0] || "").toLowerCase() === "darwin" && parts[1];
    } catch {
      return false;
    }
  }
  if (domain === "signalstart.com" || domain.endsWith(".signalstart.com")) {
    try {
      const parts = new URL(clean).pathname.split("/").filter(Boolean);
      return (parts[0] || "").toLowerCase() === "analysis" && parts[1];
    } catch {
      return false;
    }
  }
  if (isLinkHubUrl(clean)) return isUsefulLinkHubProfileUrl(clean);
  return false;
}

export function cleanLinks(links = [], options = {}) {
  const allowBroker = Boolean(options.allowBroker);
  const allowYouTubeChannels = options.allowYouTubeChannels !== false;
  const allowShorteners = Boolean(options.allowShorteners);
  return unique(links)
    .map((url) => safeUrl(url))
    .filter(Boolean)
    .filter((url) => {
      if (isBlockedLinkUrl(url)) return false;
      if (!allowBroker && isBrokerOrReferralUrl(url)) return false;
      if (!allowShorteners && isShortenerUrl(url)) return false;
      const domain = domainOf(url);
      if (isLinkHubUrl(url) && !isUsefulLinkHubProfileUrl(url)) return false;
      if (domain === "youtube.com" || domain.endsWith(".youtube.com")) {
        if (!allowYouTubeChannels) return false;
        try {
          const pathname = new URL(url).pathname;
          return /^\/(?:@|channel\/|c\/|user\/)/i.test(pathname);
        } catch {
          return false;
        }
      }
      if (domain === "youtu.be") return false;
      if (domain === "tiktok.com" || domain.endsWith(".tiktok.com")) {
        try {
          return /^\/@[^/]+\/?$/i.test(new URL(url).pathname);
        } catch {
          return false;
        }
      }
      if ((domain === "whatsapp.com" || domain.endsWith(".whatsapp.com")) && isGenericWhatsAppUrl(url)) return false;
      return true;
    });
}

export function cleanEmails(emails = []) {
  return unique(emails)
    .map((email) => String(email || "").trim().toLowerCase())
    .filter((email) => {
      if (!email || email.includes("u00") || email.includes("\\u")) return false;
      if (/%[0-9a-f]{2}/i.test(email)) return false;
      if (BLOCKED_EMAIL_FRAGMENTS.some((fragment) => email.includes(fragment))) return false;
      const [local] = email.split("@");
      if (/^n?email-/.test(local)) return false;
      if (/^(?:you|your|name|nome|email|mail|test|teste|example|exemplo|joao|john\.?appleseed)$/.test(local)) return false;
      if (/^(?:no-?reply|donotreply|do-not-reply|noreply)$/.test(local)) return false;
      if (/^\d{2,}/.test(local)) return false;
      if (local.includes(".com") || local.includes(".net") || local.includes(".org")) return false;
      if (/^[a-f0-9]{24,}$/.test(local)) return false;
      if (email.includes("example.") || email.includes("email@") || email.includes("domain.")) return false;
      const domainPart = email.split("@")[1] || "";
      const cleanDomain = domainPart.replace(/^www\./, "").toLowerCase();
      if (BROKER_OR_REFERRAL_DOMAINS.some((broker) => cleanDomain === broker || cleanDomain.endsWith(`.${broker}`))) return false;
      if (/\.(?:method|nelson)$/i.test(cleanDomain)) return false;
      if (/instagraminstagram|facebookfacebook|youtubeyoutube|socials/i.test(local)) return false;
      if (/\.(?:com|net|org|co|io|ai|br|mx|es|pt|in|uk)[a-z]{2,}/i.test(domainPart)) return false;
      if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(email)) return false;
      return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/i.test(email);
    })
    .slice(0, 8);
}

export function cleanPhoneNumbers(phones = []) {
  return unique(phones)
    .map((phone) => normalizeWhitespace(phone).replace(/\s+/g, " "))
    .filter((phone) => {
      const raw = phone.trim();
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 16) return false;
      if (!raw.startsWith("+") && !raw.startsWith("00")) return false;
      if (raw.startsWith("00") && /[().]/.test(raw)) return false;
      if (raw.startsWith("00") && !/^00[1-9]\d{9,14}$/.test(digits)) return false;
      if (/^000/.test(digits)) return false;
      if (/^20\d{6,}/.test(digits)) return false;
      return true;
    })
    .slice(0, 8);
}

export function cleanForms(forms = []) {
  const seen = new Set();
  return forms
    .filter((form) => {
      const pageUrl = safeUrl(form.pageUrl || "");
      const action = safeUrl(form.action || pageUrl || "");
      const combined = `${pageUrl || ""} ${action || ""} ${(form.fields || []).join(" ")} ${form.label || ""}`;
      if (!pageUrl && !action) return false;
      if (isBlockedLinkUrl(pageUrl || action) || isBrokerOrReferralUrl(pageUrl || action)) return false;
      if (action && isBrokerOrReferralUrl(action)) return false;
      if (FORM_JUNK_PATTERNS.some((pattern) => pattern.test(combined))) return false;

      const lower = combined.toLowerCase();
      const hasContactIntent = /contact|contacto|contato|partner|partnership|affiliate|afiliado|book|call|message|mensagem|mensaje/.test(
        lower
      );
      const fields = (form.fields || []).map((field) => String(field).toLowerCase());
      const hasConversationFields =
        fields.some((field) => /message|mensagem|mensaje|comment|subject|phone|telefone|whatsapp/.test(field)) &&
        fields.some((field) => /email|name|nome|nombre|phone|telefone|whatsapp/.test(field));
      return hasContactIntent || hasConversationFields;
    })
    .filter((form) => {
      const key = `${form.pageUrl || ""}|${form.action || ""}|${(form.fields || []).join(";")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function hasDirectOutboundPath(lead) {
  return cleanLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])], {
    allowYouTubeChannels: false
  }).some(isUsefulDirectContactUrl);
}
