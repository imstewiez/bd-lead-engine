import { domainOf, normalizeWhitespace } from "./utils.js";

const OFFICIAL_BROKER_DOMAINS = [
  "ig.com",
  "admiralmarkets.com",
  "admirals.com",
  "xtb.com",
  "xm.com",
  "xmglobal.com",
  "exness.com",
  "hfm.com",
  "hotforex.com",
  "tickmill.com",
  "ironfx.com",
  "dukascopy.com",
  "dukascopy.bank",
  "icmarkets.com",
  "pepperstone.com",
  "avatrade.com",
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
  "ifcmarkets.com",
  "fpmarkets.com",
  "axi.com",
  "capital.com",
  "etoro.com",
  "plus500.com",
  "cmcmarkets.com",
  "oanda.com",
  "forex.com",
  "markets.com",
  "blackbull.com",
  "multibankfx.com",
  "multibankgroup.com",
  "dooprime.com",
  "puprime.com",
  "vexatrade.ai",
  "gate.com",
  "pocketoption.com",
  "iqoption.com",
  "olymptrade.com"
];

const OFFICIAL_BROKER_IDENTITY =
  /(?:^|\b|@)(?:ig portugal|ig group|admiral markets|admirals|xtb international|xtbinternational|xm global|xm south asia|xmsouthasia|xm trading|exness|hfm|hotforex|tickmill|ironfx|iron fx|dukascopy|ic markets|pepperstone|avatrade|deriv|fbs|octafx|octa fx|roboforex|fxtm|vantage|fp markets|axi|capital\.com|etoro|plus500|cmc markets|oanda|forex\.com|blackbull|multibank|doo prime|dooprime|puprime|pu prime|vexatrade|gate learn|gate\.com|pocket option|iq option|olymp trade)(?:\b|$)/i;

const OFFICIAL_CHANNEL_HANDLES = [
  "puprime",
  "xtbinternational",
  "xmsouthasia",
  "xmsouthafrica",
  "xmglobal",
  "fundednext",
  "xfunded",
  "xfundedcom",
  "infinox",
  "infinoxtradingpower",
  "spartanbrokers",
  "admirals",
  "admiralmarkets",
  "igportugal",
  "exness",
  "ironfx",
  "ironfxglobal",
  "dukascopy",
  "dukascopytv",
  "deriv",
  "tickmill",
  "pepperstone",
  "avatrade",
  "roboforex",
  "fxtm",
  "vantage",
  "hfm",
  "octafx",
  "litefinance",
  "m4markets",
  "m4marketssouthasia",
  "gdmfx",
  "gdmfxcom",
  "activtrades"
];

const BROKER_REVIEW_DOMAINS = [
  "comparebrokers.org",
  "brokerchooser.com",
  "forexbrokers.com",
  "bestbrokers.com",
  "compareforexbrokers.com",
  "brokersview.com",
  "topbrokers.com",
  "investingintheweb.com",
  "fx-list.com",
  "daytrading.com",
  "wikifx.com"
];

const GENERIC_MARKETING_DOMAINS = [
  "studio1.de",
  "socialmediastatistik.de",
  "hootsuite.com",
  "buffer.com",
  "sproutsocial.com"
];

const GENERIC_BANK_DOMAINS = [
  "itauassetmanagement.com.br",
  "itau-unibanco.com.br",
  "bradesco.com.br",
  "bb.com.br",
  "santander.com.br",
  "bancolombia.com",
  "banorte.com",
  "bci.cl",
  "scotiabank.com",
  "hsbc.com",
  "jpmorgan.com",
  "goldmansachs.com",
  "morganstanley.com"
];

