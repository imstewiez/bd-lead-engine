import {
  cleanEmails,
  cleanForms,
  cleanLinks,
  cleanPhoneNumbers,
  hasDirectOutboundPath,
  isUsefulDirectContactUrl
} from "./contact-cleaner.js";
import { leadRejectionReasons } from "./lead-quality.js";
import { domainOf, normalizeWhitespace, titleFromUrl, unique } from "./utils.js";

const HOT_SEGMENTS = new Set([
  "IB / Partner",
  "Affiliate",
  "Trading Education",
  "Community",
  "Creator / Influencer",
  "Broker-Seeking / Intent Post",
  "Event / Expo",
  "Prop / Funded Trading",
  "Fund / Asset Manager"
]);

const RECRUITMENT_SEGMENTS = new Set(["Broker Talent"]);

const DECISION_TERMS =
  /founder|co[- ]?founder|ceo|chief|owner|director|head|partner|partnership|business development|\bbd\b|country manager|affiliate manager|portfolio manager|fund manager|investment manager|principal|managing partner/i;

const INTENT_TERMS =
  /need broker|looking for broker|busco broker|procuro corretora|melhor corretora|best broker|which broker|what broker|broker recommendation|open to partner|partnership opportunity|affiliate partner|ib partner|sponsor|sponsorship/i;

const GENERIC_BAD_TERMS =
  /forex factory|fxstreet|investopedia|tradingview\.com\/?(?:chart\/?)?$|investing\.com|marketwatch|interactive brokers|interactivebrokers\.com|currency exchange rates|international money transfers|how to start forex trading|metatrader download|broker review|definition|pronunciation|usage notes|dictionary|oxfordlearnersdictionaries|merriam-webster|cambridge dictionary|collins dictionary|vocabulary\.com|thesaurus/i;

function allLeadUrls(lead) {
  return unique([
    lead.url,
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.websiteLinks || []),
    ...(lead.relatedLinks || []),
    ...(lead.contactSources || [])
  ]).filter(Boolean);
}

