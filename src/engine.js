import {
  DEFAULT_SCAN,
  ECOSYSTEM_QUERY_TEMPLATES,
  FORUM_QUERY_TEMPLATES,
  INTENT_POST_QUERY_TEMPLATES,
  PARTNER_QUERY_TEMPLATES,
  RECRUITMENT_QUERY_TEMPLATES,
  SOCIAL_QUERY_TEMPLATES,
  SPECIALIST_QUERY_TEMPLATES,
  SEARCH_PROFILES
} from "./config.js";
import { classifyResult } from "./classify.js";
import { enhanceCommercialLead, isCommerciallyRejected } from "./commercial-intelligence.js";
import { deepEnrichResult } from "./deep.js";
import { exportLeads } from "./exporter.js";
import { isHardRejectedLead } from "./lead-quality.js";
import { balancedSelect, countBySource, sourceBucket } from "./mql5-limit.js";
import { isBlockedCommercialLead, isBlockedCommercialQuery } from "./noise-policy.js";
import { addRun, upsertLeads } from "./store.js";
import { enrichResult } from "./search.js";
import { searchOne } from "./search-fallback.js";
import { CHANNEL_EXPANSION_QUERY_PACKS, EXTRA_HIGH_VALUE_QUERY_PACKS, isBlockedQueryTemplate } from "./sourcing-policy.js";
import { nowIso, sleep } from "./utils.js";

const HIGH_VALUE_QUERY_PACKS = [
  { text: "site:linkedin.com/in \"forex\" \"introducing broker\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"IB partner\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"CPA\" \"affiliate\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"revenue share\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex affiliate\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"PAMM\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"MAM\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"fund manager\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"portfolio manager\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"money manager\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"xauusd\" \"portfolio manager\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"copy trading\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/company \"forex academy\" {region}", intent: "partner" },
  { text: "site:linkedin.com/company \"trading education\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/company \"trading academy\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/posts \"forex\" \"looking for broker\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"which broker\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"IB\" \"commission\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"CPA\" \"affiliate\" {region}", intent: "intent" },
  { text: "site:instagram.com \"forex trader\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex signals\" \"telegram\" {region}", intent: "social" },
  { text: "site:instagram.com \"xauusd\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"gold trader\" \"telegram\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex academy\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"trading mentor\" \"forex\" {region}", intent: "social" },
  { text: "site:x.com \"forex\" \"looking for broker\"", intent: "intent" },
  { text: "site:x.com \"forex\" \"which broker\"", intent: "intent" },
  { text: "site:x.com \"forex\" \"introducing broker\"", intent: "partner" },
  { text: "site:x.com \"forex\" \"affiliate\" \"CPA\"", intent: "partner" },
  { text: "site:t.me \"forex\" \"signals\" {region}", intent: "social" },
  { text: "site:t.me \"xauusd\" \"signals\"", intent: "social" },
  { text: "site:discord.gg \"forex\" \"trading\"", intent: "social" },
  { text: "site:myfxbook.com/members \"forex\" \"manager\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"XAUUSD\"", intent: "specialist" },
  { text: "site:myfxbook.com/portfolio \"forex\" \"public\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"PAMM\" \"forex\"", intent: "specialist" },
  { text: "site:mql5.com/en/users \"forex\" \"signals\"", intent: "specialist" },
  { text: "site:mql5.com/en/signals \"XAUUSD\"", intent: "specialist" },
  { text: "site:fxblue.com/users \"xauusd\"", intent: "specialist" },
  { text: "site:fxblue.com/users \"forex\"", intent: "specialist" },
  { text: "site:zulutrade.com/trader \"forex\"", intent: "specialist" },
  { text: "site:darwinex.com/darwin \"forex\"", intent: "specialist" },
  { text: "site:signalstart.com/analysis \"forex\"", intent: "specialist" },
  { text: "site:forexfactory.com/thread \"introducing broker\"", intent: "forum" },
  { text: "site:forums.babypips.com \"recommend broker\"", intent: "forum" },
  { text: "\"forex academy\" \"partner\" \"whatsapp\" {region}", intent: "partner" },
  { text: "\"trading community\" \"broker partnership\" {region}", intent: "partner" },
  { text: "\"PAMM manager\" \"forex\" \"contact\" {region}", intent: "specialist" },
  { text: "\"copy trading provider\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"affiliate manager\" \"forex\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"business development\" \"forex broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"head of partnerships\" \"forex broker\"", intent: "recruitment" }
];

