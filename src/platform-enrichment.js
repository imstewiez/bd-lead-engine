import { domainOf, normalizeWhitespace, safeUrl, unique } from "./utils.js";
import { cleanForms, cleanLinks, cleanPhoneNumbers, isUsefulDirectContactUrl } from "./contact-cleaner.js";
import { filterDecisionMakerEmails } from "./platform-contact-policy.js";

const PLATFORM_DOMAINS = [
  "myfxbook.com",
  "mql5.com",
  "tradingview.com",
  "fxblue.com",
  "zulutrade.com",
  "darwinex.com",
  "signalstart.com",
  "collective2.com",
  "forexfactory.com",
  "babypips.com"
];

export function isDomainOrSubdomain(domain = "", root = "") {
  return domain === root || domain.endsWith(`.${root}`);
}

export function isPlatformProfileDomain(domain = "") {
  return PLATFORM_DOMAINS.some((platform) => isDomainOrSubdomain(domain, platform));
}

export function isPlatformProfileUrl(url = "") {
  return isPlatformProfileDomain(domainOf(url));
}

export function isDecisionContactUrl(url = "") {
  return isUsefulDirectContactUrl(url) && !isPlatformProfileUrl(url);
}

export function cleanDecisionContactLinks(links = [], options = {}) {
  return cleanLinks(links, {
    allowYouTubeChannels: false,
    allowShorteners: true,
    ...options
  }).filter(isDecisionContactUrl);
}

export function bareWebsiteUrls(text = "") {
  return unique(
    [...String(text).matchAll(/(?:^|[\s"'(>])((?:www\.)[a-z0-9][a-z0-9.-]+\.[a-z]{2,24}(?:\/[^\s"'<>)}\]]*)?)/gi)]
      .map((match) => match[1])
      .filter(Boolean)
      .map((url) => safeUrl(`https://${url.replace(/[.,;]+$/, "")}`))
      .filter(Boolean)
  );
}

export function isGenericContactTrailName(name = "") {
  const normalized = normalizeWhitespace(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized || normalized.length < 3) return true;
  if (/^(?:forex|fx|gold|xauusd|crypto|trading|copy trading|pamm|mam|signals?|forex signals?|forex trader|fx trader|gold trader|xauusd trader|forex fund manager|fund manager|portfolio manager|money manager|asset manager)$/.test(normalized)) return true;
  if (/^(?:forex|fx|gold|xauusd|crypto) (?:fund manager|portfolio manager|money manager|asset manager|trader|signals?|copy trading)$/.test(normalized)) return true;
  return false;
}

export function pickBestContact(lead = {}) {
  const emails = filterDecisionMakerEmails(lead);
  const phones = cleanPhoneNumbers(lead.phoneNumbers || []);
  const direct = cleanDecisionContactLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])]);
  const forms = cleanForms(lead.forms || []);
  const websites = cleanLinks(lead.websiteLinks || [], { allowYouTubeChannels: false, allowShorteners: true }).filter((url) => !isPlatformProfileUrl(url));
  const whatsapp = direct.find((url) => /wa\.me|whatsapp/i.test(url));
  const booking = direct.find((url) => /calendly|t\.me|telegram/i.test(url));
  const social = direct.find((url) => !/wa\.me|whatsapp|calendly|t\.me|telegram/i.test(url));

  if (emails[0]) return { bestContact: emails[0], bestContactType: "email", bestContactSource: (lead.contactSources || [])[0] || lead.url || "" };
  if (whatsapp) return { bestContact: whatsapp, bestContactType: "whatsapp", bestContactSource: (lead.contactSources || [])[0] || whatsapp };
  if (phones[0]) return { bestContact: phones[0], bestContactType: "phone", bestContactSource: (lead.contactSources || [])[0] || lead.url || "" };
  if (booking) return { bestContact: booking, bestContactType: "direct-link", bestContactSource: (lead.contactSources || [])[0] || booking };
  if (social) return { bestContact: social, bestContactType: "social", bestContactSource: social };
  if (forms[0]) return { bestContact: forms[0].pageUrl || forms[0].action || "", bestContactType: "form", bestContactSource: forms[0].pageUrl || forms[0].action || "" };
  if (websites[0]) return { bestContact: websites[0], bestContactType: "website", bestContactSource: websites[0] };
  return { bestContact: "", bestContactType: "", bestContactSource: "" };
}
