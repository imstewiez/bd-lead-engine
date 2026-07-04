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
import { idForLead, nowIso, sleep } from "./utils.js";

const HIGH_VALUE_QUERY_PACKS = [
  { text: "site:linkedin.com/in \"forex\" \"introducing broker\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"forex affiliate\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"PAMM\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"MAM\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/in \"copy trading\" \"forex\" {region}", intent: "partner" },
  { text: "site:linkedin.com/company \"forex academy\" {region}", intent: "social" },
  { text: "site:linkedin.com/company \"trading education\" \"forex\" {region}", intent: "social" },
  { text: "site:linkedin.com/posts \"forex\" \"looking for broker\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"which broker\" {region}", intent: "intent" },
  { text: "site:linkedin.com/posts \"forex\" \"IB\" \"commission\" {region}", intent: "intent" },
  { text: "site:instagram.com \"forex trader\" \"whatsapp\" {region}", intent: "social" },
  { text: "site:instagram.com \"forex signals\" \"telegram\" {region}", intent: "social" },
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
  { text: "site:tiktok.com/@ \"forex trader\" {region}", intent: "social" },
  { text: "site:tiktok.com/@ \"xauusd\" \"trader\" {region}", intent: "social" },
  { text: "site:tiktok.com/@ \"forex signals\" {region}", intent: "social" },
  { text: "site:t.me \"forex\" \"signals\" {region}", intent: "social" },
  { text: "site:t.me \"xauusd\" \"signals\"", intent: "social" },
  { text: "site:t.me \"forex\" \"copy trading\"", intent: "social" },
  { text: "site:discord.gg \"forex\" \"trading\"", intent: "social" },
  { text: "site:disboard.org/server \"forex\" \"trading\"", intent: "social" },
  { text: "site:myfxbook.com/members \"forex\" \"manager\"", intent: "specialist" },
  { text: "site:myfxbook.com/members \"XAUUSD\"", intent: "specialist" },
  { text: "site:myfxbook.com/portfolio \"forex\" \"public\"", intent: "specialist" },
  { text: "site:tradingview.com/u/ \"forex\" \"signals\"", intent: "forum" },
  { text: "site:tradingview.com/ideas \"forex\" \"broker\"", intent: "forum" },
  { text: "site:fxblue.com/users \"forex\"", intent: "specialist" },
  { text: "site:zulutrade.com/trader \"forex\"", intent: "specialist" },
  { text: "site:darwinex.com/darwin \"forex\"", intent: "specialist" },
  { text: "site:signalstart.com/analysis \"forex\"", intent: "specialist" },
  { text: "site:reddit.com/r/Forex \"which broker\"", intent: "intent" },
  { text: "site:reddit.com/r/Forex \"recommend broker\"", intent: "intent" },
  { text: "site:forexfactory.com/thread \"which broker\"", intent: "forum" },
  { text: "site:forums.babypips.com \"recommend broker\"", intent: "forum" },
  { text: "\"forex expo\" \"exhibitors\" {region}", intent: "ecosystem" },
  { text: "\"trading expo\" \"speakers\" {region}", intent: "ecosystem" },
  { text: "\"money expo\" \"forex\" \"exhibitors\" {region}", intent: "ecosystem" },
  { text: "\"forex academy\" \"partner\" \"whatsapp\" {region}", intent: "partner" },
  { text: "\"trading community\" \"broker partnership\" {region}", intent: "partner" },
  { text: "\"PAMM manager\" \"forex\" \"contact\" {region}", intent: "specialist" },
  { text: "\"MAM account manager\" \"forex\" {region}", intent: "specialist" },
  { text: "\"copy trading provider\" \"forex\" {region}", intent: "specialist" },
  { text: "site:linkedin.com/in \"affiliate manager\" \"forex\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"business development\" \"forex broker\"", intent: "recruitment" },
  { text: "site:linkedin.com/in \"country manager\" \"forex\"", intent: "recruitment" },
  { text: "site:mql5.com/en/users \"forex\" \"signals\"", intent: "specialist" },
  { text: "site:mql5.com/en/signals \"XAUUSD\"", intent: "specialist" }
];

function isYouTubeTemplate(template = "") {
  return /youtube\.com|youtu\.be|\byoutube\b/i.test(String(template));
}

