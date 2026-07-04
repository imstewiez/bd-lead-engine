import {
  cap,
  countMatches,
  domainOf,
  includesAny,
  normalizeWhitespace,
  pickFirstSentence,
  titleFromUrl,
  unique
} from "./utils.js";

const partnerSignals = [
  "introducing broker",
  " ib ",
  "forex affiliate",
  "affiliate program",
  "affiliate marketing",
  "trading academy",
  "forex educator",
  "trading educator",
  "forex signals",
  "signal provider",
  "copy trading",
  "copytrading",
  "trading community",
  "telegram community",
  "discord community",
  "youtube",
  "trader",
  "forex trader",
  "cfds",
  "cfd",
  "broker partner",
  "partnership",
  "financial education",
  "educacion financiera",
  "educacao financeira",
  "academia de trading",
  "comunidad de trading",
  "comunidade de trading",
  "forex expo",
  "trading expo",
  "money expo",
  "traders fair",
  "speaker",
  "sponsor",
  "exhibitor",
  "asset management",
  "wealth management",
  "family office",
  "investment fund",
  "fund manager",
  "portfolio manager",
  "hedge fund",
  "prop firm",
  "proprietary trading",
  "funded trader",
  "funded trading",
  "trading desk",
  "pamm",
  "mam account",
  "looking for broker",
  "looking for a broker",
  "recommend broker",
  "recommend a broker",
  "which broker",
  "best broker",
  "need broker",
  "procuro corretora",
  "procurando corretora",
  "qual corretora",
  "melhor corretora",
  "corretora para forex",
  "busco broker",
  "buscando broker",
  "recomienden broker",
  "que broker recomiendan",
  "mejor broker",
  "broker para forex",
  "broker regulado",
  "open to partnerships",
  "open to partner"
];

const recruitmentSignals = [
  "business development manager",
  "head of business development",
  "partnership manager",
  "partnerships manager",
  "affiliate manager",
  "country manager",
  "regional manager",
  "sales manager",
  "account manager",
  "retention manager",
  "brokerage",
  "worked at",
  "former",
  "ex-",
  "employee",
  "team lead"
];

const brokerSignals = [
  "exness",
  "xm trading",
  "xmtrading",
  "xm.com",
  "octa",
  "octafx",
  "fbs",
  "hfm",
  "hotforex",
  "tickmill",
  "ic markets",
  "pepperstone",
  "avatrade",
  "atfx",
  "deriv",
  "fxtm",
  "roboforex",
  "vantage",
  "fp markets",
  "axi",
  "admirals",
  "capital.com",
  "etoro",
  "plus500",
  "cmc markets",
  "ig group",
  "markets.com",
  "blackbull",
  "multibank",
  "forexbank",
  "tigerwit",
  "xtream",
  "orbex",
  "iq option",
  "iqoption",
  "ifc markets",
  "ifcmarkets",
  "zero markets",
  "zeromarkets",
  "interactive brokers",
  "interactivebrokers"
];

const institutionSignals = [
  "asset management",
  "wealth management",
  "investment firm",
  "capital management",
  "family office",
  "fund manager",
  "hedge fund",
  "portfolio manager",
  "investment fund",
  "gestora de recursos",
  "gestor de investimentos",
  "gestor de fondos",
  "administradora de fondos",
  "investment adviser",
  "financial adviser",
  "fintech",
  "payments"
];

const eventSignals = [
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
  "attendees"
];

const propSignals = [
  "prop firm",
  "prop trading",
  "proprietary trading",
  "funded trader",
  "funded trading",
  "trading desk",
  "copy trading provider",
  "pamm",
  "mam account",
  "signal provider"
];

const academySignals = [
  "trading academy",
  "forex academy",
  "trading school",
  "curso forex",
  "academia forex",
  "educacion financiera",
  "educacao financeira",
  "financial education",
  "mentor forex",
  "forex mentor",
  "masterclass",
  "webinar"
];

