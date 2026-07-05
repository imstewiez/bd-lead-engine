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
import { deepEnrichResult } from "./deep.js";
import { exportLeads } from "./exporter.js";
import { isHardRejectedLead } from "./lead-quality.js";
import { addRun, upsertLeads } from "./store.js";
import { enrichResult } from "./search.js";
import { searchOne } from "./search-fallback.js";
import { balancedSelect, countBySource, sourceBucket } from "./mql5-limit.js";
import { EXTRA_HIGH_VALUE_QUERY_PACKS, isBlockedQueryTemplate } from "./sourcing-policy.js";
import { idForLead, nowIso, sleep } from "./utils.js";

const HIGH_VALUE_QUERY_PACKS = [
  { text: "site:linkedin.com/in \"forex\" \"introducing broker\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"IB partner\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"CPA\" \"affiliate\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"revenue share\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"revshare\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex\" \"partnerships\" \"affiliate\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex affiliate\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"PAMM\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"MAM\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"fund manager\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"portfolio manager\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"money manager\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"xauusd\" \"portfolio manager\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"copy trading\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"EA developer\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"algo trader\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/company \"forex academy\" {region}", intent: "social" },
  { text: "site:linkedin.com/company \"trading education\" \"forex\" {region}", intent: "social" },
  { text: "site:linkedin.com/company \"trading academy\" \"forex\" {region}", intent: "social" },
  { text: "site:linkedin.com/company \"prop trading\" \"forex\" {region}", intent: "ecosystem" },
  { text: "site:linkedin.com/posts \"forex\" \"looking for broker\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"which broker\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"IB\" \"commission\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"CPA\" \"affiliate\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"revenue share\" {region}", intent: "intent" },
  { text: "site:linkedin.com/feed/update \"forex\" \"recommend broker\" {region}", intent: "intent" },
  { text: "site:instagram.com \"forex trader\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex signals\" \"telegram\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex\" \"linktr.ee\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex\" \"beacons\" \"telegram\" {region}", intent: "social" },
  { text: "site:instagram.com \"copy trading\" \"forex\" {region}", intent: "social" },
  { text: "site:instagram.com \"funded trader\" \"forex\" {region}", intent: "social" },
  { text: "site:instagram.com \"xauusd\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"gold trader\" \"telegram\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex academy\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"trading mentor\" \"forex\" {region}", intent: "social" },
  { text: "site:linktr.ee \"forex trader\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:beacons.ai \"forex trader\" \"telegram\" {region}", intent: "social" },
  { text: "site:x.com \"forex\" \"looking for broker\"", intent: "intent" },
  { text: "site:x.com \"forex\" \"which broker\"", intent: "intent" },
  { text: "site:x.com \"forex\" \"recommend broker\"", intent: "intent" },
  { text: "site:x.com \"xauusd\" \"signals\"", intent: "social" },
  { text: "site:x.com \"forex\" \"introducing broker\"", intent: "partner" },
  { text: "site:x.com \"forex\" \"affiliate\" \"CPA\"", intent: "partner" },
  { text: "site:x.com \"forex\" \"revshare\"", intent: "partner" },
  { text: "site:x.com \"forex\" \"IB\" \"commission\"", intent: "partner" },
  { text: "site:x.com \"xauusd\" \"telegram\"", intent: "social" },
  { text: "site:tiktok.com/@ \"forex trader\" {region}", intent: "social" },
  { text: "site:tiktok.com/@ \"xauusd\" \"trader\" {region}", intent: "social" },
  { text: "site:tiktok.com/@ \"forex signals\" {region}", intent: "social" },
  { text: "site:tiktok.com/@ \"funded trader\" \"forex\" {region}", intent: "social" },
  { text: "site:t.me \"forex\" \"signals\" {region}", intent: "social" },
  { text: "site:t.me \"xauusd\" \"signals\"", intent: "social" },
  { text: "site:t.me \"forex\" \"copy trading\"", intent: "social" },
  { text: "site:t.me \"forex\" \"VIP\" \"signals\"", intent: "social" },
  { text: "site:t.me \"forex\" \"mentor\" \"whatsapp\"", intent: "social" },
  { text: "site:telegram.me \"forex\" \"signals\"", intent: "social" },
  { text: "site:discord.gg \"forex\" \"trading\"", intent: "social" },
  { text: "site:disboard.org/server \"forex\" \"trading\"", intent: "social" },
  { text: "site:discord.me \"forex\" \"trading\"", intent: "social" },
  { text: "site:top.gg/servers \"forex\" \"trading\"", intent: "social" },
  { text: "site:myfxbook.com/members \"forex\" \"manager\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"XAUUSD\"", intent: "specialist" },
  { text: "site:myfxbook.com/portfolio \"forex\" \"public\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"PAMM\" \"forex\"", intent: "specialist" },
  { text: "site:fxblue.com/users \"xauusd\"", intent: "specialist" },
  { text: "site:fxblue.com/users \"forex\"", intent: "specialist" },
  { text: "site:zulutrade.com/trader \"forex\"", intent: "specialist" },
  { text: "site:darwinex.com/darwin \"forex\"", intent: "specialist" },
  { text: "site:signalstart.com/analysis \"forex\"", intent: "specialist" },
  { text: "site:reddit.com/r/Forex \"which broker\"", intent: "intent" },
  { text: "site:reddit.com/r/Forex \"recommend broker\"", intent: "intent" },
  { text: "site:forexfactory.com/thread \"which broker\"", intent: "forum" },
  { text: "site:forexfactory.com/thread \"introducing broker\"", intent: "forum" },
  { text: "site:forexfactory.com/thread \"copy trading\"", intent: "forum" },
  { text: "site:forums.babypips.com \"recommend broker\"", intent: "forum" },
  { text: "site:forums.babypips.com \"forex signals\" \"telegram\"", intent: "forum" },
  { text: "site:earnforex.com/forum \"introducing broker\"", intent: "forum" },
  { text: "site:forexpeacearmy.com/community \"which broker\"", intent: "forum" },
  { text: "\"trading expo\" \"speakers\" {region}", intent: "ecosystem" },
  { text: "\"iFX EXPO\" \"attendees\" \"forex\"", intent: "ecosystem" },
  { text: "\"Finance Magnates\" \"forex\" \"speaker\" {region}", intent: "ecosystem" },
  { text: "\"Traders Fair\" \"speaker\" \"forex\" {region}", intent: "ecosystem" },
  { text: "\"Wiki Finance Expo\" \"forex\" \"speaker\"", intent: "ecosystem" },
  { text: "\"forex academy\" \"partner\" \"whatsapp\" {region}", intent: "partner" },
  { text: "\"trading community\" \"broker partnership\" {region}", intent: "partner" },
  { text: "\"trading academy\" \"sponsor\" \"broker\" {region}", intent: "partner" },
  { text: "\"retail trading community\" \"sponsor\" {region}", intent: "partner" },
  { text: "\"PAMM manager\" \"forex\" \"contact\" {region}", intent: "specialist" },
  { text: "\"MAM account manager\" \"forex\" {region}", intent: "specialist" },
  { text: "\"copy trading provider\" \"forex\" {region}", intent: "specialist" },
  { text: "\"forex\" \"shareholder\" \"director\" \"company\" {region}", intent: "ecosystem" },
  { text: "site:opencorporates.com \"forex\" \"trading\" \"director\"", intent: "ecosystem" },
  { text: "site:find-and-update.company-information.service.gov.uk \"forex\" \"director\"", intent: "ecosystem" },
  { text: "site:register.fca.org.uk \"contract for difference\" \"investment\"", intent: "ecosystem" },
  { text: "site:cadastro.cvm.gov.br \"consultor\" \"derivativos\"", intent: "ecosystem" },
  { text: "site:linkedin.com/in \"affiliate manager\" \"forex\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"business development\" \"forex broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"country manager\" \"forex\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"head of partnerships\" \"forex broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"former\" \"forex broker\" \"business development\"", intent: "recruitment" },
  { text: "site:mql5.com/en/users \"forex\" \"signals\"", intent: "specialist" },
  { text: "site:mql5.com/en/signals \"XAUUSD\"", intent: "specialist" }
];

