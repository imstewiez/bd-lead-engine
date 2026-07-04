import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanEmails,
  cleanForms,
  cleanLinks as cleanContactLinks,
  cleanPhoneNumbers,
  hasDirectOutboundPath,
  isUsefulDirectContactUrl
} from "./contact-cleaner.js";
import { getRootDir, readDb } from "./store.js";
import { hasSearchableLeadSignal, hasStrictTradingIcp, isHardRejectedLead } from "./lead-quality.js";
import { isHotLead, qualifyLead } from "./qualification.js";
import { platformFromUrl, toCsvCell, unique } from "./utils.js";

const rootDir = getRootDir();

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFileWithRetry(targetPath, content, attempts = 8) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, "utf8");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return targetPath;
    } catch (error) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code) || attempt === attempts) {
        const fallbackPath = `${targetPath}.${Date.now()}.fallback`;
        await fs.rename(tempPath, fallbackPath).catch(async () => {
          await fs.writeFile(fallbackPath, content, "utf8");
        });
        throw new Error(`Could not update ${targetPath}: ${error.message}. Fallback written to ${fallbackPath}`);
      }
      await sleep(250 * attempt);
    }
  }
  return targetPath;
}

function directLinks(lead) {
  return cleanContactLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])], {
    allowYouTubeChannels: false
  }).filter(isUsefulDirectContactUrl);
}

function formsSummary(lead) {
  return cleanForms(lead.forms || []).map((form) => {
    const fields = (form.fields || []).join("; ");
    return `${form.pageUrl || form.action || ""} -> ${form.action || ""}${fields ? ` [${fields}]` : ""}`;
  });
}

export function hasActionableContact(lead) {
  const emails = cleanEmails(lead.emails || []);
  const forms = cleanForms(lead.forms || []);
  const links = directLinks(lead);
  return (
    emails.length > 0 ||
    forms.length > 0 ||
    links.length > 0 ||
    hasDirectOutboundPath(lead)
  );
}

export function isExportQualified(lead) {
  const url = String(lead.url || "");
  const platform = lead.platform || platformFromUrl(url);
  if (!url || !platform) return false;
  if (platform === "YouTube" || /youtube\.com|youtu\.be/i.test(url)) return false;
  if ((lead.score || 0) < 58) return false;
  if (lead.priority === "D") return false;
  if (lead.segment === "Broker Site") return false;
  if (isHardRejectedLead(lead)) return false;
  if (!hasStrictTradingIcp(lead)) return false;
  if (!hasActionableContact(lead)) return false;
  if (/youtube\.com|youtu\.be/i.test(String(lead.url || "")) && !hasSearchableLeadSignal(lead)) return false;
  if (!["partner", "recruitment", "institution"].includes(lead.leadType)) return false;
  const text = `${lead.name} ${lead.title} ${lead.snippet} ${lead.url}`.toLowerCase();
  if (
    /metatrader|login|download|review|spreads|how to open an account|trading platform|trusted global partner|forex factory|fxstreet|currency exchange rates|international money transfers|how to start forex trading|how to start trading|step-by-step beginner|trading simulator|practice day trading|track all markets|doutorfinancas|o que e e como funciona|o que é e como funciona|guia completo investir|tradingview\.com\/?(?:chart\/?)?$|investing\.com|investopedia|interactive brokers|interactivebrokers\.com|definition|pronunciation|usage notes|dictionary|oxfordlearnersdictionaries|merriam-webster|cambridge dictionary|collins dictionary|vocabulary\.com|thesaurus|academia\.edu|academia residence|select your room|bergamo-it\.com|italia\.it|what to see/.test(
      text
    )
  ) {
    return false;
  }
  if (/cheyenne frontier days|frontier days|computational fluid dynamics/.test(text)) {
    return false;
  }
  if (
    /cursor: ai coding|learn cursor|udemy|fundacao bradesco|fundação bradesco|escola virtual|sebrae|edutin|cursos online|curso online|romanian academy|barça academy|barca academy|bloomberg|reuters|cnbc|mining weekly|miningweekly|focus-economics|yahoo finance|equity research|investment banking|credit analyst|fixed income analyst|bank analyst|chief economist|macroeconomist/.test(text)
  ) {
    return false;
  }
  if (/\b(curso|cursos|course|courses|academy|academia|school|escola|universidad|university)\b/.test(text) && !/forex|fx |xauusd|gold|trading|trader|broker|corretora|copy trading|signals|sinais|señales|senales|invest|financial|financ/.test(text)) {
    return false;
  }
  if (/\b(analyst|economist|research|bank|banco|finance news|market news)\b/.test(text) && !/forex trader|fx trader|xauusd|gold trader|portfolio manager|fund manager|asset manager|copy trading|pamm|mam|introducing broker|affiliate/.test(text)) {
    return false;
  }
  if (
    lead.leadType !== "recruitment" &&
    /^@?(exness|xm|octa|fbs|hfm|hotforex|tickmill|ironfx|iron ?fx|dukascopy|pepperstone|avatrade|deriv|ic ?markets|infinox|forex\.com|roboforex|fxtm|vantage|dooprime|pocket ?option|iq ?option|olymp ?trade|gdmfx)\b/i.test(
      String(lead.name || "")
    )
  ) {
    return false;
  }
  return true;
}