const fintechSignals = [
  "fintech",
  "payments",
  "payment processor",
  "payment gateway",
  "wallet",
  "latam fintech",
  "crypto community"
];

const audienceSignals = [
  "followers",
  "subscribers",
  "community",
  "telegram",
  "discord",
  "youtube",
  "instagram",
  "podcast",
  "webinar",
  "masterclass",
  "course",
  "curso",
  "academia",
  "newsletter"
];

const contactSignals = ["contact", "contacto", "contato", "email", "whatsapp", "book a call", "calendar", "calendly"];

const brokerIntentSignals = [
  "looking for broker",
  "looking for a broker",
  "looking for forex broker",
  "recommend broker",
  "recommend a broker",
  "broker recommendation",
  "which broker",
  "which forex broker",
  "best broker",
  "best forex broker",
  "need broker",
  "need a broker",
  "procuro corretora",
  "procurando corretora",
  "qual corretora",
  "melhor corretora",
  "corretora para forex",
  "corretora de forex",
  "busco broker",
  "buscando broker",
  "recomienden broker",
  "que broker recomiendan",
  "mejor broker",
  "broker para forex",
  "broker regulado",
  "broker confiable",
  "regulated broker",
  "open to partnerships",
  "open to partner",
  "partner with broker"
];

const strongBrokerIntentSignals = [
  "looking for broker",
  "looking for a broker",
  "looking for forex broker",
  "recommend broker",
  "recommend a broker",
  "broker recommendation",
  "which broker do you use",
  "need broker",
  "need a broker",
  "procuro corretora",
  "procurando corretora",
  "qual corretora",
  "corretora para forex",
  "busco broker",
  "buscando broker",
  "recomienden broker",
  "que broker recomiendan",
  "broker para forex",
  "broker confiable",
  "open to partnerships",
  "open to partner",
  "partner with broker"
];

const portugueseSignals = [
  "brasil",
  "portugal",
  "portugues",
  "portuguese",
  "corretora",
  "investimentos",
  "mercado financeiro",
  "educacao financeira",
  "comunidade",
  "trader brasileiro",
  "forex brasil"
];

const spanishSignals = [
  "mexico",
  "colombia",
  "chile",
  "argentina",
  "peru",
  "espana",
  "spanish",
  "espanol",
  "latam",
  "latinoamerica",
  "inversiones",
  "educacion financiera",
  "comunidad",
  "trading en vivo"
];

const englishSignals = [
  "english",
  "united kingdom",
  "dubai",
  "uae",
  "south africa",
  "trading academy",
  "financial education",
  "investment community"
];

const countryPatterns = [
  ["Brazil", /\b(brazil|brasil|sao paulo|rio de janeiro|curitiba|florianopolis)\b/i],
  ["Mexico", /\b(mexico|mexico city|monterrey|guadalajara)\b/i],
  ["Colombia", /\b(colombia|bogota|medellin)\b/i],
  ["Chile", /\b(chile|santiago)\b/i],
  ["Argentina", /\b(argentina|buenos aires)\b/i],
  ["Peru", /\b(peru|lima)\b/i],
  ["Portugal", /\b(portugal|lisbon|lisboa|porto)\b/i],
  ["Spain", /\b(spain|espana|madrid|barcelona)\b/i],
  ["UAE", /\b(uae|dubai|abu dhabi|united arab emirates)\b/i],
  ["South Africa", /\b(south africa|johannesburg|cape town)\b/i],
  ["United Kingdom", /\b(united kingdom|uk|london)\b/i],
  ["LatAm", /\b(latam|latin america|latinoamerica|america latina)\b/i]
];

