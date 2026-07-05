import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRootDir } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const reportDir = path.join(rootDir, "ops-reports");
const statusPath = path.join(dataDir, "cloud-logger-worker-status.json");
const stopPath = path.join(dataDir, "cloud-logger-worker-stop");
const timelinePath = path.join(reportDir, "timeline.jsonl");

const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
const loop = args.get("loop") === "true";
const once = args.get("once") === "true" || !loop;
const noGit = args.get("noGit") === "true";
const intervalMs = Math.max(60000, Number(args.get("intervalMs") || 600000));

function run(command, commandArgs = [], options = {}) {
  return spawnSync(command, commandArgs, { cwd: rootDir, encoding: "utf8", shell: false, ...options });
}

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

async function stopRequested() {
  try {
    await fs.access(stopPath);
    return true;
  } catch {
    return false;
  }
}

function safeSummary(report = {}) {
  const summary = report.summary || {};
  const quality = report.quality || {};
  const smart = (report.workers || []).find((worker) => worker.name === "smart-enrichment-worker") || {};
  return {
    at: report.generatedAt || nowIso(),
    ok: report.ok,
    raw: summary.rawLeads,
    qualified: summary.qualified,
    working: summary.working,
    contactable: summary.contactable,
    salesReady: summary.salesReady,
    a1Hot: summary.a1Hot,
    a2Strong: summary.a2Strong,
    platformContactLeaks: summary.platformContactLeaks,
    highValueNoContact: summary.highValueNoContact,
    providerErrors: summary.providerErrors,
    staleWorkers: summary.staleWorkers || [],
    issues: summary.issues || [],
    smartTrail: {
      phase: smart.phase || "n/a",
      processed: smart.counts?.processed ?? null,
      stored: smart.counts?.stored ?? null,
      errors: smart.counts?.errors ?? null,
      current: smart.current?.name || "",
      last: smart.lastResult?.name || "",
      best: smart.lastResult?.bestContact || ""
    },
    salesReadyByBucket: quality.salesReadyByBucket || {},
    qualifiedByBucket: quality.qualifiedByBucket || {}
  };
}

function markdownReport(report = {}, summary = {}) {
  const lines = [];
  lines.push("# BD Lead Engine Cloud Report");
  lines.push("");
  lines.push(`Updated: ${summary.at}`);
  lines.push(`Health: ${summary.ok ? "OK" : "CHECK"}`);
  lines.push("");
  lines.push("## Funnel");
  lines.push(`Raw: ${summary.raw}`);
  lines.push(`Qualified: ${summary.qualified}`);
  lines.push(`Working: ${summary.working}`);
  lines.push(`Contactable: ${summary.contactable}`);
  lines.push(`Sales-ready: ${summary.salesReady}`);
  lines.push(`A1 Hot: ${summary.a1Hot}`);
  lines.push(`A2 Strong: ${summary.a2Strong}`);
  lines.push("");
  lines.push("## Quality");
  lines.push(`Platform contact leaks: ${summary.platformContactLeaks}`);
  lines.push(`High-value without real contact: ${summary.highValueNoContact}`);
  lines.push(`Sales-ready by bucket: ${JSON.stringify(summary.salesReadyByBucket)}`);
  lines.push(`Qualified by bucket: ${JSON.stringify(summary.qualifiedByBucket)}`);
  lines.push("");
  lines.push("## Sourcing / Workers");
  lines.push(`Provider errors: ${summary.providerErrors}`);
  lines.push(`Stale workers: ${(summary.staleWorkers || []).join(", ") || "none"}`);
  lines.push(`Issues: ${(summary.issues || []).map((issue) => `${issue.severity}:${issue.code}`).join(", ") || "none"}`);
  lines.push("");
  lines.push("## Smart Enrichment");
  lines.push(`Phase: ${summary.smartTrail.phase}`);
  lines.push(`Processed: ${summary.smartTrail.processed}`);
  lines.push(`Stored: ${summary.smartTrail.stored}`);
  lines.push(`Errors: ${summary.smartTrail.errors}`);
  if (summary.smartTrail.current) lines.push(`Current: ${summary.smartTrail.current}`);
  if (summary.smartTrail.last) lines.push(`Last: ${summary.smartTrail.last}`);
  if (summary.smartTrail.best) lines.push(`Last best contact: ${summary.smartTrail.best}`);
  lines.push("");
  lines.push("## Recent Errors");
  const logs = report.logs || {};
  let hasErrors = false;
  for (const [name, value] of Object.entries(logs)) {
    if (!value?.err?.length) continue;
    hasErrors = true;
    lines.push(`### ${name}`);
    for (const line of value.err.slice(-8)) lines.push(`- ${line}`);
  }
  if (!hasErrors) lines.push("none");
  lines.push("");
  lines.push("_Generated automatically by `src/cloud-logger.js`._");
  return `${lines.join("\n")}\n`;
}

async function appendTimeline(summary) {
  await fs.mkdir(reportDir, { recursive: true });
  let lines = [];
  try {
    lines = (await fs.readFile(timelinePath, "utf8")).split(/\r?\n/).filter(Boolean).slice(-499);
  } catch {}
  lines.push(JSON.stringify(summary));
  await fs.writeFile(timelinePath, `${lines.join("\n")}\n`, "utf8");
}

function gitCommitAndPush() {
  if (noGit) return { skipped: true, reason: "--noGit" };
  const add = run("git", ["add", "ops-reports/latest-system-report.md", "ops-reports/latest-system-report.json", "ops-reports/timeline.jsonl"]);
  if (add.status !== 0) return { ok: false, step: "add", error: add.stderr || add.stdout };
  const diff = run("git", ["diff", "--cached", "--quiet"]);
  if (diff.status === 0) return { ok: true, committed: false, pushed: false, reason: "no changes" };
  const commit = run("git", ["commit", "-m", `ops: update engine cloud report ${new Date().toISOString()}`]);
  if (commit.status !== 0) return { ok: false, step: "commit", error: commit.stderr || commit.stdout };
  const push = run("git", ["push", "origin", "main"]);
  if (push.status !== 0) return { ok: false, step: "push", error: push.stderr || push.stdout };
  return { ok: true, committed: true, pushed: true, commit: commit.stdout };
}

async function snapshot() {
  await fs.mkdir(reportDir, { recursive: true });
  const result = run(process.execPath, ["src/system-report.js", "--json"]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "system-report failed");
  const report = JSON.parse(result.stdout);
  const summary = safeSummary(report);
  await fs.writeFile(path.join(reportDir, "latest-system-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(reportDir, "latest-system-report.md"), markdownReport(report, summary), "utf8");
  await appendTimeline(summary);
  const git = gitCommitAndPush();
  await writeStatus({ status: "running", phase: "snapshot", intervalMs, summary, git });
  return { summary, git };
}

await fs.rm(stopPath, { force: true }).catch(() => {});
let cycles = 0;
let errors = 0;
await writeStatus({ status: "running", phase: "started", intervalMs, loop, once });

while (once || (loop && !(await stopRequested()))) {
  cycles += 1;
  try {
    const result = await snapshot();
    await writeStatus({ status: "running", phase: loop ? "waiting" : "done", intervalMs, cycles, errors, lastResult: result });
  } catch (error) {
    errors += 1;
    await writeStatus({ status: "running", phase: "error", intervalMs, cycles, errors, error: error.stack || error.message });
  }
  if (once) break;
  await sleep(intervalMs);
}

if (loop) await writeStatus({ status: "stopped", phase: "stopped", intervalMs, cycles, errors });