function isYouTubeTemplate(template = "") {
  return /youtube\.com|youtu\.be|\byoutube\b/i.test(String(template));
}

function addAllowedTemplate(target, template, intent, settings) {
  if (settings.includeYouTube !== true && isYouTubeTemplate(template)) return;
  if (isBlockedQueryTemplate(template)) return;
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
  const partnerTemplates = [];
  const recruitmentTemplates = [];
  const intentTemplates = [];
  const ecosystemTemplates = [];
  const socialTemplates = [];
  const forumTemplates = [];
  const specialistTemplates = [];

  if (settings.includePartners) for (const template of PARTNER_QUERY_TEMPLATES) addAllowedTemplate(partnerTemplates, template, "partner", settings);
  if (settings.includeRecruitment) for (const template of RECRUITMENT_QUERY_TEMPLATES) addAllowedTemplate(recruitmentTemplates, template, "recruitment", settings);
  if (settings.includeIntentPosts !== false) for (const template of INTENT_POST_QUERY_TEMPLATES) addAllowedTemplate(intentTemplates, template, "intent", settings);
  if (settings.includeEcosystem !== false) for (const template of ECOSYSTEM_QUERY_TEMPLATES) addAllowedTemplate(ecosystemTemplates, template, "ecosystem", settings);
  if (settings.includeSocialProfiles !== false) for (const template of SOCIAL_QUERY_TEMPLATES) addAllowedTemplate(socialTemplates, template, "social", settings);
  if (settings.includeForums !== false) for (const template of FORUM_QUERY_TEMPLATES) addAllowedTemplate(forumTemplates, template, "forum", settings);
  if (settings.includeSpecialistSources !== false) for (const template of SPECIALIST_QUERY_TEMPLATES) addAllowedTemplate(specialistTemplates, template, "specialist", settings);

  const queries = [];
  const families = [partnerTemplates, socialTemplates, intentTemplates, forumTemplates, specialistTemplates, ecosystemTemplates, recruitmentTemplates].filter((family) => family.length);
  const maxTemplateCount = Math.max(...families.map((family) => family.length), 0);
  for (let templateIndex = 0; templateIndex < maxTemplateCount; templateIndex += 1) {
    for (const family of families) {
      const item = family[templateIndex % family.length];
      if (item) queries.push(materializeQuery(item, profile, templateIndex + queries.length));
    }
  }

  const highValuePacks = [...HIGH_VALUE_QUERY_PACKS, ...EXTRA_HIGH_VALUE_QUERY_PACKS];
  queries.push(...highValuePacks.filter((query) => !isBlockedQueryTemplate(query.text)).filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text)).map((query, index) => materializeQuery(query, profile, index)));
  const onlyIntents = new Set(
    String(settings.onlyIntents || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  const seen = new Set();
  const deduped = queries.filter((query) => !onlyIntents.size || onlyIntents.has(query.intent)).filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text)).filter((query) => !isBlockedQueryTemplate(query.text)).filter((query) => {
    const key = query.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((query) => ({ ...query, channel: sourceBucket(query) }));

  return balancedSelect(deduped, {
    limit: Number(settings.maxQueries) || DEFAULT_SCAN.maxQueries,
    offset: Number(settings.queryOffset || 0),
    maxMql5Share: Number(settings.maxMql5QueryShare ?? process.env.MAX_MQL5_QUERY_SHARE ?? 0.12),
    minMql5Keep: Number(settings.minMql5Queries ?? 2)
  });
}

function makeSourceStats() {
  return { searches: 0, raw: 0, qualified: 0, saved: 0, discarded: 0, duplicates: 0, errors: 0, reasons: {} };
}

function bumpReason(stats, reason) {
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
}

function valuableSource(classified = {}, query = {}) {
  const text = `${classified.url} ${classified.platform} ${classified.title} ${classified.snippet}`.toLowerCase();
  return /linkedin\.com\/in|linkedin\.com\/company|instagram\.com\/[^/]+|x\.com\/[^/]+|twitter\.com\/[^/]+|t\.me\/[^/]+|discord\.gg\/[^/]+|myfxbook\.com|mql5\.com|forexfactory\.com\/thread|babypips\.com|forex|xauusd|copy trading|signals|introducing broker|affiliate|partnership|fund manager|portfolio manager|trading academy|forex academy|mentor|attending|visitor|delegate|speaker|panelist/.test(text);
}

function makeSavedCandidate(classified, query, reason) {
  const score = Math.max(Number(classified.score || 0), valuableSource(classified, query) ? 45 : 35);
  const priority = score >= 70 ? "A" : score >= 45 ? "B" : "C";
  return {
    ...classified,
    score,
    priority,
    sourceBucket: query.channel || sourceBucket(query),
    leadType: ["partner", "recruitment", "institution"].includes(classified.leadType) ? classified.leadType : "partner",
    segment: classified.segment && classified.segment !== "Unclear" ? classified.segment : "Research Candidate",
    evidence: [...new Set([...(classified.evidence || []), `Saved from ${query.channel || query.intent} search`, reason].filter(Boolean))],
    qualificationStatus: "research_candidate"
  };
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
  const incremental = settings.incremental !== false;
  const exportEvery = Number(settings.exportEvery || 10);

  const statFor = (query) => {
    if (!sourceStats[query.channel]) sourceStats[query.channel] = makeSourceStats();
    return sourceStats[query.channel];
  };

  onProgress({ status: "running", message: `Starting scan with ${queries.length} balanced queries`, sourceStats });

  for (const query of queries) {
    const stats = statFor(query);
    stats.searches += 1;
    onProgress({ status: "running", message: `Searching [${query.channel}]: ${query.text}`, sourceStats });
    try {
      const rawResults = await searchOne(query.text, { limit: settings.limitPerQuery });
      stats.raw += rawResults.length;
      for (const raw of rawResults) {
        const resultKey = `${raw.url || ""}|${raw.title || ""}`.toLowerCase();
        if (seenResults.has(resultKey)) {
          stats.duplicates += 1;
          continue;
        }
        seenResults.set(resultKey, true);
        let enriched = enrichResult(raw, query.intent);
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
        const classified = classifyResult(enriched, query.intent);
        if (isHardRejectedLead(classified)) {
          stats.discarded += 1;
          bumpReason(stats, "hard_rejected");
          onProgress({ status: "running", message: `Discarded hard-rejected result: ${classified.name}`, sourceStats });
          continue;
        }
        if (classified.qualificationStatus === "rejected") {
          stats.discarded += 1;
          bumpReason(stats, "low_score");
          onProgress({ status: "running", message: `Discarded low-fit result: ${classified.name}`, sourceStats });
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
        onProgress({ status: "running", message: `Saved ${classified.priority || "?"}-lead: ${classified.name}`, latestLead: classified, sourceStats });
      }
    } catch (error) {
      stats.errors += 1;
      errors.push({ query: query.text, error: error.message });
    }
    await sleep(Number(settings.delayMs || 0));
  }

  const fallbackSeeds = queries.filter((query) => ["partner", "social", "intent", "ecosystem", "forum", "specialist"].includes(query.intent)).slice(0, Math.max(15, Math.min(80, Math.floor(queries.length * 0.55))));
  for (const query of fallbackSeeds) {
    const stats = statFor(query);
    try {
      const rawResults = await searchOne(query.text, { limit: Math.max(3, Math.min(settings.limitPerQuery, 10)) });
      for (const raw of rawResults) {
        const resultKey = `${raw.url || ""}|${raw.title || ""}`.toLowerCase();
        if (seenResults.has(resultKey)) {
          stats.duplicates += 1;
          continue;
        }
        seenResults.set(resultKey, true);
        let enriched = enrichResult(raw, query.intent);
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
        const classified = classifyResult(enriched, query.intent);
        if (isHardRejectedLead(classified)) {
          stats.discarded += 1;
          bumpReason(stats, "hard_rejected");
          continue;
        }
        if (classified.qualificationStatus === "rejected") {
          const fallbackLead = makeSavedCandidate(classified, query, "Low-fit but searchable public lead for manual review");
          const storedBatch = await upsertLeads([fallbackLead], runId);
          persisted.created.push(...storedBatch.created);
          persisted.updated.push(...storedBatch.updated);
          stats.saved += storedBatch.created.length;
          continue;
        }
        const storedBatch = await upsertLeads([classified], runId);
        persisted.created.push(...storedBatch.created);
        persisted.updated.push(...storedBatch.updated);
        stats.saved += storedBatch.created.length;
      }
    } catch (error) {
      stats.errors += 1;
      errors.push({ query: query.text, error: error.message });
    }
  }

  const exportResult = await exportLeads({ csvName: "autopilot-leads.csv", jsonName: "autopilot-leads.json" });
  const run = { id: runId, startedAt, finishedAt: nowIso(), settings, totalQueries: queries.length, rawResults: Object.values(sourceStats).reduce((sum, value) => sum + value.raw, 0), leadsFound: leads.length, created: persisted.created.length, updated: persisted.updated.length, sourceStats, qualifiedBySource: countBySource(leads), exportResult };
  await addRun(run);
  onProgress({ status: "completed", message: `Run completed: ${run.created} new / ${run.updated} updated leads`, sourceStats });
  return run;
}