function detectLanguages(text) {
  const languages = [];
  if (includesAny(text, portugueseSignals)) languages.push("Portuguese");
  if (includesAny(text, spanishSignals)) languages.push("Spanish");
  if (includesAny(text, englishSignals)) languages.push("English");
  if (!languages.length) {
    if (/\b(the|and|with|for|from|business|trading|financial)\b/i.test(text)) languages.push("English");
    if (/\b(de|para|con|una|los|las|trading|inversiones)\b/i.test(text)) languages.push("Spanish");
    if (/\b(de|para|com|uma|trading|investimentos)\b/i.test(text)) languages.push("Portuguese");
  }
  return unique(languages).slice(0, 3);
}

function detectCountries(text) {
  return countryPatterns.filter(([, regex]) => regex.test(text)).map(([country]) => country);
}

function detectSegment(text) {
  const lower = text.toLowerCase();
  if (includesAny(lower, strongBrokerIntentSignals)) return "Broker-Seeking / Intent Post";
  if (
    includesAny(lower, brokerSignals) &&
    includesAny(lower, [
      "affiliate program",
      "partners program",
      "partner program",
      "trade online",
      "global forex broker",
      "official",
      "broker",
      "brokerage",
      "_partners",
      "-partners",
      "markets"
    ])
  ) {
    return "Broker Site";
  }
  if (includesAny(lower, eventSignals)) return "Event / Expo";
  if (includesAny(lower, propSignals)) return "Prop / Funded Trading";
  if (includesAny(lower, institutionSignals)) return "Fund / Asset Manager";
  if (includesAny(lower, fintechSignals)) return "Fintech / Payments";
  if (includesAny(lower, ["introducing broker", " ib ", "broker partner"])) return "IB / Partner";
  if (includesAny(lower, ["affiliate", "afiliado", "afiliados"])) return "Affiliate";
  if (includesAny(lower, academySignals) || includesAny(lower, ["academy", "academia", "course", "curso", "educator", "educacion", "educacao"])) return "Trading Education";
  if (includesAny(lower, ["telegram", "discord", "community", "comunidad", "comunidade"])) return "Community";
  if (includesAny(lower, ["youtube", "instagram", "influencer", "creator", "podcast"])) return "Creator / Influencer";
  if (includesAny(lower, recruitmentSignals) && includesAny(lower, brokerSignals)) return "Broker Talent";
  if (includesAny(lower, ["trader", "forex trader", "prop trader"])) return "High-Calibre Trader";
  return "Unclear";
}

function classifyLeadType(text, segment, sourceIntent) {
  const lower = text.toLowerCase();
  const hasRecruitment = includesAny(lower, recruitmentSignals);
  const hasBroker = includesAny(lower, brokerSignals) || lower.includes("forex broker");
  const hasPartner = includesAny(lower, partnerSignals);
  const hasBrokerIntent = includesAny(lower, brokerIntentSignals);
  const hasInstitution = includesAny(lower, institutionSignals);
  const hasEcosystem = includesAny(lower, [...eventSignals, ...propSignals, ...academySignals, ...fintechSignals]);

  if (sourceIntent === "intent" || sourceIntent === "forum" || hasBrokerIntent) return "partner";
  if (sourceIntent === "specialist") return hasInstitution ? "institution" : "partner";
  if (sourceIntent === "social") return hasRecruitment && hasBroker ? "recruitment" : "partner";
  if (sourceIntent === "ecosystem" && hasInstitution) return "institution";
  if (sourceIntent === "ecosystem" || hasEcosystem) return "partner";
  if (sourceIntent === "recruitment" && (hasRecruitment || hasBroker)) return "recruitment";
  if (hasRecruitment && hasBroker && !includesAny(lower, ["introducing broker", "affiliate program"])) return "recruitment";
  if (hasInstitution) return "institution";
  if (hasPartner || segment !== "Unclear") return "partner";
  return "research";
}

