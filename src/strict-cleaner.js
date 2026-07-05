import fs from "node:fs/promises";
import path from "node:path";
import { exportLeads } from "./exporter.js";
import { extraCleanupReason } from "./lead-cleanup-rules.js";
import { getRootDir, readDb, writeDb } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "leads.json");
const statusPath = path.join(dataDir, "lead-cleaner-status.json");
const stopPath = path.join(dataDir, "lead-cleaner-stop");

const args = new Map(process.argv.slice(2).map((arg) => arg.split("=")).filter(([key]) => key?.startsWith("--")).map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"]));
const once = args.get("once") === "true" || !process.argv.some((arg) => arg.startsWith("--loop"));
const intervalMs = Math.max(15000, Number(args.get("intervalMs") || 45000));
const limit = Math.max(1, Number(args.get("limit") || 1000));

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

async function runStrictCleanup(reason = "strict-cleaner") {
  const db = await readDb();
  const leads = db.leads || [];
  const removed = [];
  const kept = [];

  for (const lead of leads) {
    const why = extraCleanupReason(lead);
    if (why && removed.length < limit) removed.push({ lead, reason: why });
    else kept.push(lead);
  }

  const byReason = removed.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});

  let backupPath = null;
  let exported = null;
  if (removed.length) {
    backupPath = path.join(dataDir, `leads.strict-cleanup-backup-${stamp()}.json`);
    await fs.copyFile(dbPath, backupPath).catch(() => {});
    await writeDb({
      ...db,
      leads: kept,
      cleanupHistory: [
        { at: nowIso(), reason, removed: removed.length, before: leads.length, after: kept.length, byReason, backupPath },
        ...(db.cleanupHistory || [])
      ].slice(0, 50)
    });
    exported = await exportLeads({
      csvName: "autopilot-qualified-leads.csv",
      jsonName: "autopilot-qualified-leads.json",
      contactCsvName: "autopilot-qualified-contactable-leads.csv",
      contactJsonName: "autopilot-qualified-contactable-leads.json",
      hotCsvName: "autopilot-hot-leads.csv",
      hotJsonName: "autopilot-hot-leads.json"
    });
  }

  return {
    ok: true,
    before: leads.length,
    removed: removed.length,
    after: kept.length,
    backupPath,
    byReason,
    sample: removed.slice(0, 20).map(({ lead, reason }) => ({ id: lead.id, name: lead.name, url: lead.url, reason })),
    exported
  };
}

if (once) {
  runStrictCleanup("cli")
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
} else {
  await fs.rm(stopPath, { force: true }).catch(() => {});
  let totalRemoved = 0;
  let cycle = 0;
  while (!(await stopRequested())) {
    cycle += 1;
    const result = await runStrictCleanup("worker");
    totalRemoved += result.removed;
    await writeStatus({ status: "running", cycle, intervalMs, totalRemoved, lastRun: result });
    await sleep(intervalMs);
  }
  await writeStatus({ status: "stopped", cycle, intervalMs, totalRemoved });
}
