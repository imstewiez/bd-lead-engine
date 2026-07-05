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
import { hasSearchableLeadSignal, hasStrictTradingIcp, isHardRejectedLead, leadRejectionReasons } from "./lead-quality.js";
import { classifyLeadEntity, isActualLead, isResearchSource } from "./lead-entity.js";
import { isHotLead, qualifyLead } from "./qualification.js";
import { limitMql5Share, sourceBucket } from "./mql5-limit.js";
import { platformFromUrl, toCsvCell, unique } from "./utils.js";

const rootDir = getRootDir();

const GENERIC_WORKING_DOMAINS = [
  "trading212.com",
  "tipranks.com",
  "valueresearchonline.com",
  "cryptonews.com",
  "literaciafinanceira.pt",
  "oxfordlearnersdictionaries.com",
  "investopedia.com",
  "wikipedia.org"
];

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
    hasDirectOutboundPath(lead) ||
    Boolean(lead.bestContact)
  );
}

function hasDecisionPath(lead = {}) {
  return (lead.decisionMakers || []).length > 0 || (lead.decisionMakerLinks || []).length > 0;
}

function isGenericPlatformPortal(lead = {}) {
  const url = String(lead.url || "").toLowerCase();
  const text = `${lead.name || ""} ${lead.title || ""} ${lead.snippet || ""} ${url}`.toLowerCase();
  return /tradingview\.com\/(?:chart|markets|symbols)|forexfactory\.com\/(?:calendar|news|market|scanner)|mql5\.com\/(?:en\/)?(?:market|forum)\b|pamm\s*(?:rating|rankings?|monitoring|portal|accounts? list)|top pamm|best pamm|ratings? of pamm/.test(text);
}

function requiresValidatedContactBeforeWorklist(lead = {}) {
  const bucket = sourceBucket(lead);
  if (["tradingview", "mql5", "myfxbook", "specialist", "forum"].includes(bucket)) return true;
  if (isGenericPlatformPortal(lead)) return true;
  return false;
}

function hardRejectionReasonsForExport(lead = {}) {
  return leadRejectionReasons(lead).filter((reason) => reason !== "missing strict forex/CFD/trading ICP signal");
}

export function isExportQualified(lead) {
  const url = String(lead.url || "");
  const platform = lead.platform || platformFromUrl(url);
  if (!url || !platform) return false;
  if (platform === "YouTube" || /youtube\.com|youtu\.be/i.test(url)) return false;
  if ((lead.score || 0) < 50) return false;
  if (lead.priority === "D") return false;
  if (lead.segment === "Broker Site") return false;
  if (isHardRejectedLead(lead)) return false;
  if (!hasStrictTradingIcp(lead)) return false;
  if (!hasActionableContact(lead)) return false;
  if (!isActualLead(lead)) return false;
  if (isGenericPlatformPortal(lead)) return false;
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
  if (/cheyenne frontier days|frontier days|computational fluid dynamics/.test(text)) return false;
  if (
    /cursor: ai coding|learn cursor|udemy|fundacao bradesco|fundação bradesco|escola virtual|sebrae|edutin|cursos online|curso online|romanian academy|barça academy|barca academy|bloomberg|reuters|cnbc|mining weekly|miningweekly|focus-economics|yahoo finance|equity research|investment banking|credit analyst|fixed income analyst|bank analyst|chief economist|macroeconomist/.test(text)
  ) {
    return false;
  }
  if (/\b(curso|cursos|course|courses|academy|academia|school|escola|universidad|university)\b/.test(text) && !/forex|fx |xauusd|gold|trading|trader|broker|corretora|copy trading|signals|sinais|señales|senales|invest|financial|financ/.test(text)) return false;
  if (/\b(analyst|economist|research|bank|banco|finance news|market news)\b/.test(text) && !/forex trader|fx trader|xauusd|gold trader|portfolio manager|fund manager|asset manager|copy trading|pamm|mam|introducing broker|affiliate/.test(text)) return false;
  if (
    lead.leadType !== "recruitment" &&
    /^@?(exness|xm|octa|fbs|hfm|hotforex|tickmill|ironfx|iron ?fx|dukascopy|pepperstone|avatrade|deriv|ic ?markets|infinox|forex\.com|roboforex|fxtm|vantage|dooprime|pocket ?option|iq ?option|olymp ?trade|gdmfx)\b/i.test(String(lead.name || ""))
  ) {
    return false;
  }
  return true;
}

