import fs from "node:fs/promises";
import path from "node:path";
import { cleanEmails, cleanForms, hasDirectOutboundPath } from "./contact-cleaner.js";
import { getRootDir, readDb } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function fmt(date) {
  return date ? date.toLocaleString() : "—";
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function hoursAgo(hours) {
  return new Date(Date.now() - Number(hours || 12) * 60 * 60 * 1000);
}

function windowStart() {
  const arg = process.argv.find((item) => item.startsWith("--since="));
  if (arg) {
    const value = arg.slice("--since=".length);
    const parsed = parseDate(value);
    if (parsed) return parsed;
  }
  const hoursArg = process.argv.find((item) => item.startsWith("--hours="));
  if (hoursArg) return hoursAgo(Number(hoursArg.slice("--hours=".length)) || 12);
  return startOfToday();
}

function leadTouchedAt(lead = {}) {
  const dates = [lead.lastSeen, lead.updatedAt, lead.enrichedAt, lead.firstSeen, lead.createdAt]
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => b - a);
  return dates[0] || null;
}

function leadCreatedAt(lead = {}) {
  return parseDate(lead.firstSeen) || parseDate(lead.createdAt) || null;
}

function isContactable(lead = {}) {
  return cleanEmails(lead.emails || []).length > 0 || cleanForms(lead.forms || []).length > 0 || hasDirectOutboundPath(lead);
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item) || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topEntries(obj = {}, limit = 8) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, file), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const since = windowStart();
  const db = await readDb();
  const leads = db.leads || [];
  const runs = db.runs || [];
  const touched = leads.filter((lead) => {
    const date = leadTouchedAt(lead);
    return date && date >= since;
  });
  const created = leads.filter((lead) => {
    const date = leadCreatedAt(lead);
    return date && date >= since;
  });
  const enriched = touched.filter((lead) => isContactable(lead) || Number(lead.contactConfidence || 0) > 0 || (lead.forms || []).length || (lead.websiteLinks || []).length || (lead.contactLinks || []).length || (lead.socialLinks || []).length);
  const recentRuns = runs.filter((run) => [run.startedAt, run.finishedAt].map(parseDate).some((date) => date && date >= since));
  const status = await readJsonIfExists("autopilot-status.json");

  const newestLead = leads.map((lead) => ({ lead, date: leadTouchedAt(lead) })).filter((item) => item.date).sort((a, b) => b.date - a.date)[0];
  const newestRun = runs.map((run) => ({ run, date: parseDate(run.finishedAt) || parseDate(run.startedAt) })).filter((item) => item.date).sort((a, b) => b.date - a.date)[0];

  console.log("\nAVENIQ Activity Report");
  console.log("======================");
  console.log(`Janela analisada: ${fmt(since)} -> ${fmt(new Date())}`);
  console.log(`Total ativo na BD: ${leads.length}`);
  console.log(`Leads novas na janela: ${created.length}`);
  console.log(`Leads tocadas/atualizadas na janela: ${touched.length}`);
  console.log(`Leads com sinais de enrichment na janela: ${enriched.length}`);
  console.log(`Runs registados na janela: ${recentRuns.length}`);
  console.log(`Última lead tocada: ${newestLead ? `${fmt(newestLead.date)} · ${newestLead.lead.companyName || newestLead.lead.name || newestLead.lead.title || newestLead.lead.url}` : "—"}`);
  console.log(`Último run: ${newestRun ? `${fmt(newestRun.date)} · ${newestRun.run.created || 0} criadas / ${newestRun.run.updated || 0} atualizadas / ${newestRun.run.leadsFound || 0} qualificadas` : "—"}`);

  if (status) {
    console.log("\nAutopilot status:");
    console.log(JSON.stringify(status, null, 2));
  }

  if (recentRuns.length) {
    console.log("\nRuns recentes:");
    for (const run of recentRuns.slice(0, 8)) {
      console.log(`- ${fmt(parseDate(run.startedAt))} -> ${fmt(parseDate(run.finishedAt))} | raw ${run.rawResults || 0} | found ${run.leadsFound || 0} | created ${run.created || 0} | updated ${run.updated || 0} | errors ${(run.errors || []).length}`);
    }
  }

  if (touched.length) {
    console.log("\nTop fontes tocadas:");
    for (const [source, count] of topEntries(countBy(touched, (lead) => lead.platform || lead.sourceBucket || lead.domain))) console.log(`- ${source}: ${count}`);

    console.log("\nTop tipos/segmentos tocados:");
    for (const [segment, count] of topEntries(countBy(touched, (lead) => lead.segment || lead.entityType || lead.leadType))) console.log(`- ${segment}: ${count}`);

    console.log("\nÚltimas 15 leads tocadas:");
    for (const { lead, date } of touched.map((lead) => ({ lead, date: leadTouchedAt(lead) })).sort((a, b) => b.date - a.date).slice(0, 15)) {
      console.log(`- ${fmt(date)} | ${lead.commercialScore || lead.score || 0} | ${lead.platform || lead.sourceBucket || "?"} | ${lead.companyName || lead.name || lead.title || lead.url}`);
    }
  }

  if (!touched.length && !recentRuns.length) {
    console.log("\nResultado: não há sinais fortes de que tenha criado/atualizado leads nesta janela.");
    console.log("Confirma se o host ficou ligado, se o Node continuou ativo e se AUTO_START_SOURCING não está false.");
  } else {
    console.log("\nResultado: há sinais de atividade durante a janela analisada.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