function evidenceFor(text) {
  const evidence = [];
  const buckets = [
    ["Introducing broker", ["introducing broker", " ib "]],
    ["Affiliate angle", ["affiliate", "afiliado", "afiliados"]],
    ["Trading education", ["academy", "academia", "educator", "educacion financiera", "educacao financeira", "course", "curso"]],
    ["Community/audience", ["community", "comunidad", "comunidade", "telegram", "discord", "followers", "subscribers"]],
    ["Event/expo footprint", eventSignals],
    ["Fund/asset manager angle", institutionSignals],
    ["Prop/funded trading angle", propSignals],
    ["Academy/course angle", academySignals],
    ["Fintech/payments angle", fintechSignals],
    ["Broker background", brokerSignals],
    ["Recruitment profile", recruitmentSignals],
    ["Institutional angle", institutionSignals],
    ["Broker-seeking intent", brokerIntentSignals],
    ["Contact path", contactSignals]
  ];
  for (const [label, terms] of buckets) {
    if (includesAny(text, terms)) evidence.push(label);
  }
  return evidence.slice(0, 6);
}

function computeScore(text, url, sourceIntent, leadType, segment, countries, languages, hasEmail) {
  let score = 18;
  const domain = domainOf(url);
  score += Math.min(28, countMatches(text, partnerSignals) * 4);
  score += Math.min(26, countMatches(text, brokerIntentSignals) * 7);
  score += Math.min(18, countMatches(text, audienceSignals) * 3);
  score += Math.min(20, countMatches(text, eventSignals) * 5);
  score += Math.min(18, countMatches(text, institutionSignals) * 4);
  score += Math.min(16, countMatches(text, propSignals) * 4);
  score += Math.min(16, countMatches(text, academySignals) * 4);
  score += Math.min(12, countMatches(text, fintechSignals) * 3);
  score += Math.min(14, countMatches(text, brokerSignals) * 2);
  score += Math.min(12, countMatches(text, contactSignals) * 3);
  score += countries.some((country) => ["Brazil", "Mexico", "Colombia", "Chile", "Argentina", "Peru", "LatAm"].includes(country)) ? 8 : 0;
  score += languages.some((language) => ["Portuguese", "Spanish", "English"].includes(language)) ? 5 : 0;
  score += hasEmail ? 6 : 0;
  score += sourceIntent === "recruitment" && leadType === "recruitment" ? 18 : 0;
  score += sourceIntent === "intent" ? 16 : 0;
  score += sourceIntent === "social" ? 12 : 0;
  score += sourceIntent === "forum" ? 12 : 0;
  score += sourceIntent === "specialist" ? 14 : 0;
  score += sourceIntent === "ecosystem" ? 12 : 0;
  score += leadType === "institution" ? 8 : 0;
  score += segment === "IB / Partner" ? 14 : 0;
  score += segment === "Trading Education" ? 10 : 0;
  score += segment === "Community" ? 10 : 0;
  score += segment === "Broker Talent" ? 14 : 0;
  score += segment === "Broker-Seeking / Intent Post" ? 18 : 0;
  score += segment === "Event / Expo" ? 16 : 0;
  score += segment === "Fund / Asset Manager" ? 14 : 0;
  score += segment === "Prop / Funded Trading" ? 12 : 0;
  score += segment === "Fintech / Payments" ? 8 : 0;
  score += domain.includes("linkedin.com") ? 7 : 0;
  score += domain.includes("youtube.com") ? 5 : 0;
  score += domain.includes("t.me") || domain.includes("telegram") ? 5 : 0;

  if (includesAny(text, ["job description", "we are hiring", "apply now", "careers"])) score -= 18;
  if (segment === "Broker Site" && leadType !== "recruitment") score -= 26;
  if (includesAny(text, ["job -", "jobs", "vacancy", "hiring", "apply now"]) && leadType === "recruitment") score -= 22;
  if (includesAny(text, ["scam", "complaint", "warning", "fraud"])) score -= 18;
  if (leadType === "research" && segment === "Unclear") score -= 12;

  return cap(Math.round(score), 0, 100);
}

function priorityFromScore(score) {
  if (score >= 76) return "A";
  if (score >= 58) return "B";
  if (score >= 38) return "C";
  return "D";
}

