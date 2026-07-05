import fs from "node:fs/promises";
import path from "node:path";
import { pruneRejectedLeads } from "./lead-pruner.js";
import { getRootDir } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "lead-cleaner-status.json");
const stopPath = path.join(dataDir, "lead-cleaner-stop");

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

const intervalMs = Math.max(15000, numberArg("intervalMs", 45000));
const limit = Math.max(1, numberArg("limit", 1000));

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

await fs.rm(stopPath, { force: true }).catch(() => {});
await writeStatus({ status: "running", phase: "started", intervalMs, limit, totalRemoved: 0 });

let cycle = 0;
let totalRemoved = 0;
let errors = 0;
let lastRun = null;

while (!(await stopRequested())) {
  cycle += 1;
  try {
    const result = await pruneRejectedLeads({ reason: "lead-cleaner", limit });
    totalRemoved += Number(result.removed || 0);
    lastRun = result;
    await writeStatus({ status: "running", phase: "waiting", cycle, intervalMs, limit, totalRemoved, errors, lastRun });
    if (result.removed) console.log(`[lead-cleaner] ${nowIso()} removed=${result.removed} totalRemoved=${totalRemoved}`);
  } catch (error) {
    errors += 1;
    lastRun = { ok: false, error: error.stack || error.message };
    console.error(`[lead-cleaner] ${nowIso()} ${error.stack || error.message}`);
    await writeStatus({ status: "error", cycle, intervalMs, limit, totalRemoved, errors, lastRun });
  }
  await sleep(intervalMs);
}

await writeStatus({ status: "stopped", cycle, intervalMs, limit, totalRemoved, errors, lastRun });
