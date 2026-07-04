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
import { enrichResult, searchOne } from "./search.js";
import { idForLead, nowIso, sleep } from "./utils.js";

function isYouTubeTemplate(template = "") {
  return /youtube\.com|youtu\.be|\byoutube\b/i.test(String(template));
}

function addAllowedTemplate(target, template, intent, settings) {
  if (settings.includeYouTube !== true && isYouTubeTemplate(template)) return;
  target.push({ template, intent });
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
  if (settings.includePartners) {
    for (const template of PARTNER_QUERY_TEMPLATES) addAllowedTemplate(partnerTemplates, template, "partner", settings);
  }
  if (settings.includeRecruitment) {
    for (const template of RECRUITMENT_QUERY_TEMPLATES) addAllowedTemplate(recruitmentTemplates, template, "recruitment", settings);
  }
  if (settings.includeIntentPosts !== false) {
    for (const template of INTENT_POST_QUERY_TEMPLATES) addAllowedTemplate(intentTemplates, template, "intent", settings);
  }
  if (settings.includeEcosystem !== false) {
    for (const template of ECOSYSTEM_QUERY_TEMPLATES) addAllowedTemplate(ecosystemTemplates, template, "ecosystem", settings);
  }
  if (settings.includeSocialProfiles !== false) {
    for (const template of SOCIAL_QUERY_TEMPLATES) addAllowedTemplate(socialTemplates, template, "social", settings);
  }
  if (settings.includeForums !== false) {
    for (const template of FORUM_QUERY_TEMPLATES) addAllowedTemplate(forumTemplates, template, "forum", settings);
  }
  if (settings.includeSpecialistSources !== false) {
    for (const template of SPECIALIST_QUERY_TEMPLATES) addAllowedTemplate(specialistTemplates, template, "specialist", settings);
  }

  const queries = [];

  const families = [partnerTemplates, socialTemplates, intentTemplates, forumTemplates, specialistTemplates, ecosystemTemplates, recruitmentTemplates]
    .filter(Boolean)
    .filter((family) => family.length);
  const maxRegionCount = profile.regions.length;
  const maxTemplateCount = Math.max(...families.map((family) => family.length), 0);

  for (let templateIndex = 0; templateIndex < maxTemplateCount; templateIndex += 1) {
    for (const family of families) {
      const item = family[templateIndex % family.length];
      if (!item) continue;
      if (item.template.includes("{region}")) {
        const region = profile.regions[(templateIndex + queries.length) % maxRegionCount];
        queries.push({
          text: item.template.replace("{region}", region),
          intent: item.intent
        });
      } else {
        queries.push({ text: item.template, intent: item.intent });
      }
    }
  }

  const broadQueries = [
    { text: "\"forex\" \"introducing broker\" \"Portuguese\"", intent: "partner" },
    { text: "\"forex\" \"introducing broker\" \"Spanish\"", intent: "partner" },
    { text: "\"forex\" \"trading community\" \"English\"", intent: "partner" },
    { text: "site:instagram.com \"forex trader\" \"whatsapp\" Brazil", intent: "social" },
    { text: "site:instagram.com \"forex signals\" \"whatsapp\" LatAm", intent: "social" },
    { text: "site:x.com \"forex\" \"looking for broker\"", intent: "social" },
    { text: "site:reddit.com/r/Forex \"which broker\"", intent: "forum" },
    { text: "site:tradingview.com/u/ \"forex\" \"signals\"", intent: "forum" },
    { text: "site:myfxbook.com/members \"forex\" \"manager\"", intent: "specialist" },
    { text: "site:mql5.com/en/signals \"XAUUSD\"", intent: "specialist" },
    { text: "\"PAMM manager\" \"forex\" \"contact\"", intent: "specialist" },
    { text: "site:linkedin.com/posts \"forex\" \"broker\" \"partner\"", intent: "intent" },
    { text: "site:linkedin.com/posts \"forex\" \"looking for broker\"", intent: "intent" },
    { text: "\"procuro corretora\" \"forex\"", intent: "intent" },
    { text: "\"busco broker\" \"forex\"", intent: "intent" },
    { text: "\"recommend broker\" \"forex\"", intent: "intent" },
    { text: "\"forex expo\" \"exhibitors\"", intent: "ecosystem" },
    { text: "\"trading academy\" \"broker partnership\"", intent: "ecosystem" },
    { text: "\"asset management\" \"forex\" \"LatAm\"", intent: "ecosystem" },
    { text: "\"family office\" \"forex\"", intent: "ecosystem" },
    { text: "\"prop firm\" \"forex\" \"community\"", intent: "ecosystem" },
    { text: "site:linkedin.com/in \"forex\" \"business development\" \"broker\"", intent: "recruitment" },
    { text: "site:linkedin.com/in \"affiliate manager\" \"forex\"", intent: "recruitment" },
    { text: "site:linkedin.com/in \"introducing broker\" \"forex\"", intent: "partner" }
  ];
  queries.push(...broadQueries);

  const seen = new Set();
  const deduped = queries
    .filter((query) => settings.includeYouTube === true || !isYouTubeTemplate(query.text))
    .filter((query) => {
      const key = query.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const offset = Number(settings.queryOffset || 0);
  const rotated = offset > 0 ? [...deduped.slice(offset % deduped.length), ...deduped.slice(0, offset % deduped.length)] : deduped;
  return rotated.slice(0, Number(settings.maxQueries) || DEFAULT_SCAN.maxQueries);
}

export async function runScan(options = {}, onProgress = () => {}) {
  const settings = { ...DEFAULT_SCAN, ...options };
  const runId = `run_${Date.now()}`;
  const startedAt = nowIso();
  const queries = buildQueries(settings);
  const seenResults = new Map();
  const leads = [];
  const errors = [];
  const persisted = {
    created: [],
    updated: []
  };
  const incremental = settings.incremental !== false;
  const exportEvery = Number(settings.exportEvery || 10);

  onProgress({
    runId,
    status: "running",
    message: `Starting scan with ${queries.length} queries`,
    startedAt,
    totalQueries: queries.length,
    completedQueries: 0,
    leadsFound: 0
  });

  let completedQueries = 0;

  for (const query of queries) {
    onProgress({
      runId,
      status: "running",
      message: `Searching: ${query.text}`,
      currentQuery: query.text,
      completedQueries,
      totalQueries: queries.length,
      leadsFound: leads.length
    });

    const { results, errors: searchErrors } = await searchOne(query.text, query.intent, settings.limitPerQuery);
    errors.push(...searchErrors.map((message) => ({ query: query.text, message })));

    for (const result of results) {
      const key = result.url.replace(/\/$/, "").toLowerCase();
      if (seenResults.has(key)) continue;
      seenResults.set(key, result);

      const enriched = settings.deepEnrich
        ? await deepEnrichResult(result, {
            searchContacts: settings.searchContacts !== false,
            maxContactPages: settings.maxContactPages || 5,
            maxExternalWebsites: settings.maxExternalWebsites || 3,
            maxTrailQueries: settings.maxTrailQueries || 10,
            trailLimit: settings.trailLimit || 5
          })
        : settings.fetchPages
          ? await enrichResult(result)
          : result;
      const classified = classifyResult(
        {
          ...enriched,
          id: enriched.id || idForLead(enriched.url, enriched.title)
        },
        query.intent
      );

      const lacksActionPath =
        classified.segment === "Unclear" &&
        !(classified.emails || []).length &&
        !(classified.socialLinks || []).length &&
        classified.source !== "youtube";
      const genericNonPerson =
        classified.source !== "youtube" &&
        /metatrader|login|download|review|spreads|how to open an account|trading platform|trusted global partner|ishares|marketwatch|etf|msci|quality factor|definition|pronunciation|usage notes|dictionary|oxfordlearnersdictionaries|merriam-webster|cambridge dictionary|collins dictionary|vocabulary\.com|thesaurus/i.test(
          `${classified.title} ${classified.snippet} ${classified.url}`
        );
      const hardRejected = isHardRejectedLead(classified);
      if ((classified.score || 0) < 35 || classified.segment === "Broker Site" || lacksActionPath || genericNonPerson || hardRejected) {
        onProgress({
          runId,
          status: "running",
          message: `Discarded low-fit result: ${classified.name}`,
          currentQuery: query.text,
          completedQueries,
          totalQueries: queries.length,
          leadsFound: leads.length
        });
        continue;
      }

      leads.push(classified);
      if (incremental) {
        const storedLead = await upsertLeads([classified], runId);
        persisted.created.push(...storedLead.created);
        persisted.updated.push(...storedLead.updated);
        if (exportEvery > 0 && leads.length % exportEvery === 0) {
          await exportLeads();
        }
      }
      onProgress({
        runId,
        status: "running",
        message: `Qualified ${classified.priority}-lead: ${classified.name}`,
        currentQuery: query.text,
        completedQueries,
        totalQueries: queries.length,
        leadsFound: leads.length,
        latestLead: {
          id: classified.id,
          name: classified.name,
          score: classified.score,
          priority: classified.priority,
          leadType: classified.leadType
        }
      });
      await sleep(250);
    }

    completedQueries += 1;
    await sleep(650);
  }

  const stored = incremental ? persisted : await upsertLeads(leads, runId);
  if (incremental) {
    await exportLeads();
  }
  const finishedAt = nowIso();
  const run = {
    id: runId,
    startedAt,
    finishedAt,
    settings,
    totalQueries: queries.length,
    rawResults: seenResults.size,
    leadsFound: leads.length,
    created: stored.created.length,
    updated: stored.updated.length,
    errors
  };
  await addRun(run);

  onProgress({
    runId,
    status: "completed",
    message: `Scan complete: ${stored.created.length} new, ${stored.updated.length} updated`,
    completedQueries,
    totalQueries: queries.length,
    leadsFound: leads.length,
    created: stored.created.length,
    updated: stored.updated.length,
    finishedAt
  });

  return run;
}

export { buildQueries };