function addAllowedTemplate(target, template, intent, settings) {
  if (settings.includeYouTube !== true && isYouTubeTemplate(template)) return;
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

  queries.push(...HIGH_VALUE_QUERY_PACKS.filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text)).map((query, index) => materializeQuery(query, profile, index)));
  const seen = new Set();
  const deduped = queries.filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text)).filter((query) => {
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
  return /linkedin\.com\/in|linkedin\.com\/company|instagram\.com\/[^/]+|x\.com\/[^/]+|twitter\.com\/[^/]+|t\.me\/[^/]+|discord\.gg\/[^/]+|myfxbook\.com|mql5\.com|tradingview\.com|forexfactory\.com|babypips\.com|forex|xauusd|copy trading|signals|introducing broker|affiliate|partnership|fund manager|portfolio manager|trading academy|forex academy|mentor/.test(text);
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
    const bucket = query.channel || sourceBucket(query);
    if (!sourceStats[bucket]) sourceStats[bucket] = makeSourceStats();
    return sourceStats[bucket];
  };

  onProgress({ runId, status: "running", message: `Starting scan with ${queries.length} balanced queries`, startedAt, totalQueries: queries.length, completedQueries: 0, leadsFound: 0, sourceStats });

  let completedQueries = 0;

  for (const query of queries) {
    const stats = statFor(query);
    stats.searches += 1;
    onProgress({ runId, status: "running", message: `Searching [${query.channel}]: ${query.text}`, currentQuery: query.text, completedQueries, totalQueries: queries.length, leadsFound: leads.length, sourceStats });

    const { results, errors: searchErrors } = await searchOne(query.text, query.intent, settings.limitPerQuery);
    stats.raw += results.length;
    if (searchErrors.length) stats.errors += searchErrors.length;
    errors.push(...searchErrors.map((message) => ({ query: query.text, channel: query.channel, message })));

    for (const result of results) {
      const key = result.url.replace(/\/$/, "").toLowerCase();
      if (seenResults.has(key)) {
        stats.duplicates += 1;
        continue;
      }
      seenResults.set(key, result);

      const enriched = settings.deepEnrich
        ? await deepEnrichResult(result, { searchContacts: settings.searchContacts !== false, maxContactPages: settings.maxContactPages || 5, maxExternalWebsites: settings.maxExternalWebsites || 3, maxTrailQueries: settings.maxTrailQueries || 10, trailLimit: settings.trailLimit || 5 })
        : settings.fetchPages
          ? await enrichResult(result)
          : result;
      const classified = classifyResult({ ...enriched, id: enriched.id || idForLead(enriched.url, enriched.title), sourceBucket: query.channel }, query.intent);

      const lacksActionPath = classified.segment === "Unclear" && !(classified.emails || []).length && !(classified.socialLinks || []).length && classified.source !== "youtube";
      const genericNonPerson = classified.source !== "youtube" && /metatrader|login|download|review|spreads|how to open an account|trading platform|trusted global partner|ishares|marketwatch|etf|msci|quality factor|definition|pronunciation|usage notes|dictionary|oxfordlearnersdictionaries|merriam-webster|cambridge dictionary|collins dictionary|vocabulary\.com|thesaurus/i.test(`${classified.title} ${classified.snippet} ${classified.url}`);
      const hardRejected = isHardRejectedLead(classified);
      const lowScore = (classified.score || 0) < 28;
      const brokerSite = classified.segment === "Broker Site";
      const canSaveResearch = !brokerSite && !genericNonPerson && !hardRejected && valuableSource(classified, query);

      if (brokerSite || genericNonPerson || hardRejected || (lowScore && !canSaveResearch) || (lacksActionPath && !canSaveResearch)) {
        stats.discarded += 1;
        if (lowScore) bumpReason(stats, "low_score");
        if (brokerSite) bumpReason(stats, "broker_site");
        if (lacksActionPath) bumpReason(stats, "no_action_path");
        if (genericNonPerson) bumpReason(stats, "generic_non_person");
        if (hardRejected) bumpReason(stats, "hard_rejected");
        onProgress({ runId, status: "running", message: `Discarded low-fit result: ${classified.name}`, currentQuery: query.text, completedQueries, totalQueries: queries.length, leadsFound: leads.length, sourceStats });
        continue;
      }

      const finalLead = lowScore || lacksActionPath ? makeSavedCandidate(classified, query, lowScore ? "Low score but strong source/query signal" : "No contact yet, queued for enrichment") : makeSavedCandidate(classified, query, "Qualified by source/query signal");
      if (lowScore || lacksActionPath) stats.saved += 1;
      stats.qualified += 1;
      leads.push(finalLead);
      if (incremental) {
        const storedLead = await upsertLeads([finalLead], runId);
        persisted.created.push(...storedLead.created);
        persisted.updated.push(...storedLead.updated);
        if (exportEvery > 0 && leads.length % exportEvery === 0) await exportLeads();
      }
      onProgress({
        runId,
        status: "running",
        message: `Saved ${finalLead.priority}-lead: ${finalLead.name}`,
        currentQuery: query.text,
        completedQueries,
        totalQueries: queries.length,
        leadsFound: leads.length,
        sourceStats,
        latestLead: { id: finalLead.id, name: finalLead.name, score: finalLead.score, priority: finalLead.priority, leadType: finalLead.leadType, platform: finalLead.platform, sourceBucket: query.channel }
      });
      await sleep(250);
    }

    completedQueries += 1;
    await sleep(650);
  }

  const stored = incremental ? persisted : await upsertLeads(leads, runId);
  if (incremental) await exportLeads();
  const finishedAt = nowIso();
  const run = { id: runId, startedAt, finishedAt, settings, totalQueries: queries.length, rawResults: seenResults.size, leadsFound: leads.length, created: stored.created.length, updated: stored.updated.length, sourceStats, qualifiedBySource: countBySource(leads), errors };
  await addRun(run);

  onProgress({ runId, status: "completed", message: `Scan complete: ${stored.created.length} new, ${stored.updated.length} updated`, completedQueries, totalQueries: queries.length, leadsFound: leads.length, created: stored.created.length, updated: stored.updated.length, sourceStats, finishedAt });
  return run;
}

export { buildQueries };
