import { cleanEmails } from "./contact-cleaner.js";
import { domainOf } from "./utils.js";

const PLATFORM_DOMAINS = [
  "myfxbook.com",
  "mql5.com",
  "tradingview.com",
  "fxblue.com",
  "fxbluelabs.com",
  "zulutrade.com",
  "darwinex.com",
  "signalstart.com",
  "collective2.com",
  "forexfactory.com",
  "babypips.com"
];

const GENERIC_LOCALS = /^(?:support|help|info|contact|sales|partner|partners|affiliate|affiliates|hello|team|admin|privacy|legal|service|customerservice|customer\.service)(?:[+._-].*)?$/i;

export function platformRootDomain(domain = "") {
  const clean = String(domain || "").replace(/^www\./i, "").toLowerCase();
  return PLATFORM_DOMAINS.find((root) => clean === root || clean.endsWith(`.${root}`)) || "";
}

export function isPlatformOwnedEmail(email = "", lead = {}) {
  const clean = String(email || "").trim().toLowerCase();
  const [local = "", emailDomainRaw = ""] = clean.split("@");
  const emailRoot = platformRootDomain(emailDomainRaw);
  if (!emailRoot) return false;
  const sourceRoot = platformRootDomain(domainOf(lead.url || lead.bestContactSource || ""));
  if (sourceRoot && sourceRoot === emailRoot) return true;
  return GENERIC_LOCALS.test(local);
}

export function filterDecisionMakerEmails(lead = {}) {
  return cleanEmails(lead.emails || []).filter((email) => !isPlatformOwnedEmail(email, lead));
}

export function stripPlatformOwnedContacts(lead = {}) {
  const emails = filterDecisionMakerEmails(lead);
  const platformBest = lead.bestContactType === "email" && isPlatformOwnedEmail(lead.bestContact, lead);
  return {
    ...lead,
    emails,
    bestContact: platformBest ? "" : lead.bestContact || "",
    bestContactType: platformBest ? "" : lead.bestContactType || "",
    bestContactSource: platformBest ? "" : lead.bestContactSource || ""
  };
}