const CONTENT_FARM_DOMAINS = [
  "investopedia.com",
  "investing.com",
  "fxstreet.com",
  "marketwatch.com",
  "yahoo.com",
  "reuters.com",
  "bloomberg.com",
  "cnbc.com",
  "tradingeconomics.com",
  "focus-economics.com",
  "empiricus.com.br",
  "literaciafinanceira.pt",
  "doutorfinancas.pt",
  "suno.com.br",
  "forbes.com",
  "businessinsider.com",
  "ibm.com",
  "forrester.com",
  "english.stackexchange.com",
  "stackexchange.com",
  "support.google.com",
  "procaresoftware.com",
  "eftps.gov",
  "irs.gov"
];

const JOB_BOARD_DOMAINS = [
  "jobs.lever.co",
  "lever.co",
  "boards.greenhouse.io",
  "greenhouse.io",
  "apply.workable.com",
  "workable.com",
  "jobs.ashbyhq.com",
  "ashbyhq.com",
  "smartrecruiters.com",
  "bamboohr.com"
];

const OFFICIAL_PROP_FIRM_DOMAINS = [
  "ftmo.com",
  "fundednext.com",
  "the5ers.com",
  "fxify.com",
  "topstep.com",
  "myforexfunds.com",
  "fundedtraderprogram.com",
  "thefundedtraderprogram.com"
];

const THIRD_PARTY_CONTACT_DOMAINS = [
  "vidiq.com",
  "patreon.com",
  "amazon.com",
  "eventbrite.com",
  "grammarly.com",
  "readymag.com",
  "theice.com",
  "houstondynamo.com",
  "readytogo.net",
  "moneysavingexpert.com"
];

const STRONG_TRADING_PATTERN =
  /\b(?:forex|fx trader|fx trading|foreign exchange|currency trading|cfd|cfds|xauusd|gold trader|metatrader|mt4|mt5|copy trading|copytrading|signals?|sinais|senales|señales|pamm|mam account|introducing broker|forex ib|ib partner|forex affiliate|cpa forex|revenue share|forex trader|trading academy|forex academy|trading community|forex community|comunidad forex|comunidade forex|prop firm|funded trader|funded trading|derivatives|derivativos|divisas|broker partnership|broker partner|broker regulado)\b/i;

const STRICT_TRADING_ICP_PATTERN =
  /\b(?:forex|fx trader|fx trading|forex trader|forex trading|foreign exchange|currency trading|currency trader|cfd|cfds|contracts? for difference|xauusd|gold trader|gold scalper|metatrader|mt4|mt5|expert advisor|eas?\s+provider|algo trader|algorithmic trading|copy trading|copytrading|forex signals?|signal provider|strategy provider|sinais forex|seÃ±ales forex|senales forex|pamm|mam account|introducing broker|forex ib|ib partner|forex affiliate|affiliate forex|cpa forex|cpl forex|revshare|revenue share|pnl deal|profit share|broker partnership|broker partner|broker regulado|looking for (?:a )?(?:forex )?broker|recommend (?:a )?(?:forex )?broker|which (?:forex )?broker|procuro corretora|procurando corretora|corretora para forex|busco broker|buscando broker|mejor broker|broker para forex|que broker recomiendan)\b/i;

const CAPITAL_ALLOCATOR_PATTERN =
  /\b(?:money manager|portfolio manager|fund manager|hedge fund manager|capital allocator|asset manager|investment adviser|investment advisor|gestor de fundos|gestor de fondos|gestor de investimentos|gestora de recursos|administradora de fondos)\b/i;

const TRADING_ASSET_CONTEXT_PATTERN =
  /\b(?:forex|fx\b|foreign exchange|currency|currencies|divisas|cfd|cfds|derivatives|derivativos|xauusd|gold|metatrader|mt4|mt5|pamm|mam|copy trading|signals?|sinais|senales|seÃ±ales|broker|corretora)\b/i;

const BROKER_RECRUITMENT_ROLE_PATTERN =
  /\b(?:business development|partnerships?|affiliate manager|country manager|regional manager|sales manager|account manager|retention manager|worked at|former|ex-|employee|team lead|head of)\b/i;