function sortLeads(a, b) {
  const contactA = Number(a.contactConfidence || 0);
  const contactB = Number(b.contactConfidence || 0);
  const platformRank = (lead) => {
    const platform = String(lead.platform || "").toLowerCase();
    const url = String(lead.url || "").toLowerCase();
    if (/linkedin/.test(platform) || /linkedin\.com/.test(url)) return 0;
    if (/instagram/.test(platform) || /instagram\.com/.test(url)) return 1;
    if (/x\/twitter|twitter/.test(platform) || /x\.com|twitter\.com/.test(url)) return 2;
    if (/telegram|discord|tiktok|facebook/.test(platform) || /t\.me|telegram|discord|tiktok|facebook/.test(url)) return 3;
    if (/myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview/.test(platform) || /myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview/.test(url)) return 4;
    if (/mql5/.test(platform) || /mql5\.com/.test(url)) return 12;
    if (/youtube/.test(platform) || /youtube\.com|youtu\.be/.test(url)) return 30;
    return 8;
  };
  return (
    platformRank(a) - platformRank(b) ||
    (b.score || 0) - (a.score || 0) ||
    contactB - contactA ||
    String(b.lastSeen || "").localeCompare(String(a.lastSeen || ""))
  );
}

function canonicalLeadKey(lead) {
  const emails = cleanEmails(lead.emails || []);
  if (emails.length) return `email:${emails[0]}`;
  try {
    const parsed = new URL(lead.url);
    parsed.hash = "";
    parsed.search = "";
    const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    if ((domain === "youtube.com" || domain.endsWith(".youtube.com")) && parts.length) {
      return `youtube:${parts.slice(0, 2).join("/").toLowerCase()}`;
    }
    if ((domain === "instagram.com" || domain.endsWith(".instagram.com")) && parts[0]) return `instagram:${parts[0].toLowerCase()}`;
    if ((domain === "linkedin.com" || domain.endsWith(".linkedin.com")) && parts.length >= 2) return `linkedin:${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
    if ((domain === "x.com" || domain === "twitter.com") && parts[0]) return `x:${parts[0].toLowerCase()}`;
    if ((domain === "t.me" || domain === "telegram.me") && parts[0]) return `telegram:${parts[0].toLowerCase()}`;
    return `url:${domain}${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return `name:${String(lead.name || "").toLowerCase()}`;
  }
}

export function dedupeLeads(leads) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = canonicalLeadKey(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function filterAndDedupeLeads(leads, options = {}) {
  return dedupeLeads(leads
    .filter(options.includeRaw ? () => true : isExportQualified)
    .sort(sortLeads));
}

function formatDecisionMakers(decisionMakers = []) {
  return decisionMakers
    .map((person) =>
      [person.name, person.title, person.url]
        .filter(Boolean)
        .join(" | ")
    )
    .join("; ");
}

function socialProfileLinks(lead) {
  return cleanContactLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || []), ...(lead.relatedLinks || [])], {
    allowYouTubeChannels: true,
    allowShorteners: true
  })
    .filter((url) => {
      if (/\/(?:share|sharer|intent)\b|facebook\.com\/tr\?|[?&]ev=PageView|\/p\/signin/i.test(url)) return false;
      if (isUsefulDirectContactUrl(url)) return true;
      try {
        const parsed = new URL(url);
        const parts = parsed.pathname.split("/").filter(Boolean);
        const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
        if ((domain === "youtube.com" || domain.endsWith(".youtube.com")) && /^\/(?:@|channel\/|c\/|user\/)/i.test(parsed.pathname)) return true;
        if ((domain === "instagram.com" || domain.endsWith(".instagram.com")) && parts.length === 1) return true;
        if ((domain === "linkedin.com" || domain.endsWith(".linkedin.com")) && ["in", "company"].includes((parts[0] || "").toLowerCase())) return true;
        return false;
      } catch {
        return false;
      }
    })
    .slice(0, 14);
}