function actionableLinks(lead) {
  return cleanLinks([lead.url, ...(lead.socialLinks || []), ...(lead.contactLinks || [])], {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).filter(isUsefulDirectContactUrl);
}

export function extractDecisionMakerLinks(lead) {
  const links = allLeadUrls(lead).filter((url) => {
    const domain = domainOf(url);
    if (domain !== "linkedin.com" && !domain.endsWith(".linkedin.com")) return false;
    try {
      const parts = new URL(url).pathname.split("/").filter(Boolean);
      const section = (parts[0] || "").toLowerCase();
      return ["in", "company"].includes(section) && parts.length >= 2;
    } catch {
      return false;
    }
  });

  return cleanLinks(links, {
    allowYouTubeChannels: false,
    allowShorteners: true
  }).slice(0, 8);
}

function normalizeDecisionMaker(item = {}) {
  if (!item) return null;
  const url = item.url || "";
  const title = normalizeWhitespace(item.title || item.role || "");
  const source = normalizeWhitespace(item.source || domainOf(url) || "");
  const evidence = normalizeWhitespace(item.evidence || item.snippet || "");
  const name = normalizeWhitespace(item.name || title.split(/\s[-|]\s/)[0] || titleFromUrl(url));
  if (!name && !url) return null;
  return {
    name,
    title,
    url,
    source,
    evidence: evidence.slice(0, 220)
  };
}

export function decisionMakersForLead(lead) {
  const fromData = (lead.decisionMakers || []).map(normalizeDecisionMaker).filter(Boolean);
  const fromLinks = extractDecisionMakerLinks(lead).map((url) =>
    normalizeDecisionMaker({
      name: titleFromUrl(url),
      title: "LinkedIn decision-maker/company path",
      url,
      source: "linkedin"
    })
  );
  const seen = new Set();
  return [...fromData, ...fromLinks]
    .filter((person) => {
      const key = `${person.url || ""}|${person.name || ""}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function opportunityPlayFor(lead) {
  if (RECRUITMENT_SEGMENTS.has(lead.segment) || lead.leadType === "recruitment") {
    return "Recruitment / senior BD hire";
  }
  if (lead.segment === "Broker-Seeking / Intent Post") return "Hot intent: broker selection conversation";
  if (lead.segment === "IB / Partner") return "IB / revenue-share partnership";
  if (lead.segment === "Affiliate") return "Affiliate / CPL-CPA-revshare partnership";
  if (lead.segment === "Trading Education") return "Academy sponsorship + IB funnel";
  if (lead.segment === "Community") return "Community activation + broker partnership";
  if (lead.segment === "Creator / Influencer") return "Creator sponsorship + affiliate funnel";
  if (lead.segment === "Event / Expo") return "Expo/event follow-up and partnership mapping";
  if (lead.segment === "Prop / Funded Trading") return "Prop/funded trader audience partnership";
  if (lead.segment === "Fund / Asset Manager") return "Institutional liquidity/CFD relationship";
  if (lead.segment === "Fintech / Payments") return "Fintech/payment ecosystem partnership";
  return lead.leadType === "institution" ? "Institutional partnership research" : "Partner research";
}

function bestChannelFor({ emails, phones, forms, directLinks, decisionMakerLinks, lead }) {
  if (emails.length) return "Email";
  if (directLinks.some((url) => /wa\.me|whatsapp/i.test(url)) || phones.length) return "WhatsApp";
  if (directLinks.some((url) => /calendly/i.test(url))) return "Calendly";
  if (decisionMakerLinks.length || directLinks.some((url) => /linkedin\.com/i.test(url))) return "LinkedIn";
  if (directLinks.some((url) => /t\.me|telegram/i.test(url))) return "Telegram";
  if (directLinks.some((url) => /instagram\.com/i.test(url))) return "Instagram";
  if (forms.length) return "Contact form";
  if ((lead.websiteLinks || []).length) return "Website research";
  return "Source URL";
}

function nextActionFor(channel, play, lead) {
  if (lead.leadType === "recruitment") {
    if (channel === "LinkedIn") return "Contactar no LinkedIn com abordagem de carreira BD LatAm";
    return "Validar senioridade e abrir conversa de recrutamento BD";
  }
  if (channel === "Email") return `Enviar email curto com proposta: ${play}`;
  if (channel === "WhatsApp") return `Enviar WhatsApp direto com pitch de parceria: ${play}`;
  if (channel === "LinkedIn") return `Adicionar/DM decision maker com angulo: ${play}`;
  if (channel === "Contact form") return `Submeter formulario pedindo call de parceria: ${play}`;
  if (channel === "Website research") return "Abrir site, confirmar owner/BD e procurar email/LinkedIn antes do outreach";
  return "Abrir fonte, validar contexto e contactar pelo canal disponivel";
}

function decisionMakerLikelihoodFor(lead, decisionMakers, decisionMakerLinks, text) {
  if (decisionMakers.some((person) => DECISION_TERMS.test(`${person.name} ${person.title} ${person.evidence}`))) {
    return "High";
  }
  if (decisionMakerLinks.some((url) => /linkedin\.com\/in\//i.test(url))) return "High";
  if (decisionMakerLinks.length || DECISION_TERMS.test(text)) return "Medium";
  if (/linkedin\.com\/company\//i.test(allLeadUrls(lead).join(" "))) return "Medium";
  return "Low";
}

function tierFor({ baseScore, contactBonus, decisionBonus, segmentBonus, intentBonus, redFlagPenalty }) {
  const total = baseScore + contactBonus + decisionBonus + segmentBonus + intentBonus - redFlagPenalty;
  if (total >= 105) return "A1 Hot";
  if (total >= 88) return "A2 Strong";
  if (total >= 68) return "B Nurture";
  return "C Research";
}

export function qualifyLead(lead) {
  const emails = cleanEmails(lead.emails || []);
  const phones = cleanPhoneNumbers(lead.phoneNumbers || []);
  const forms = cleanForms(lead.forms || []);
  const directLinks = actionableLinks(lead);
  const decisionMakerLinks = extractDecisionMakerLinks(lead);
  const decisionMakers = decisionMakersForLead({ ...lead, decisionMakerLinks });
  const text = normalizeWhitespace(
    `${lead.name || ""} ${lead.title || ""} ${lead.snippet || ""} ${(lead.evidence || []).join(" ")} ${allLeadUrls(lead).join(" ")}`
  );
  const lowerText = text.toLowerCase();
  const reasons = [];
  const redFlags = [];

  if (lead.priority === "A") reasons.push("Priority A from source scoring");
  if ((lead.score || 0) >= 85) reasons.push("High relevance score");
  if (HOT_SEGMENTS.has(lead.segment)) reasons.push(`Strong segment: ${lead.segment}`);
  if (emails.length) reasons.push("Email available");
  if (phones.length) reasons.push("Phone/WhatsApp style contact available");
  if (forms.length) reasons.push("Contact/partner form available");
  if (directLinks.length) reasons.push("Direct social/contact path available");
  if (INTENT_TERMS.test(text)) reasons.push("Broker/partnership intent signal found");
  if ((lead.audience || "").trim()) reasons.push(`Audience signal: ${lead.audience}`);
  if (decisionMakers.length || decisionMakerLinks.length) reasons.push("Decision-maker/company path found");

  if (!emails.length && !forms.length && !directLinks.length && !hasDirectOutboundPath(lead)) {
    redFlags.push("No direct contact path yet");
  }
  if ((lead.score || 0) < 65) redFlags.push("Lower relevance score");
  if (lead.segment === "Broker Site") redFlags.push("Official broker site rather than partner lead");
  if (GENERIC_BAD_TERMS.test(lowerText)) redFlags.push("Generic/reference-market result risk");
  for (const reason of leadRejectionReasons(lead)) redFlags.push(`Quality risk: ${reason}`);
  if (!lead.country || lead.country === "Unknown") redFlags.push("Country not confirmed");

  const contactBonus = emails.length ? 22 : forms.length ? 18 : directLinks.length ? 15 : phones.length ? 12 : 0;
  const decisionLikelihood = decisionMakerLikelihoodFor(lead, decisionMakers, decisionMakerLinks, text);
  const decisionBonus = decisionLikelihood === "High" ? 14 : decisionLikelihood === "Medium" ? 7 : 0;
  const segmentBonus = HOT_SEGMENTS.has(lead.segment) ? 12 : RECRUITMENT_SEGMENTS.has(lead.segment) ? 8 : 0;
  const intentBonus = INTENT_TERMS.test(text) ? 12 : 0;
  const redFlagPenalty = redFlags.length * 6;
  const icpTier = tierFor({
    baseScore: Number(lead.score || 0),
    contactBonus,
    decisionBonus,
    segmentBonus,
    intentBonus,
    redFlagPenalty
  });
  const meetingPriority = icpTier === "A1 Hot" ? "High" : icpTier === "A2 Strong" ? "Medium-High" : icpTier === "B Nurture" ? "Medium" : "Low";
  const opportunityPlay = opportunityPlayFor(lead);
  const bestChannel = bestChannelFor({ emails, phones, forms, directLinks, decisionMakerLinks, lead });

  return {
    icpTier,
    meetingPriority,
    opportunityPlay,
    bestChannel,
    nextAction: nextActionFor(bestChannel, opportunityPlay, lead),
    decisionMakerLikelihood: decisionLikelihood,
    decisionMakers,
    decisionMakerLinks,
    qualificationReasons: unique(reasons).slice(0, 8),
    redFlags: unique(redFlags).slice(0, 6),
    contactable: emails.length > 0 || forms.length > 0 || directLinks.length > 0 || hasDirectOutboundPath(lead),
    whyThisLead: unique(reasons).slice(0, 4).join("; ")
  };
}

export function isHotLead(lead) {
  const qualified = qualifyLead(lead);
  return ["A1 Hot", "A2 Strong"].includes(qualified.icpTier);
}