function makeOutbound({ title, snippet, url, leadType, segment, languages, countries, evidence }) {
  const language = languages.includes("Portuguese")
    ? "pt"
    : languages.includes("Spanish")
      ? "es"
      : "en";
  const context = pickFirstSentence(snippet, title || titleFromUrl(url) || "o teu trabalho");
  const countryText = countries.length ? countries.join(", ") : "o teu mercado";
  const evidenceText = evidence.length ? evidence[0].toLowerCase() : segment.toLowerCase();

  if (leadType === "recruitment") {
    if (language === "pt") {
      return {
        opener: `Vi o teu percurso ligado a brokers/BD e pareceu-me relevante para expansão comercial em ${countryText}.`,
        dm: `Olá, vi o teu perfil e o teu percurso em brokerage/partnerships chamou-me a atenção. Lidero Business Development e estou a mapear talento comercial forte para crescimento internacional. Faz sentido termos uma conversa curta esta semana?`,
        followUp: `Acho que pode haver fit pelo teu background em ${evidenceText}. Se fizer sentido, trocamos 15 minutos e vemos se há espaço para colaborar.`
      };
    }
    if (language === "es") {
      return {
        opener: `Vi tu experiencia ligada a brokers/BD y me pareció relevante para expansión comercial en ${countryText}.`,
        dm: `Hola, vi tu perfil y tu experiencia en brokerage/partnerships me llamó la atención. Lidero Business Development y estoy mapeando talento comercial fuerte para crecimiento internacional. ¿Tiene sentido que hablemos 15 minutos esta semana?`,
        followUp: `Creo que puede haber fit por tu background en ${evidenceText}. Si te parece, hacemos una llamada breve y vemos si hay espacio para colaborar.`
      };
    }
    return {
      opener: `I saw your brokerage/BD background and it looked relevant for commercial expansion in ${countryText}.`,
      dm: `Hi, I came across your profile and your brokerage/partnerships background stood out. I lead Business Development and I am mapping strong commercial talent for international growth. Would a short call this week make sense?`,
      followUp: `Your background around ${evidenceText} looks relevant. Happy to compare notes in a quick 15-minute call if timing is good.`
    };
  }

  if (language === "pt") {
    return {
      opener: `Vi ${context} e parece haver uma ligação clara a ${evidenceText}.`,
      dm: `Olá, vi o teu trabalho ligado a trading/forex e pareceu-me que pode haver uma conversa interessante de parceria. Lidero Business Development e trabalho com parceiros, comunidades e afiliados em mercados globais. Faz sentido falarmos 15 minutos esta semana?`,
      followUp: `Acho que há potencial para uma conversa objetiva: audiência/comunidade de trading, estrutura de parceria e crescimento com uma corretora regulada. Tens disponibilidade esta semana?`
    };
  }

  if (language === "es") {
    return {
      opener: `Vi ${context} y parece haber una conexión clara con ${evidenceText}.`,
      dm: `Hola, vi tu trabajo relacionado con trading/forex y me pareció que puede haber una conversación interesante de partnership. Lidero Business Development y trabajo con partners, comunidades y afiliados en mercados globales. ¿Tiene sentido hablar 15 minutos esta semana?`,
      followUp: `Creo que hay potencial para una conversación concreta: audiencia/comunidad de trading, estructura de partnership y crecimiento con un broker regulado. ¿Tienes disponibilidad esta semana?`
    };
  }

  return {
    opener: `I saw ${context} and there seems to be a clear angle around ${evidenceText}.`,
    dm: `Hi, I came across your work around trading/forex and thought there may be an interesting partnership conversation. I lead Business Development and work with partners, communities, and affiliates across global markets. Would a 15-minute call this week make sense?`,
    followUp: `I think there is a concrete angle to explore: trading audience/community, partnership structure, and growth with a regulated broker. Do you have availability this week?`
  };
}