const PARTNER_ENTITY_PATTERN =
  /\b(?:founder|owner|ceo|director|head of|business development|partnerships?|affiliate manager|portfolio manager|fund manager|money manager|investment adviser|trading educator|mentor|community|telegram|discord|whatsapp|youtube|instagram|linkedin\.com\/in|linkedin\.com\/company|contact|contacto|contato|book a call|calendly)\b/i;

const REVIEW_PAGE_PATTERN =
  /\b(?:top brokers?|best brokers?|compare brokers?|broker comparison|broker reviews?|forex broker reviews?|updated for 20\d{2}|no\.?\s*1 forex broker|best forex broker|melhores corretoras|melhor corretora|mejores brokers|mejor broker)\b/i;

const GENERIC_ARTICLE_PATTERN =
  /\b(?:what is|what are|o que e|o que é|o que sao|o que são|como funciona|explicado|explained|complete guide|guia completo|beginner guide|learn articles?|glossary|definition|aprende com exemplos|complete guide to|pr[oó]s e contras)\b|\/(?:learn|education|educacao|educación|artigos|explica|blog)\/|\/learn\/articles\//i;

const GENERIC_MARKETING_PATTERN =
  /\b(?:social-media-werbung|werbung|advertising|social media advertising|facebook instagram|instagram und co|marketing agency|digital marketing|social media statistics|steigernder anteil von werbung)\b/i;

const GENERIC_FINANCE_ROLE_PATTERN =
  /\b(?:equity research|investment banking|credit analyst|fixed income analyst|bank analyst|chief economist|macroeconomist|finance news|market news|analyst forecast|economic calendar)\b/i;

const NON_TRADING_CFD_NOISE_PATTERN =
  /\b(?:cheyenne frontier days|frontier days|rodeo|concerts?|festival|lineup|tickets?|football club|sports team|customer service complaint|computational fluid dynamics)\b/i;

const TRADING_CONTEXT_PATTERN =
  /\b(?:forex|fx trader|fx trading|foreign exchange|currency trading|contracts? for differences?|xauusd|gold trader|metatrader|mt4|mt5|copy trading|signals?|pamm|mam account|introducing broker|forex ib|forex affiliate|trading academy|forex academy|trading community|broker partnership|broker regulado)\b/i;

const YOUTUBE_IDENTITY_TRADING_PATTERN =
  /\b(?:forex|fx|xauusd|gold|trader|trading|daytrading|scalping|signals?|sinais|senales|señales|copy|pamm|mam|funded|prop|academy|academia|broker|ib|cpa|marketmaker|smart[_ -]?risk)\b/i;