function setFromCsv(value = "") {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function isYouTubeTemplate(template = "") {
  return /youtube\.com|youtu\.be|\byoutube\b/i.test(String(template));
}

function addAllowedTemplate(target, template, intent, settings) {
  if (settings.includeYouTube !== true && isYouTubeTemplate(template)) return;
  if (isBlockedQueryTemplate(template) || isBlockedCommercialQuery(template)) return;
  target.push({ template, intent });
}

function materializeQuery(item, profile, index) {
  const regions = profile.regions.length ? profile.regions : ["global"];
  const region = regions[index % regions.length];
  return { text: item.template ? item.template.replace("{region}", region) : String(item.text || "").replace("{region}", region), intent: item.intent || "partner" };
}

function buildQueries(options) {
  const settings = { ...DEFAULT_SCAN, ...options };
  const profile = SEARCH_PROFILES[settings.regionSet] || SEARCH_PROFILES.global;
  const families = [
    settings.includePartners ? PARTNER_QUERY_TEMPLATES.map((template) => ({ template, intent: "partner" })) : [],
    settings.includeSocialProfiles !== false ? SOCIAL_QUERY_TEMPLATES.map((template) => ({ template, intent: "social" })) : [],
    settings.includeIntentPosts !== false ? INTENT_POST_QUERY_TEMPLATES.map((template) => ({ template, intent: "intent" })) : [],
    settings.includeForums !== false ? FORUM_QUERY_TEMPLATES.map((template) => ({ template, intent: "forum" })) : [],
    settings.includeSpecialistSources !== false ? SPECIALIST_QUERY_TEMPLATES.map((template) => ({ template, intent: "specialist" })) : [],
    settings.includeEcosystem !== false ? ECOSYSTEM_QUERY_TEMPLATES.map((template) => ({ template, intent: "ecosystem" })) : [],
    settings.includeRecruitment ? RECRUITMENT_QUERY_TEMPLATES.map((template) => ({ template, intent: "recruitment" })) : []
  ].map((family) => {
    const allowed = [];
    for (const item of family) addAllowedTemplate(allowed, item.template, item.intent, settings);
    return allowed;
  }).filter((family) => family.length);

  const queries = [];
  const maxTemplateCount = Math.max(...families.map((family) => family.length), 0);
  for (let templateIndex = 0; templateIndex < maxTemplateCount; templateIndex += 1) {
    for (const family of families) {
      const item = family[templateIndex % family.length];
      if (item) queries.push(materializeQuery(item, profile, templateIndex + queries.length));
    }
  }

  const highValuePacks = [...HIGH_VALUE_QUERY_PACKS, ...EXTRA_HIGH_VALUE_QUERY_PACKS, ...CHANNEL_EXPANSION_QUERY_PACKS];
  queries.push(...highValuePacks
    .filter((query) => !isBlockedQueryTemplate(query.text) && !isBlockedCommercialQuery(query.text))
    .filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text))
    .map((query, index) => materializeQuery(query, profile, index)));

  const onlyIntents = setFromCsv(settings.onlyIntents || "");
  const onlyChannels = setFromCsv(settings.onlyChannels || "");
  const seen = new Set();
  const deduped = queries
    .filter((query) => !onlyIntents.size || onlyIntents.has(query.intent))
    .filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text))
    .filter((query) => !isBlockedQueryTemplate(query.text) && !isBlockedCommercialQuery(query.text))
    .filter((query) => {
      const key = query.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((query) => ({ ...query, channel: sourceBucket(query) }))
    .filter((query) => !onlyChannels.size || onlyChannels.has(query.channel));

  return balancedSelect(deduped, {
    limit: Number(settings.maxQueries) || DEFAULT_SCAN.maxQueries,
    offset: Number(settings.queryOffset || 0),
    order: onlyChannels.size ? [...onlyChannels] : undefined,
    maxMql5Share: onlyChannels.has("mql5") ? 1 : Number(settings.maxMql5QueryShare ?? process.env.MAX_MQL5_QUERY_SHARE ?? 0.12),
    minMql5Keep: onlyChannels.has("mql5") ? Number(settings.maxQueries || DEFAULT_SCAN.maxQueries) : Number(settings.minMql5Queries ?? 2)
  });
}

function makeSourceStats() {
  return { searches: 0, raw: 0, qualified: 0, saved: 0, discarded: 0, duplicates: 0, errors: 0, providerErrors: 0, reasons: {} };
}

function bumpReason(stats, reason) {
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
}

function recordProviderErrors(stats, providerErrors = []) {
  if (!providerErrors.length) return;
  stats.providerErrors = Number(stats.providerErrors || 0) + providerErrors.length;
  bumpReason(stats, "provider_errors");
}

async function findResults(query, limit) {
  const response = await searchOne(query.text, query.intent, limit);
  if (Array.isArray(response)) return { results: response, providerErrors: response.errors || [] };
  if (response && Array.isArray(response.results)) return { results: response.results, providerErrors: response.errors || [] };
  return { results: [], providerErrors: [`Unexpected search response for ${query.text}`] };
}

async function prepareLead(raw, query, settings) {
  let enriched = await enrichResult(raw, query.intent);
  enriched.sourceIntent = query.intent;
  enriched.sourceQuery = query.text;
  if (settings.fetchPages) {
    enriched = await deepEnrichResult(enriched, {
      searchContacts: settings.searchContacts,
      maxContactPages: settings.maxContactPages,
      maxExternalWebsites: settings.maxExternalWebsites,
      maxTrailQueries: settings.maxTrailQueries,
      trailLimit: settings.trailLimit
    });
  }
  return enhanceCommercialLead(classifyResult(enriched, query.intent));
}

function shouldDiscard(lead) {
  if (isBlockedCommercialLead(lead)) return "blocked_commercial_noise";
  if (isHardRejectedLead(lead)) return "hard_rejected";
  if (lead.qualificationStatus === "rejected") return "classification_rejected";
  if (isCommerciallyRejected(lead)) return "commercially_rejected";
  if (Number(lead.commercialScore || lead.score || 0) < 42) return "commercial_score_below_threshold";
  return "";
}

export async function runScan(options = {}, onProgress = () => {}) {
  const settings = { ...DEFAULT_SCAN, ...options };
  const runId = `run_${Date.now()}`;
  const startedAt = nowIso();
  const queries = buildQueries(settings);
  const seenResults = new Map();
  const leads = [];
  const errors = [];
  const sourceStats = {};
  const persisted = { created: [], updated: [] };
  const exportEvery = Number(settings.exportEvery || 10);

  const statFor = (query) => {
    if (!sourceStats[query.channel]) sourceStats[query.channel] = makeSourceStats();
    return sourceStats[query.channel];
  };

  onProgress({ status: "running", message: `Starting quality discovery with ${queries.length} queries`, sourceStats });

  for (const query of queries) {
    const stats = statFor(query);
    stats.searches += 1;
    try {
      const { results: rawResults, providerErrors } = await findResults(query, settings.limitPerQuery);
      recordProviderErrors(stats, providerErrors);
      stats.raw += rawResults.length;
      for (const raw of rawResults) {
        const resultKey = `${raw.url || ""}|${raw.title || ""}`.toLowerCase();
        if (seenResults.has(resultKey)) {
          stats.duplicates += 1;
          continue;
        }
        seenResults.set(resultKey, true);
        const classified = await prepareLead(raw, query, settings);
        const discardReason = shouldDiscard(classified);
        if (discardReason) {
          stats.discarded += 1;
          bumpReason(stats, discardReason);
          continue;
        }
        stats.qualified += 1;
        leads.push(classified);
        const storedBatch = await upsertLeads([classified], runId);
        persisted.created.push(...storedBatch.created);
        persisted.updated.push(...storedBatch.updated);
        stats.saved += storedBatch.created.length;
        if (!storedBatch.created.length && storedBatch.updated.length) stats.duplicates += 1;
        if (leads.length % exportEvery === 0) await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
        onProgress({ status: "running", message: `Saved qualified lead: ${classified.companyName || classified.name}`, latestLead: classified, sourceStats });
      }
    } catch (error) {
      stats.errors += 1;
      errors.push({ query: query.text, error: error.message, stack: error.stack });
      onProgress({ status: "running", message: `Search failed [${query.channel}]: ${error.message}`, sourceStats });
    }
    await sleep(Number(settings.delayMs || 0));
  }

  const exportResult = await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
  const run = { id: runId, startedAt, finishedAt: nowIso(), settings, totalQueries: queries.length, rawResults: Object.values(sourceStats).reduce((sum, value) => sum + Number(value.raw || 0), 0), leadsFound: leads.length, created: persisted.created.length, updated: persisted.updated.length, sourceStats, qualifiedBySource: countBySource(leads), exportResult, errors };
  await addRun(run);
  onProgress({ status: "completed", message: `Quality discovery completed: ${run.created} new / ${run.updated} updated leads`, sourceStats });
  return run;
}
