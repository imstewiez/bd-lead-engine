export const EXTRA_HIGH_VALUE_QUERY_PACKS = [
  { text: "site:linkedin.com/posts \"Forex Expo Dubai\" \"attending\"", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"Forex Expo Dubai\" \"visitor\"", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"Forex Expo Dubai\" \"delegate\"", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"Forex Expo Dubai\" \"meet me\"", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"Forex Expo Dubai\" \"see you there\"", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"iFX EXPO\" \"attending\" \"forex\"", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"iFX EXPO\" \"meet me\" \"forex\"", intent: "ecosystem" },
  { text: "site:linkedin.com/in \"Forex Expo Dubai\" \"attendee\"", intent: "ecosystem" },
  { text: "site:linkedin.com/in \"iFX EXPO\" \"attendee\" \"forex\"", intent: "ecosystem" },
  { text: "\"Forex Expo Dubai\" \"attending\" \"introducing broker\"", intent: "partner" },
  { text: "\"Forex Expo Dubai\" \"attending\" \"affiliate\" \"forex\"", intent: "partner" },
  { text: "\"Forex Expo Dubai\" \"visitor pass\" \"forex\"", intent: "ecosystem" },
  { text: "\"Forex Expo Dubai\" \"delegate pass\" \"forex\"", intent: "ecosystem" },
  { text: "\"traders fair\" \"attending\" \"forex\" {region}", intent: "ecosystem" },
  { text: "\"money expo\" \"attending\" \"forex\" {region}", intent: "ecosystem" }
];

export const CHANNEL_EXPANSION_QUERY_PACKS = [
  { text: "site:linkedin.com/in \"introducing broker\" \"forex\" \"{region}\"", intent: "partner" },
  { text: "site:linkedin.com/in \"forex affiliate\" \"{region}\"", intent: "partner" },
  { text: "site:linkedin.com/in \"fund manager\" \"forex\" \"{region}\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"portfolio manager\" \"forex\" \"{region}\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"money manager\" \"forex\" \"{region}\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"asset manager\" \"forex\" \"{region}\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"copy trading\" \"forex\" \"{region}\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"PAMM\" \"forex\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"MAM\" \"forex\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"XAUUSD\" \"portfolio manager\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"gold trader\" \"fund manager\"", intent: "specialist" },
  { text: "site:linkedin.com/in \"trading academy\" \"founder\" \"forex\" \"{region}\"", intent: "partner" },
  { text: "site:linkedin.com/in \"forex academy\" \"founder\" \"{region}\"", intent: "partner" },
  { text: "site:linkedin.com/in \"trading community\" \"founder\" \"forex\"", intent: "partner" },
  { text: "site:linkedin.com/in \"forex signals\" \"founder\"", intent: "partner" },
  { text: "site:linkedin.com/in \"head of partnerships\" \"forex broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"affiliate manager\" \"forex broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"business development\" \"CFD broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"country manager\" \"forex broker\" \"{region}\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"regional manager\" \"forex broker\" \"{region}\"", intent: "recruitment" },
  { text: "site:linkedin.com/company \"forex academy\" \"{region}\"", intent: "partner" },
  { text: "site:linkedin.com/company \"trading education\" \"forex\"", intent: "partner" },
  { text: "site:linkedin.com/company \"copy trading\" \"forex\"", intent: "specialist" },
  { text: "site:linkedin.com/company \"asset management\" \"forex\"", intent: "institution" },
  { text: "site:linkedin.com/company \"wealth management\" \"forex\"", intent: "institution" },

  { text: "site:myfxbook.com/members \"forex\" \"manager\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"fund manager\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"money manager\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"PAMM\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"MAM\" \"forex\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"XAUUSD\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"gold\" \"forex\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"copy trading\"", intent: "specialist" },
  { text: "site:myfxbook.com/portfolio \"forex\" \"gain\"", intent: "specialist" },
  { text: "site:myfxbook.com/portfolio \"XAUUSD\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"forex\" \"signals\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"copy trading\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"XAUUSD\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"gold\" \"trader\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"PAMM\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"MAM\"", intent: "specialist" },
  { text: "site:mql5.com/en/signals \"XAUUSD\" \"growth\"", intent: "specialist" },
  { text: "site:mql5.com/en/signals \"forex\" \"growth\" \"reliability\"", intent: "specialist" },
  { text: "site:mql5.com/en/signals \"subscribers\" \"forex\"", intent: "specialist" },
  { text: "site:fxblue.com/users \"forex\" \"portfolio\"", intent: "specialist" },
  { text: "site:fxblue.com/users \"XAUUSD\"", intent: "specialist" },
  { text: "site:zulutrade.com/trader \"forex\"", intent: "specialist" },
  { text: "site:darwinex.com/darwin \"forex\"", intent: "specialist" },
  { text: "site:signalstart.com/analysis \"forex\"", intent: "specialist" },
  { text: "site:collective2.com \"forex\" \"strategy\"", intent: "specialist" },

  { text: "site:adviserinfo.sec.gov \"foreign exchange\" \"investment adviser\"", intent: "ecosystem" },
  { text: "site:sec.gov \"foreign exchange\" \"investment adviser\"", intent: "ecosystem" },
  { text: "site:register.fca.org.uk \"contract for difference\" \"investment\"", intent: "ecosystem" },
  { text: "site:register.fca.org.uk \"CFD\" \"portfolio management\"", intent: "ecosystem" },
  { text: "site:opencorporates.com \"forex\" \"trading\"", intent: "ecosystem" },
  { text: "site:opencorporates.com \"capital management\" \"forex\"", intent: "ecosystem" },
  { text: "site:cadastro.cvm.gov.br \"consultor\" \"derivativos\"", intent: "ecosystem" },
  { text: "site:cvm.gov.br \"gestor de recursos\" \"derivativos\"", intent: "ecosystem" },
  { text: "site:cnmv.es \"divisas\" \"gestora\"", intent: "ecosystem" },
  { text: "site:cmfchile.cl \"asesor\" \"inversiones\" \"divisas\"", intent: "ecosystem" },
  { text: "site:superfinanciera.gov.co \"asesor\" \"forex\"", intent: "ecosystem" }
];

export function isBlockedQueryTemplate(template = "") {
  const text = String(template || "").toLowerCase();
  if (text.includes("tradingview")) return true;
  if (/\b(?:expo|conference|fair|summit|event)\b/.test(text) && /\b(?:exhibitor|exhibitors|booth|stands?|sponsor list|all exhibitors)\b/.test(text)) return true;
  if (/\bexhibitor list\b|\ball exhibitors\b|\bexhibitors list\b/.test(text)) return true;
  if (text.includes("scribd.com") && text.includes("exhibitor")) return true;
  return false;
}
