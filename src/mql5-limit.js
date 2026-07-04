// MQL5 balance helper.
export function isMql5Item(item = {}) {
  return /mql5/i.test([
    item.platform,
    item.source,
    item.sourcePack,
    item.query,
    item.url,
    item.domain,
    item.title,
    item.name
  ].filter(Boolean).join(" "));
}

export function limitMql5Share(items = [], options = {}) {
  const maxShare = Number(options.maxMql5Share ?? 0.25);
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
