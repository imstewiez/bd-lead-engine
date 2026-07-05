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

export function isBlockedQueryTemplate(template = "") {
  const text = String(template || "").toLowerCase();
  if (text.includes("tradingview")) return true;
  if (/\b(?:expo|conference|fair|summit|event)\b/.test(text) && /\b(?:exhibitor|exhibitors|booth|stands?|sponsor list|all exhibitors)\b/.test(text)) return true;
  if (/\bexhibitor list\b|\ball exhibitors\b|\bexhibitors list\b/.test(text)) return true;
  if (text.includes("scribd.com") && text.includes("exhibitor")) return true;
  return false;
}