function postForumLinks(lead) {
  return unique([lead.url, ...(lead.relatedLinks || []), ...(lead.contactSources || [])])
    .filter((url) => /linkedin\.com\/(?:posts|feed\/update)|instagram\.com\/p\/|x\.com\/.+\/status|twitter\.com\/.+\/status|reddit\.com\/r\/|forexfactory\.com|babypips\.com|tradingview\.com\/(?:ideas|chart)|facebook\.com\/(?:ads|posts|groups)/i.test(url))
    .slice(0, 12);
}

function socialTextFor(lead) {
  return [
    lead.url,
    lead.platform,
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.relatedLinks || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function researchSummary(lead, qualification) {
  const platform = lead.platform || platformFromUrl(lead.url);
  const evidence = (lead.evidence || []).slice(0, 3).join("; ");
  const audience = lead.audience ? `Audience: ${lead.audience}.` : "";
  const contact = qualification.bestChannel ? `Best channel: ${qualification.bestChannel}.` : "";
  const redFlags = qualification.redFlags.length ? `Red flags: ${qualification.redFlags.join("; ")}.` : "";
  return [
    `${platform || "Web"} lead in ${lead.segment || "Unclear"} for ${qualification.opportunityPlay}.`,
    evidence ? `Signals: ${evidence}.` : "",
    audience,
    contact,
    redFlags
  ]
    .filter(Boolean)
    .join(" ");
}

export function leadToExportRow(lead) {
  const qualification = qualifyLead(lead);
  const links = directLinks(lead);
  const websites = cleanContactLinks(lead.websiteLinks || [], { allowYouTubeChannels: false });
  const relatedLinks = cleanContactLinks(lead.relatedLinks || [], { allowYouTubeChannels: false });
  const emails = cleanEmails(lead.emails || []);
  const phones = cleanPhoneNumbers(lead.phoneNumbers || []);
  const forms = cleanForms(lead.forms || []);
  const firstForm = forms[0]?.pageUrl || forms[0]?.action || "";
  const primaryContact =
    emails[0] ||
    links.find((url) => /wa\.me|whatsapp|calendly/i.test(url)) ||
    links[0] ||
    firstForm ||
    websites[0] ||
    lead.url;

  return {
    icpTier: qualification.icpTier,
    meetingPriority: qualification.meetingPriority,
    opportunityPlay: qualification.opportunityPlay,
    sourcePlatform: lead.platform || platformFromUrl(lead.url),
    bestChannel: qualification.bestChannel,
    nextAction: qualification.nextAction,
    decisionMakerLikelihood: qualification.decisionMakerLikelihood,
    decisionMakers: formatDecisionMakers(qualification.decisionMakers),
    decisionMakerLinks: qualification.decisionMakerLinks.join("; "),
    whyThisLead: qualification.whyThisLead,
    researchSummary: researchSummary(lead, qualification),
    qualificationReasons: qualification.qualificationReasons.join("; "),
    redFlags: qualification.redFlags.join("; "),
    priority: lead.priority,
    score: lead.score,
    contactConfidence: lead.contactConfidence || "",
    contactQuality: lead.contactQuality || "",
    leadType: lead.leadType,
    segment: lead.segment,
    stage: lead.stage,
    name: lead.name,
    country: lead.country,
    languages: (lead.languages || []).join("; "),
    source: lead.source,
    sourceQuery: lead.query,
    primaryUrl: lead.url,
    primaryContact,
    emails: emails.join("; "),
    phones: phones.join("; "),
    forms: formsSummary(lead).join(" | "),
    directLinks: links.join("; "),
    socialProfiles: socialProfileLinks(lead).join("; "),
    postForumLinks: postForumLinks(lead).join("; "),
    websites: websites.join("; "),
    relatedLinks: relatedLinks.join("; "),
    contactSources: cleanContactLinks(lead.contactSources || [], { allowYouTubeChannels: false }).join("; "),
    evidence: (lead.evidence || []).join("; "),
    audience: lead.audience || "",
    context: lead.snippet || "",
    outboundDm: lead.outbound?.dm || "",
    followUp: lead.outbound?.followUp || "",
    firstSeen: lead.firstSeen || "",
    lastSeen: lead.lastSeen || "",
    lastDeepEnrichedAt: lead.lastDeepEnrichedAt || ""
  };
}

export async function exportLeads(options = {}) {
  const db = await readDb();
  const leads = filterAndDedupeLeads(db.leads, options);
  const contactableLeads = leads.filter(hasActionableContact);
  const hotLeads = leads.filter(isHotLead);
  const socialLeads = leads.filter((lead) => socialProfileLinks(lead).length || /linkedin|instagram|x\/twitter|facebook|tiktok|threads|reddit|telegram|tradingview/i.test(lead.platform || ""));
  const instagramLeads = leads.filter((lead) => /instagram\.com/.test(socialTextFor(lead)));
  const linkedinLeads = leads.filter((lead) => /linkedin\.com/.test(socialTextFor(lead)));
  const xLeads = leads.filter((lead) => /(x\.com|twitter\.com)/.test(socialTextFor(lead)));

  const columns = [
    "icpTier",
    "meetingPriority",
    "opportunityPlay",
    "sourcePlatform",
    "bestChannel",
    "nextAction",
    "decisionMakerLikelihood",
    "decisionMakers",
    "decisionMakerLinks",
    "whyThisLead",
    "researchSummary",
    "qualificationReasons",
    "redFlags",
    "priority",
    "score",
    "contactConfidence",
    "contactQuality",
    "leadType",
    "segment",
    "stage",
    "name",
    "country",
    "languages",
    "source",
    "sourceQuery",
    "primaryUrl",
    "primaryContact",
    "emails",
    "phones",
    "forms",
    "directLinks",
    "socialProfiles",
    "postForumLinks",
    "websites",
    "relatedLinks",
    "contactSources",
    "evidence",
    "audience",
    "context",
    "outboundDm",
    "followUp",
    "firstSeen",
    "lastSeen",
    "lastDeepEnrichedAt"
  ];

  const rows = [
    columns.join(","),
    ...leads.map((lead) => {
      const row = leadToExportRow(lead);
      return columns.map((column) => toCsvCell(row[column])).join(",");
    })
  ];

  const csvPath = path.join(rootDir, options.csvName || "autopilot-leads.csv");
  const jsonPath = path.join(rootDir, options.jsonName || "autopilot-leads.json");
  const contactCsvPath = path.join(rootDir, options.contactCsvName || "autopilot-contactable-leads.csv");
  const contactJsonPath = path.join(rootDir, options.contactJsonName || "autopilot-contactable-leads.json");
  const contactRows = [
    columns.join(","),
    ...contactableLeads.map((lead) => {
      const row = leadToExportRow(lead);
      return columns.map((column) => toCsvCell(row[column])).join(",");
    })
  ];
  const hotCsvPath = path.join(rootDir, options.hotCsvName || "autopilot-hot-leads.csv");
  const hotJsonPath = path.join(rootDir, options.hotJsonName || "autopilot-hot-leads.json");
  const rowsFor = (leadSet) => [
    columns.join(","),
    ...leadSet.map((lead) => {
      const row = leadToExportRow(lead);
      return columns.map((column) => toCsvCell(row[column])).join(",");
    })
  ];
  const hotRows = rowsFor(hotLeads);
  const socialCsvPath = path.join(rootDir, options.socialCsvName || "autopilot-social-leads.csv");
  const socialJsonPath = path.join(rootDir, options.socialJsonName || "autopilot-social-leads.json");
  const instagramCsvPath = path.join(rootDir, options.instagramCsvName || "autopilot-instagram-leads.csv");
  const instagramJsonPath = path.join(rootDir, options.instagramJsonName || "autopilot-instagram-leads.json");
  const linkedinCsvPath = path.join(rootDir, options.linkedinCsvName || "autopilot-linkedin-leads.csv");
  const linkedinJsonPath = path.join(rootDir, options.linkedinJsonName || "autopilot-linkedin-leads.json");
  const xCsvPath = path.join(rootDir, options.xCsvName || "autopilot-x-leads.csv");
  const xJsonPath = path.join(rootDir, options.xJsonName || "autopilot-x-leads.json");
  await writeFileWithRetry(csvPath, `\ufeff${rows.join("\n")}\n`);
  await writeFileWithRetry(jsonPath, `${JSON.stringify(leads.map(leadToExportRow), null, 2)}\n`);
  await writeFileWithRetry(contactCsvPath, `\ufeff${contactRows.join("\n")}\n`);
  await writeFileWithRetry(contactJsonPath, `${JSON.stringify(contactableLeads.map(leadToExportRow), null, 2)}\n`);
  await writeFileWithRetry(hotCsvPath, `\ufeff${hotRows.join("\n")}\n`);
  await writeFileWithRetry(hotJsonPath, `${JSON.stringify(hotLeads.map(leadToExportRow), null, 2)}\n`);
  await writeFileWithRetry(socialCsvPath, `\ufeff${rowsFor(socialLeads).join("\n")}\n`);
  await writeFileWithRetry(socialJsonPath, `${JSON.stringify(socialLeads.map(leadToExportRow), null, 2)}\n`);
  await writeFileWithRetry(instagramCsvPath, `\ufeff${rowsFor(instagramLeads).join("\n")}\n`);
  await writeFileWithRetry(instagramJsonPath, `${JSON.stringify(instagramLeads.map(leadToExportRow), null, 2)}\n`);
  await writeFileWithRetry(linkedinCsvPath, `\ufeff${rowsFor(linkedinLeads).join("\n")}\n`);
  await writeFileWithRetry(linkedinJsonPath, `${JSON.stringify(linkedinLeads.map(leadToExportRow), null, 2)}\n`);
  await writeFileWithRetry(xCsvPath, `\ufeff${rowsFor(xLeads).join("\n")}\n`);
  await writeFileWithRetry(xJsonPath, `${JSON.stringify(xLeads.map(leadToExportRow), null, 2)}\n`);

  return {
    csvPath,
    jsonPath,
    contactCsvPath,
    contactJsonPath,
    hotCsvPath,
    hotJsonPath,
    socialCsvPath,
    socialJsonPath,
    instagramCsvPath,
    instagramJsonPath,
    linkedinCsvPath,
    linkedinJsonPath,
    xCsvPath,
    xJsonPath,
    exported: leads.length,
    contactable: contactableLeads.length,
    hot: hotLeads.length,
    social: socialLeads.length,
    instagram: instagramLeads.length,
    linkedin: linkedinLeads.length,
    x: xLeads.length,
    total: db.leads.length
  };
}