function rawLeadText(lead = {}) {
  const cleanSignalText = (value = "") =>
    String(value)
      .replace(/\bMatched public source:.*$/i, " ")
      .replace(/\bSource pack:.*$/i, " ");
  return [
    lead.name,
    lead.title,
    lead.snippet,
    lead.url,
    lead.audience,
    lead.bestContact,
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.websiteLinks || []),
    ...(lead.relatedLinks || [])
  ]
    .filter(Boolean)
    .map(cleanSignalText)
    .join(" ")
    .toLowerCase();
}

export function isWorkingLead(lead) {
  const url = String(lead.url || "");
  const platform = lead.platform || platformFromUrl(url);
  if (!url || !platform) return false;
  const lowerUrl = url.toLowerCase();
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  if (GENERIC_WORKING_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) return false;
  if (platform === "YouTube" || /youtube\.com|youtu\.be/i.test(url)) return false;
  if (/oxfordlearnersdictionaries|merriam-webster|cambridge\.org\/dictionary|collinsdictionary|vocabulary\.com|thesaurus\.com|investopedia|wikipedia|literaciafinanceira\.pt/.test(lowerUrl)) return false;
  if (/forexfactory\.com\/(?:calendar|news|market|scanner)|tradingview\.com\/(?:chart|markets|symbols)\b|cryptonews\.com\/news\/.*(?:fed|payments|stablecoin|crypto)/i.test(lowerUrl)) return false;
  if ((domain === "forexfactory.com" || domain.endsWith(".forexfactory.com")) && pathParts.length === 0) return false;
  if ((domain === "reddit.com" || domain.endsWith(".reddit.com")) && !["user", "u"].includes((pathParts[0] || "").toLowerCase())) return false;
  if ((domain === "instagram.com" || domain.endsWith(".instagram.com")) && ["p", "reel", "reels", "stories", "explore"].includes((pathParts[0] || "").toLowerCase())) return false;
  if ((domain === "x.com" || domain === "twitter.com") && ["i", "share", "intent", "search", "home"].includes((pathParts[0] || "").toLowerCase())) return false;
  if (lead.segment === "Broker Site") return false;
  if (lead.priority === "D" && Number(lead.score || 0) < 45) return false;
  if (!["partner", "recruitment", "institution"].includes(lead.leadType) && lead.qualificationStatus !== "research_candidate") return false;

  const hardReasons = hardRejectionReasonsForExport(lead);
  if (hardReasons.length) return false;
  if (!isActualLead(lead)) return false;

  const bucket = sourceBucket(lead);
  const syntheticSnippet = /^(?:Extracted candidate|Qwant extracted URL)/i.test(String(lead.snippet || ""));
  const text = rawLeadText(syntheticSnippet ? { ...lead, snippet: "" } : lead);
  const malformedSocialTitle = /^\)?\s*(?:[\/•-]?\s*)?(?:instagram photos and videos|posts?\s*\/\s*x(?:\s*-\s*twitter)?|x\s*-\s*twitter)/i;
  if (malformedSocialTitle.test(String(lead.name || "").trim())) return false;
  if (malformedSocialTitle.test(String(lead.title || "").trim())) return false;
  const brokerOfficialNoise = /\b(?:oanda|admiralmarkets|admirals|exness|xm\.com|xmtrading|octafx|octa|fbs|hfm|hotforex|tickmill|icmarkets|ic markets|pepperstone|avatrade|deriv|fxtm|roboforex|vantage|fpmarkets|fp markets|axi\.com|capital\.com|etoro|plus500|cmcmarkets|cmc markets|ig\.com|markets\.com|blackbull|multibank|forex\.com)\b/i.test(text);
  if (brokerOfficialNoise && !/\b(?:introducing broker|affiliate manager|partnership manager|business development|country manager|former|ex-)\b/i.test(text)) return false;
  const actualTradingSignal = /\b(?:forex|fx trader|fx portfolio|xauusd|gold trader|currency trader|currency trading|cfds?|copy trading|signals?|sinais|señales|senales|pamm|mam|mt4|mt5|metatrader|introducing broker|forex affiliate|broker partnership|cpa deal|revshare|trading academy|forex academy|prop firm|funded trader|portfolio manager|fund manager|money manager|asset manager|trading community|algo trader|ea developer)\b/i.test(text);
  const genericFinanceNoise = /\b(?:noções básicas|o que sao|o que são|contratos por diferença|pros e contras|prós e contras|basics of|what is|what are|guide to|guia|explainer|payments innovation|payment solutions|subscription solutions|billing|fed payments|federal reserve|stablecoin|digital assets|crypto news|revolut|stripe|wise|money transfer|currency exchange rates)\b/i.test(text);
  if (genericFinanceNoise && !/\b(?:introducing broker|forex affiliate|forex trader|fx trader|xauusd|gold trader|copy trading|signals?|pamm|mam|trading academy|forex academy|trading community|funded trader|prop firm)\b/i.test(text)) return false;
  const specialistTradingSource =
    ["mql5", "myfxbook", "tradingview", "specialist", "forum"].includes(bucket) &&
    /\b(?:mql5|myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2|tradingview|forexfactory|babypips|forex|xauusd|pamm|mam|copy trading|signals?)\b/i.test(text);
  if (!actualTradingSignal && !specialistTradingSource) return false;
  if (syntheticSnippet && !actualTradingSignal && !specialistTradingSource) return false;
  if (isGenericPlatformPortal(lead)) return false;
  if (requiresValidatedContactBeforeWorklist(lead) && !hasActionableContact(lead) && !hasDecisionPath(lead)) return false;
  const trustedSource = /linkedin|instagram|x|telegram|discord|tiktok|facebook_threads|reddit|myfxbook|mql5|tradingview|forum|specialist|ecosystem/.test(bucket);
  const tradingSignal =
    actualTradingSignal ||
    specialistTradingSource ||
    (hasStrictTradingIcp(lead) && hasSearchableLeadSignal(lead));
  if (!tradingSignal) return false;

  const score = Number(lead.commercialScore || 0) || Number(lead.score || 0);
  if (score < 35 && !trustedSource) return false;
  return true;
}

