import fs from "node:fs/promises";
import path from "node:path";
import { exportLeads } from "./exporter.js";
import { healthSnapshot } from "./health.js";
import { ensureBackgroundTasks } from "./process-manager.js";
import { getRootDir } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "supervisor-status.json");
const stopPath = path.join(dataDir, "supervisor-stop");

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.split("="))
    .filter(([key]) => key?.startsWith("--"))
    .map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"])
);

function numberArg(name, fallback) {
  const parsed = Number(args.get(name) || process.env[name.toUpperCase()] || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const intervalMs = Math.max(15000, numberArg("intervalMs", 60000));
const managedTasks = [
  "source-harvester",
  "source-harvester-social",
  "source-harvester-specialist",
  "source-harvester-ecosystem",
  "enrichment-worker",
  "qualified-exporter"
];

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

async function shouldRefreshExports(snapshot) {
  return Object.values(snapshot.exports || {}).some((info) => !info.exists || Number(info.ageMs || 0) > 10 * 60 * 1000);
}

async function superviseOnce(cycle) {
  const ensured = await ensureBackgroundTasks(managedTasks);
  let snapshot = await healthSnapshot();
  let exportResult = null;

  if (await shouldRefreshExports(snapshot)) {
    exportResult = await exportLeads({
      csvName: "autopilot-qualified-leads.csv",
      jsonName: "autopilot-qualified-leads.json",
      contactCsvName: "autopilot-qualified-contactable-leads.csv",
      contactJsonName: "autopilot-qualified-contactable-leads.json",
      hotCsvName: "autopilot-hot-leads.csv",
      hotJsonName: "autopilot-hot-leads.json"
    });
    snapshot = await healthSnapshot();
  }

  await writeStatus({
    status: "running",
    cycle,
    intervalMs,
    ensured,
    exportResult,
    health: {
      ok: snapshot.ok,
      counts: snapshot.counts,
      enrichmentQueue: snapshot.enrichmentQueue,
      issues: snapshot.issues.slice(0, 20)
    }
  });

  const issueText = snapshot.issues.length ? ` issues=${snapshot.issues.map((issue) => issue.code).join(",")}` : "";
  console.log(
    `[supervisor] ${nowIso()} cycle=${cycle} ok=${snapshot.ok} raw=${snapshot.counts.raw} working=${snapshot.counts.working} a=${snapshot.counts.aLeads}${issueText}`
  );
}

let cycle = 0;
await writeStatus({ status: "starting", intervalMs });

while (!(await stopRequested())) {
  cycle += 1;
  try {
    await superviseOnce(cycle);
  } catch (error) {
    console.error(`[supervisor] ${nowIso()} ${error.stack || error.message}`);
    await writeStatus({ status: "error", cycle, error: error.stack || error.message, intervalMs });
  }
  await sleep(intervalMs);
}

await writeStatus({ status: "stopped", cycle, intervalMs });