function domainMatches(domain, domains) {
  return domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

function stripSearchBoilerplate(value = "") {
  return String(value).replace(/YouTube creator\/channel result for .*?(?:Related titles:|$)/i, "Related titles:");
}

function stripGeneratedDiscoveryContext(value = "") {
  return stripSearchBoilerplate(value)
    .replace(/Matched public source:.*?(?:Source pack:|$)/gi, " ")
    .replace(/Source pack:.*?(?:\.|$)/gi, " ")
    .replace(/Found via [^.;]+[.;]?/gi, " ")
    .replace(/TikTok public user\/profile found for .*?Matched forex\/trading search context:[^.;]+[.;]?/gi, " ")
    .replace(/MQL5 public signal provider matched [^.;]+[.;]?/gi, " ")
    .replace(/Potential copy trading, signal provider, money manager or high-calibre trader lead[.;]?/gi, " ");
}

export function qualityText(lead = {}, options = {}) {
  const values = [
    lead.name,
    lead.title,
    lead.snippet,
    lead.description,
    lead.pageTitle,
    lead.pageDescription,
    lead.pageText,
    lead.url,
    lead.domain,
    ...(lead.evidence || []),
    lead.audience
  ];
  if (options.includeQuery) values.push(lead.query, lead.sourceIntent);
  return normalizeWhitespace(values.filter(Boolean).map(stripSearchBoilerplate).join(" "));
}

export function rawLeadText(lead = {}) {
  return normalizeWhitespace(
    [
      lead.name,
      lead.title,
      stripGeneratedDiscoveryContext(lead.snippet || ""),
      lead.description,
      lead.pageTitle,
      lead.pageDescription,
      lead.pageText,
      lead.url,
      lead.domain,
      ...(lead.websiteLinks || []),
      ...(lead.socialLinks || []),
      ...(lead.contactLinks || [])
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function visibleLeadText(lead = {}) {
  return normalizeWhitespace(
    [
      lead.name,
      lead.title,
      stripGeneratedDiscoveryContext(lead.snippet || ""),
      lead.description,
      lead.pageTitle,
      lead.pageDescription,
      lead.pageText
    ]
      .filter(Boolean)
      .join(" ")
  );
}

export function hasStrongTradingSignal(value = "") {
  return STRONG_TRADING_PATTERN.test(value);
}

export function hasPartnerEntitySignal(value = "") {
  return PARTNER_ENTITY_PATTERN.test(value);
}

export function isSpecialistTradingPlatformLead(lead = {}) {
  const platform = String(lead.platform || "").toLowerCase();
  const url = String(lead.url || "").toLowerCase();
  if (/mql5/.test(platform) || /mql5\.com\/en\/(?:signals|users|market|forum)/.test(url)) return true;
  if (/myfxbook/.test(platform) || /myfxbook\.com\/(?:members|portfolio|community)/.test(url)) return true;
  if (/fxblue/.test(platform) || /fxblue\.com\/users/.test(url)) return true;
  if (/zulutrade/.test(platform) || /zulutrade\.com\/trader/.test(url)) return true;
  if (/darwinex/.test(platform) || /darwinex\.com\/darwin/.test(url)) return true;
  if (/signalstart/.test(platform) || /signalstart\.com\/analysis/.test(url)) return true;
  if (/collective2/.test(platform) || /collective2\.com/.test(url)) return true;
  if (/tradingview/.test(platform) || /tradingview\.com\/u\//.test(url)) return true;
  if (/forexfactory|babypips/.test(platform) || /forexfactory\.com|forums\.babypips\.com/.test(url)) return true;
  return false;
}

export function hasStrictTradingIcp(lead = {}) {
  const raw = rawLeadText(lead);
  const visible = visibleLeadText(lead);
  const platform = String(lead.platform || "").toLowerCase();
  if (isSpecialistTradingPlatformLead(lead)) return true;
  if (STRICT_TRADING_ICP_PATTERN.test(visible)) return true;
  if (/linkedin|instagram|x\/twitter|twitter|tiktok|telegram|discord|facebook|threads|reddit/.test(platform) && STRICT_TRADING_ICP_PATTERN.test(raw)) return true;
  if (CAPITAL_ALLOCATOR_PATTERN.test(visible) && TRADING_ASSET_CONTEXT_PATTERN.test(visible)) return true;
  if (
    lead.leadType === "recruitment" &&
    BROKER_RECRUITMENT_ROLE_PATTERN.test(visible) &&
    (OFFICIAL_BROKER_IDENTITY.test(visible) || /\b(?:forex broker|brokerage|cfds?|foreign exchange|fx broker|regulated broker)\b/i.test(visible))
  ) {
    return true;
  }
  return false;
}

export function strictTradingIcpRejectionReason(lead = {}) {
  return hasStrictTradingIcp(lead) ? "" : "missing strict forex/CFD/trading ICP signal";
}

export function isOfficialBrokerLead(lead = {}) {
  if (lead.leadType === "recruitment") return false;
  const domain = domainOf(lead.url || "");
  if (domainMatches(domain, OFFICIAL_BROKER_DOMAINS)) return true;
  const handleText = [lead.name, lead.title, lead.url]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (OFFICIAL_CHANNEL_HANDLES.some((handle) => handleText.includes(handle.replace(/[^a-z0-9]/g, "")))) return true;
  const text = qualityText(lead);
  if (!OFFICIAL_BROKER_IDENTITY.test(text)) return false;
  return /\b(?:official|canal oficial|global forex broker|trade online|client portal|open account|login|register|regulated broker|brokerage|markets)\b/i.test(
    text
  );
}

export function leadRejectionReasons(lead = {}, options = {}) {
  const text = qualityText(lead, { includeQuery: Boolean(options.includeQuery) });
  const contentText = qualityText(lead, { includeQuery: false });
  const rawContentText = rawLeadText(lead);
  const visibleContentText = visibleLeadText(lead);
  const rawLower = rawContentText.toLowerCase();
  const lower = text.toLowerCase();
  const domain = domainOf(lead.url || "");
  const reasons = [];
  const strongTrading = hasStrongTradingSignal(contentText);
  const partnerEntity = hasPartnerEntitySignal(contentText);
  const identityText = normalizeWhitespace([
    lead.name,
    lead.title,
    lead.url,
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.websiteLinks || [])
  ].filter(Boolean).join(" "));

  if (isOfficialBrokerLead(lead)) reasons.push("official broker/brokerage page");

  if (domainMatches(domain, OFFICIAL_PROP_FIRM_DOMAINS)) {
    reasons.push("official prop firm/challenge page");
  }

  if (!hasStrictTradingIcp(lead)) {
    reasons.push("missing strict forex/CFD/trading ICP signal");
  }

  if (domain.endsWith(".cfd") && !TRADING_CONTEXT_PATTERN.test(visibleContentText)) {
    reasons.push("non-trading .cfd domain/page");
  }

  if (/\b(?:payment solutions?|payment services?|payment gateway|money transfers?|currency exchange partner|global payroll|purchasing property abroad|personal transfers|business transfers|foreign exchange account manager)\b/i.test(visibleContentText)) {
    if (!/\b(?:forex trader|forex trading|fx trader|currency trading|cfd trading|metatrader|mt4|mt5|pamm|mam|copy trading|introducing broker|forex affiliate|signals?)\b/i.test(visibleContentText)) {
      reasons.push("payments/money-transfer page, not trading ICP");
    }
  }

  if (NON_TRADING_CFD_NOISE_PATTERN.test(contentText) && !TRADING_CONTEXT_PATTERN.test(contentText)) {
    reasons.push("non-trading CFD/acronym noise");
  }

  if ((domain === "youtube.com" || domain.endsWith(".youtube.com")) && /YouTube creator\/channel result for/i.test(String(lead.snippet || ""))) {
    if (!YOUTUBE_IDENTITY_TRADING_PATTERN.test(identityText)) {
      reasons.push("legacy YouTube result without trading identity");
    }
  }

  if (domainMatches(domain, THIRD_PARTY_CONTACT_DOMAINS)) {
    reasons.push("third-party tooling/contact domain");
  }

  if (domainMatches(domain, JOB_BOARD_DOMAINS) || /\b(?:apply for this job|submit your application|resume\/cv|equal opportunity employer|jobs powered by|job description|we are hiring|vacancy)\b/i.test(contentText)) {
    reasons.push("job listing/careers page");
  }

  if (domain === "tradingview.com" || domain.endsWith(".tradingview.com")) {
    if (/\/markets\/|\/chart\/?$|\/symbols\//i.test(String(lead.url || ""))) {
      reasons.push("generic market/chart page");
    }
  }

  if (domainMatches(domain, GENERIC_MARKETING_DOMAINS) || GENERIC_MARKETING_PATTERN.test(contentText)) {
    if (!strongTrading) reasons.push("generic social-media/marketing page");
  }

  if (domainMatches(domain, CONTENT_FARM_DOMAINS)) {
    reasons.push("generic article/reference page");
  }

  if (domainMatches(domain, CONTENT_FARM_DOMAINS) && !/\b(?:contact|contato|contacto|partnership|parceria|affiliate|introducing broker|signals?|community|whatsapp|telegram)\b/i.test(rawContentText)) {
    reasons.push("generic article/reference page");
  }

  if ((/\/(?:guias?|think\/topics|topics\/fintech)\//i.test(rawLower) || /\b(?:what is|what are|o que e|o que é|entenda para que serve|guia completo|complete guide|glossary)\b/i.test(rawContentText)) && !/\b(?:contact|contato|contacto|partnership|parceria|affiliate|introducing broker|signals?|community|whatsapp|telegram)\b/i.test(rawContentText)) {
    reasons.push("generic explainer/reference page");
  }

  if (/\b(?:child care|daycare|bookkeeping software|accounting software|school management software|payroll software)\b/i.test(rawContentText)) {
    reasons.push("non-trading business software page");
  }

  if (domainMatches(domain, CONTENT_FARM_DOMAINS) || GENERIC_ARTICLE_PATTERN.test(contentText)) {
    if (!partnerEntity || /\/(?:learn|education|educacao|educación|artigos|explica|blog)\//i.test(lower)) {
      reasons.push("generic article/reference page");
    }
  }

  if (/\b(?:what is|what are|o que e|o que é|entenda para que serve|guia completo|complete guide|glossary)\b/i.test(contentText) || /\/(?:guias?|think\/topics|topics\/fintech)\//i.test(lower)) {
    if (!/\b(?:contact|contato|contacto|partnership|parceria|affiliate|introducing broker|signals?|community|whatsapp|telegram)\b/i.test(contentText)) {
      reasons.push("generic explainer/reference page");
    }
  }

  if (domainMatches(domain, BROKER_REVIEW_DOMAINS) || REVIEW_PAGE_PATTERN.test(contentText)) {
    if (!/\b(?:affiliate|partnership|advertise|media kit|contact us|contacto|contato)\b/i.test(contentText)) {
      reasons.push("generic broker ranking/review page");
    }
  }

  if (domainMatches(domain, GENERIC_BANK_DOMAINS)) {
    if (!strongTrading || !partnerEntity) reasons.push("generic bank/asset-management institution page");
  }

  if (/\b(?:insurance|insure|seguro|seguros|corretor de seguros|broker de seguros)\b/i.test(contentText) && !strongTrading) {
    reasons.push("insurance broker, not trading broker");
  }

  if (/\b(?:balance of payments|revised down|tv news|breaking news|parliament|government)\b/i.test(contentText) && !strongTrading) {
    reasons.push("generic news/government result");
  }

  if (domain === "bbs.bt" || domain === "homebroker.com" || domain === "insurebroker.pt") {
    if (!strongTrading) reasons.push("generic non-forex broker/media page");
  }

  if (GENERIC_FINANCE_ROLE_PATTERN.test(contentText) && !strongTrading) {
    reasons.push("generic finance analyst/media result");
  }

  if (/\b(?:sports team|football club|sunderland|houston dynamo|currys|gift card|customer service complaint)\b/i.test(contentText)) {
    reasons.push("consumer/sports/forum noise");
  }

  return [...new Set(reasons)];
}

export function isHardRejectedLead(lead = {}, options = {}) {
  return leadRejectionReasons(lead, options).length > 0;
}

export function hasSearchableLeadSignal(result = {}) {
  const text = qualityText(result, { includeQuery: false });
  if (hasStrongTradingSignal(text)) return true;
  if (/\b(?:introducing broker|forex affiliate|trading educator|forex educator|forex signals|copy trading|pamm|mam account|funded trader|prop firm|money manager|portfolio manager|fund manager|broker partnership|affiliate partner)\b/i.test(text)) {
    return true;
  }
  return false;
}
