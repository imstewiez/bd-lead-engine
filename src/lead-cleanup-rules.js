import { sourceBucket } from "./mql5-limit.js";

function flatLeadText(lead = {}) {
  return [
    lead.name,
    lead.title,
    lead.snippet,
    lead.url,
    lead.domain,
    lead.platform,
    lead.sourceIntent,
    lead.segment,
    lead.leadType,
    ...(lead.evidence || []),
    ...(lead.websiteLinks || []),
    ...(lead.socialLinks || []),
    ...(lead.contactLinks || []),
    ...(lead.relatedLinks || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function extraCleanupReason(lead = {}) {
  const text = flatLeadText(lead);
  const bucket = sourceBucket(lead);
  const combined = `${text} ${bucket}`;

  if (combined.includes("tradingview")) return "tradingview_not_target_lead";
  if (combined.includes("payments.google.com") || combined.includes("google payments") || combined.includes("google pay")) return "payments_platform_noise";
  if (combined.includes("basketball-reference.com") || combined.includes("basketball standings") || combined.includes("nba standings")) return "sports_reference_noise";
  if (combined.includes("overleaf.com") || combined.includes("latex templates")) return "document_template_noise";
  return "";
}