export function classifyResult(result, sourceIntent = "partner") {
  const combined = normalizeWhitespace(
    [
      result.title,
      result.name,
      result.snippet,
      result.description,
      result.url,
      result.domain,
      result.pageTitle,
      result.pageDescription,
      result.pageText
    ]
      .filter(Boolean)
      .join(" ")
  );
  const text = ` ${combined.toLowerCase()} `;
  let segment = detectSegment(text);
  const queryText = ` ${[result.query, result.sourceIntent].filter(Boolean).join(" ").toLowerCase()} `;
  if ((sourceIntent === "intent" || sourceIntent === "forum") && includesAny(`${text} ${queryText}`, brokerIntentSignals)) {
    segment = "Broker-Seeking / Intent Post";
  }
  if (sourceIntent === "social" && segment === "Unclear") {
    const socialText = `${text} ${queryText}`;
    if (includesAny(socialText, ["academy", "academia", "course", "curso", "educator", "mentor"])) {
      segment = "Trading Education";
    } else if (includesAny(socialText, ["community", "comunidad", "comunidade", "telegram", "discord", "signals"])) {
      segment = "Community";
    } else {
      segment = "Creator / Influencer";
    }
  }
  if (sourceIntent === "specialist" && segment === "Unclear") {
    const specialistText = `${text} ${queryText}`;
    if (includesAny(specialistText, ["pamm", "mam account", "copy trading", "signal", "xauusd", "gold trader"])) {
      segment = "Prop / Funded Trading";
    } else if (includesAny(specialistText, ["money manager", "fund manager", "portfolio manager", "asset manager", "investment adviser"])) {
      segment = "Fund / Asset Manager";
    } else {
      segment = "IB / Partner";
    }
  }
  if (segment === "Event / Expo" && sourceIntent !== "ecosystem") {
    const identityText = ` ${[result.title, result.name, result.url, result.domain, result.query].filter(Boolean).join(" ").toLowerCase()} `;
    if (!includesAny(identityText, eventSignals)) {
      segment = detectSegment(identityText);
      if (segment === "Event / Expo") segment = "Unclear";
    }
  }
  if (result.source === "youtube" && segment === "Broker Site") {
    const identityText = ` ${[result.title, result.name, result.url, result.domain].filter(Boolean).join(" ").toLowerCase()} `;
    const identityLooksBroker =
      includesAny(identityText, brokerSignals) ||
      (includesAny(identityText, ["official", "canal oficial", "canaloficial"]) &&
        includesAny(identityText, ["broker", "bank", "markets", "fx"]));
    if (!identityLooksBroker) {
      if (/\bib\b/i.test(identityText) || includesAny(text, ["introducing broker", " forex ib ", " ib partner"])) {
        segment = "IB / Partner";
      } else {
        segment = detectSegment(identityText);
        if (segment === "Broker Site") segment = "Unclear";
      }
    }
  }
  const leadType = classifyLeadType(text, segment, sourceIntent);
  const countries = detectCountries(text);
  const languages = detectLanguages(text);
  const evidence = evidenceFor(text);
  const emails = unique(result.emails || []);
  const score = computeScore(text, result.url, sourceIntent, leadType, segment, countries, languages, emails.length > 0);
  const priority = priorityFromScore(score);
  const name = normalizeWhitespace(result.name || result.pageTitle || result.title || titleFromUrl(result.url) || result.domain);
  const snippet = normalizeWhitespace(result.pageDescription || result.description || result.snippet || result.pageText || "");

  return {
    ...result,
    name,
    title: normalizeWhitespace(result.title || result.pageTitle || name),
    snippet: snippet.slice(0, 1000),
    domain: result.domain || domainOf(result.url),
    leadType,
    segment,
    countries,
    country: countries[0] || "",
    languages,
    evidence,
    emails,
    score,
    priority,
    outbound: makeOutbound({
      title: name,
      snippet,
      url: result.url,
      leadType,
      segment,
      languages,
      countries,
      evidence
    })
  };
}