export function isResearchExportSource(lead = {}) {
  const url = String(lead.url || "");
  const platform = lead.platform || platformFromUrl(url);
  if (!url || !platform) return false;
  if (!isResearchSource(lead)) return false;
  if (lead.segment === "Broker Site") return false;
  if (lead.priority === "D" && Number(lead.score || 0) < 45) return false;
  const hardReasons = hardRejectionReasonsForExport(lead);
  if (hardReasons.length) return false;
  const text = rawLeadText(lead);
  const researchSignal =
    hasStrictTradingIcp(lead) ||
    hasSearchableLeadSignal(lead) ||
    /\b(?:introducing broker|which broker|broker recommendation|forex|xauusd|copy trading|signals?|pamm|mam|expo|summit|sponsor|exhibitor|funded trader|prop firm|portfolio manager|fund manager|asset manager)\b/i.test(text);
  if (!researchSignal) return false;
  return Number(lead.score || 0) >= 45 || ["forum", "ecosystem", "specialist"].includes(sourceBucket(lead));
}

function sortLeads(a, b) {
  const contactA = Number(a.contactConfidence || 0) + Number(Boolean(a.bestContact)) * 25 + Number(hasActionableContact(a)) * 10;
  const contactB = Number(b.contactConfidence || 0) + Number(Boolean(b.bestContact)) * 25 + Number(hasActionableContact(b)) * 10;
  const platformRank = (lead) => {
    const platform = String(lead.platform || "").toLowerCase();
    const url = String(lead.url || "").toLowerCase();
    if (/linkedin/.test(platform) || /linkedin\.com/.test(url)) return 0;
    if (/instagram/.test(platform) || /instagram\.com/.test(url)) return 1;
    if (/x\/twitter|twitter/.test(platform) || /x\.com|twitter\.com/.test(url)) return 2;
    if (/telegram|discord|tiktok|facebook/.test(platform) || /t\.me|telegram|discord|tiktok|facebook/.test(url)) return 3;
    if (/myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2/.test(platform) || /myfxbook|fxblue|zulutrade|darwinex|signalstart|collective2/.test(url)) return 4;
    if (/tradingview/.test(platform) || /tradingview/.test(url)) return 10;
    if (/mql5/.test(platform) || /mql5\.com/.test(url)) return 12;
    if (/youtube/.test(platform) || /youtube\.com|youtu\.be/.test(url)) return 30;
    return 8;
  };
  return (
    contactB - contactA ||
    platformRank(a) - platformRank(b) ||
    (b.score || 0) - (a.score || 0) ||
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
    if ((domain === "youtube.com" || domain.endsWith(".youtube.com")) && parts.length) return `youtube:${parts.slice(0, 2).join("/").toLowerCase()}`;
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
  const filtered = dedupeLeads(leads
    .filter(options.includeRaw ? () => true : isExportQualified)
    .sort(sortLeads));
  if (options.includeRaw) return filtered;
  return limitMql5Share(filtered, {
    maxMql5Share: Number(options.maxMql5Share ?? process.env.MAX_MQL5_SHARE ?? 0.22),
    minMql5Keep: Number(options.minMql5Keep ?? 15),
    limit: Number(options.limit || filtered.length)
  });
}

export function filterWorkingLeads(leads, options = {}) {
  const filtered = dedupeLeads(leads.filter(isWorkingLead).sort(sortLeads));
  return limitMql5Share(filtered, {
    maxMql5Share: Number(options.maxMql5Share ?? process.env.MAX_MQL5_WORKING_SHARE ?? 0.25),
    minMql5Keep: Number(options.minMql5Keep ?? 25),
    limit: Number(options.limit || filtered.length)
  });
}

export function filterResearchSources(leads, options = {}) {
  return dedupeLeads(leads.filter(isResearchExportSource).sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")))).slice(0, Number(options.limit || leads.length));
}

function formatDecisionMakers(decisionMakers = []) {
  return decisionMakers.map((person) => [person.name, person.title, person.url].filter(Boolean).join(" | "));
}

function serializeLead(lead) {
  const qualification = qualifyLead(lead);
  const entity = classifyLeadEntity(lead);
  const columns = {
    commercialScore: lead.commercialScore || "",
    sourceBucket: lead.sourceBucket || sourceBucket(lead),
    entityKind: entity.kind,
    entityReason: entity.reason,
    priority: lead.priority || "",
    icpTier: qualification.icpTier,
    meetingPriority: qualification.meetingPriority,
    opportunityPlay: qualification.opportunityPlay,
    bestChannel: qualification.bestChannel,
    nextAction: qualification.nextAction,
    decisionMakerLikelihood: qualification.decisionMakerLikelihood,
    decisionMakers: formatDecisionMakers(qualification.decisionMakers || []),
    decisionMakerLinks: qualification.decisionMakerLinks || [],
    score: lead.score || "",
    contactConfidence: lead.contactConfidence || "",
    bestContact: lead.bestContact || "",
    bestContactType: lead.bestContactType || "",
    bestContactSource: lead.bestContactSource || "",
    contactQuality: lead.contactQuality || "",
    leadType: lead.leadType || "",
    segment: lead.segment || "",
    stage: lead.stage || "",
    name: lead.name || lead.title || "",
    country: lead.country || "",
    languages: lead.languages || [],
    url: lead.url || "",
    domain: lead.domain || "",
    emails: cleanEmails(lead.emails || []),
    phoneNumbers: cleanPhoneNumbers(lead.phoneNumbers || []),
    forms: formsSummary(lead),
    socialLinks: cleanContactLinks(lead.socialLinks || [], { allowYouTubeChannels: false }),
    contactLinks: cleanContactLinks(lead.contactLinks || [], { allowYouTubeChannels: false, allowShorteners: true }),
    websiteLinks: cleanContactLinks(lead.websiteLinks || [], { allowYouTubeChannels: false, allowShorteners: true }),
    contactSources: lead.contactSources || [],
    evidence: lead.evidence || [],
    qualificationReasons: qualification.qualificationReasons || [],
    qualificationRisks: qualification.qualificationRisks || [],
    outboundDm: lead.outbound?.dm || "",
    followUp: lead.outbound?.followUp || "",
    snippet: lead.snippet || ""
  };
  return Object.values(columns).map(toCsvCell).join(",");
}

export async function exportLeads(options = {}) {
  const db = await readDb();
  const all = db.leads || [];
  const qualified = filterAndDedupeLeads(all, { limit: options.limit });
  const working = filterWorkingLeads(all, { limit: options.limit });
  const researchSources = filterResearchSources(all, { limit: options.limit });
  const contactable = qualified.filter(hasActionableContact);
  const hot = qualified.filter(isHotLead);
  const social = qualified.filter((lead) => /linkedin|instagram|x\.com|twitter|telegram|discord|tiktok|facebook|threads|reddit/i.test(`${lead.platform} ${lead.url}`));
  const instagram = qualified.filter((lead) => /instagram/i.test(`${lead.platform} ${lead.url}`));
  const linkedin = qualified.filter((lead) => /linkedin/i.test(`${lead.platform} ${lead.url}`));
  const x = qualified.filter((lead) => /x\/twitter|x\.com|twitter/i.test(`${lead.platform} ${lead.url}`));

  const header = [
    "commercialScore",
    "sourceBucket",
    "entityKind",
    "entityReason",
    "priority",
    "icpTier",
    "meetingPriority",
    "opportunityPlay",
    "bestChannel",
    "nextAction",
    "decisionMakerLikelihood",
    "decisionMakers",
    "decisionMakerLinks",
    "score",
    "contactConfidence",
    "bestContact",
    "bestContactType",
    "bestContactSource",
    "contactQuality",
    "leadType",
    "segment",
    "stage",
    "name",
    "country",
    "languages",
    "url",
    "domain",
    "emails",
    "phoneNumbers",
    "forms",
    "socialLinks",
    "contactLinks",
    "websiteLinks",
    "contactSources",
    "evidence",
    "qualificationReasons",
    "qualificationRisks",
    "outboundDm",
    "followUp",
    "snippet"
  ];

  const writeCsv = async (filename, leads) => writeFileWithRetry(path.join(rootDir, filename), `${header.join(",")}\n${leads.map(serializeLead).join("\n")}\n`);
  const writeJson = async (filename, leads) => writeFileWithRetry(path.join(rootDir, filename), `${JSON.stringify(leads, null, 2)}\n`);

  const csvPath = options.csvName ? await writeCsv(options.csvName, qualified) : null;
  const jsonPath = options.jsonName ? await writeJson(options.jsonName, qualified) : null;
  const contactCsvPath = options.contactCsvName ? await writeCsv(options.contactCsvName, contactable) : null;
  const contactJsonPath = options.contactJsonName ? await writeJson(options.contactJsonName, contactable) : null;
  const hotCsvPath = options.hotCsvName ? await writeCsv(options.hotCsvName, hot) : null;
  const hotJsonPath = options.hotJsonName ? await writeJson(options.hotJsonName, hot) : null;
  const socialCsvPath = await writeCsv("autopilot-social-leads.csv", social);
  const socialJsonPath = await writeJson("autopilot-social-leads.json", social);
  const instagramCsvPath = await writeCsv("autopilot-instagram-leads.csv", instagram);
  const instagramJsonPath = await writeJson("autopilot-instagram-leads.json", instagram);
  const linkedinCsvPath = await writeCsv("autopilot-linkedin-leads.csv", linkedin);
  const linkedinJsonPath = await writeJson("autopilot-linkedin-leads.json", linkedin);
  const xCsvPath = await writeCsv("autopilot-x-leads.csv", x);
  const xJsonPath = await writeJson("autopilot-x-leads.json", x);
  const workingCsvPath = await writeCsv("autopilot-working-leads.csv", working);
  const workingJsonPath = await writeJson("autopilot-working-leads.json", working);
  const researchCsvPath = await writeCsv("autopilot-research-sources.csv", researchSources);
  const researchJsonPath = await writeJson("autopilot-research-sources.json", researchSources);

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
    workingCsvPath,
    workingJsonPath,
    researchCsvPath,
    researchJsonPath,
    exported: qualified.length,
    working: working.length,
    researchSources: researchSources.length,
    contactable: contactable.length,
    hot: hot.length,
    social: social.length,
    instagram: instagram.length,
    linkedin: linkedin.length,
    x: x.length,
    total: all.length
  };
}
