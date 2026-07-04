// Lead/source balancing helper.
export function sourceText(item = {}) {
  return [
    item.channel,
    item.platform,
    item.source,
    item.sourcePack,
    item.sourceIntent,
    item.intent,
    item.query,
    item.text,
    item.url,
    item.domain,
    item.title,
    item.name,
    item.segment,
    item.leadType
  ].filter(Boolean).join(" ").toLowerCase();
}

export function sourceBucket(item = {}) {
  const text = sourceText(item);
  if (/mql5/.test(text)) return "mql5";
  if (/linkedin/.test(text)) return "linkedin";
  if (/instagram/.test(text)) return "instagram";
  if (/x\.com|twitter|x\/twitter/.test(text)) return "x";
  if (/telegram|t\.me/.test(text)) return "telegram";
  if (/discord|disboard/.test(text)) return "discord";
  if (/tiktok/.test(text)) return "tiktok";
  if (/facebook|threads/.test(text)) return "facebook_threads";
  if (/myfxbook/.test(text)) return "myfxbook";
  if (/tradingview/.test(text)) return "tradingview";
  if (/fxblue|zulutrade|darwinex|signalstart|collective2/.test(text)) return "specialist";
  if (/reddit|forum|forexfactory|babypips|earnforex|forexpeacearmy|trade2win|elitetrader/.test(text)) return "forum";
  if (/expo|summit|event|speaker|sponsor|exhibitor|opencorporates|registry|regulatory|adviserinfo|fca|cvm|cnmv|cmfchile|superfinanciera|company-information/.test(text)) return "ecosystem";
  if (/business development|partnership manager|affiliate manager|country manager|regional manager|retention manager|sales manager|broker talent|recruitment/.test(text)) return "recruitment";
  return "web";
}

export function isMql5Item(item = {}) {
  return sourceBucket(item) === "mql5";
}

export function limitMql5Share(items = [], options = {}) {
  const maxShare = Number(options.maxMql5Share ?? 0.22);
  const minKeep = Number(options.minMql5Keep ?? 12);
  const limit = Number(options.limit || items.length);
  const mql5 = items.filter(isMql5Item);
  const rest = items.filter((item) => !isMql5Item(item));

  if (!mql5.length) return items.slice(0, limit);
  if (!rest.length) return mql5.slice(0, limit);

  const allowed = Math.min(
    mql5.length,
    Math.max(minKeep, Math.ceil((rest.length * maxShare) / Math.max(0.01, 1 - maxShare)))
  );

  let used = 0;
  return items.filter((item) => {
    if (!isMql5Item(item)) return true;
    used += 1;
    return used <= allowed;
  }).slice(0, limit);
}

export const BALANCED_SOURCE_ORDER = [
  "linkedin",
  "instagram",
  "x",
  "telegram",
  "discord",
  "tiktok",
  "facebook_threads",
  "myfxbook",
  "tradingview",
  "specialist",
  "forum",
  "ecosystem",
  "recruitment",
  "web",
  "mql5"
];

export function sourceRank(item = {}) {
  const index = BALANCED_SOURCE_ORDER.indexOf(sourceBucket(item));
  return index === -1 ? BALANCED_SOURCE_ORDER.length : index;
}

function itemKey(item = {}) {
  return String(item.id || item.url || item.text || item.query || `${item.name || ""}|${item.domain || ""}`).replace(/\/$/, "").toLowerCase();
}

export function balancedSelect(items = [], options = {}) {
  const limit = Math.max(0, Number(options.limit || items.length));
  const offset = Math.max(0, Number(options.offset || 0));
  const sorted = [...items].sort(options.sort || ((a, b) => sourceRank(a) - sourceRank(b)));
  const capped = limitMql5Share(sorted, { ...options, limit: sorted.length });
  const buckets = new Map();

  for (const item of capped) {
    const bucket = sourceBucket(item);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(item);
  }

  for (const [bucket, values] of buckets) {
    if (!values.length) continue;
    const shift = offset % values.length;
    buckets.set(bucket, [...values.slice(shift), ...values.slice(0, shift)]);
  }

  const order = [...new Set([...(options.order || BALANCED_SOURCE_ORDER), ...buckets.keys()])].filter((bucket) => buckets.has(bucket));
  const selected = [];
  const seen = new Set();
  let moved = true;

  while (selected.length < limit && moved) {
    moved = false;
    for (const bucket of order) {
      if (selected.length >= limit) break;
      const item = buckets.get(bucket)?.shift();
      if (!item) continue;
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(item);
      moved = true;
    }
  }

  return selected;
}

export function countBySource(items = []) {
  return items.reduce((acc, item) => {
    const bucket = sourceBucket(item);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}
