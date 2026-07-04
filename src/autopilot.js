import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SCAN } from "./config.js";
import { runScan } from "./engine.js";
import { exportLeads } from "./exporter.js";
import { getRootDir } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "autopilot-status.json");
const logPath = path.join(dataDir, "autopilot.log");
const stopPath = path.join(dataDir, "autopilot-stop");

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.split("="))
    .filter(([key]) => key?.startsWith("--"))
    .map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"])
);

const options = {
  regionSet: args.get("region") || args.get("regionSet") || "global",
  maxQueries: Number(args.get("maxQueries") || 72),
  limitPerQuery: Number(args.get("limitPerQuery") || 10),
  delayMs: Number(args.get("delayMs") || 10000),
  maxCycles: Number(args.get("maxCycles") || 0),
  includePartners: args.get("includePartners") !== "false",
  includeRecruitment: args.get("includeRecruitment") !== "false",
  includeIntentPosts: args.get("includeIntentPosts") !== "false",
  includeEcosystem: args.get("includeEcosystem") !== "false",
  includeSocialProfiles: args.get("includeSocialProfiles") !== "false",
  includeForums: args.get("includeForums") !== "false",
  includeSpecialistSources: args.get("includeSpecialistSources") !== "false",
  includeYouTube: args.get("includeYouTube") === "true",
  fetchPages: true,
  deepEnrich: true,
  searchContacts: true,
  maxContactPages: Number(args.get("maxContactPages") || 5),
  maxExternalWebsites: Number(args.get("maxExternalWebsites") || 3),
  maxTrailQueries: Number(args.get("maxTrailQueries") || 14),
  trailLimit: Number(args.get("trailLimit") || 5),
  exportEvery: Number(args.get("exportEvery") || 5),
  incremental: true
};

async function appendLog(message) {
  await fs.mkdir(dataDir, { recursive: true });
  const line = `${nowIso()} ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
  console.log(message);
}

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function stopRequested() {
  try {
    await fs.access(stopPath);
    return true;
  } catch {
    return false;
  }
}

async function clearStopFile() {
  try {
    await fs.rm(stopPath, { force: true });
  } catch {
    // Ignore.
  }
}

await clearStopFile();

let cycle = 0;
let totals = {
  exported: 0,
  total: 0
};

await appendLog(`[autopilot] Started with ${JSON.stringify(options)}`);
totals = await exportLeads({
  csvName: "autopilot-leads.csv",
  jsonName: "autopilot-leads.json"
});
await appendLog(
  `[autopilot] Initial export. DB total=${totals.total}; exported qualified=${totals.exported}; contactable=${totals.contactable}`
);

while (!(await stopRequested())) {
  cycle += 1;
  const cycleOptions = {
    ...DEFAULT_SCAN,
    ...options,
    queryOffset: (cycle - 1) * options.maxQueries
  };

  await writeStatus({
    status: "running",
    cycle,
    phase: "scan",
    options,
    totals,
    updatedAt: nowIso()
  });
  await appendLog(`[autopilot] Cycle ${cycle} scan started`);

  try {
    const run = await runScan(cycleOptions, (progress) => {
      if (progress.message) {
        console.log(`[cycle ${cycle}] ${progress.message}`);
      }
    });

    await writeStatus({
      status: "running",
      cycle,
      phase: "export",
      lastRun: run,
      options,
      totals,
      updatedAt: nowIso()
    });

    totals = await exportLeads({
      csvName: "autopilot-leads.csv",
      jsonName: "autopilot-leads.json"
    });
    await appendLog(
      `[autopilot] Cycle ${cycle} complete. DB total=${totals.total}; exported qualified=${totals.exported}; contactable=${totals.contactable}; csv=${totals.csvPath}`
    );

    await writeStatus({
      status: "running",
      cycle,
      phase: "waiting",
      lastRun: run,
      options,
      totals,
      updatedAt: nowIso()
    });
  } catch (error) {
    await appendLog(`[autopilot] Cycle ${cycle} failed: ${error.stack || error.message}`);
    await writeStatus({
      status: "error",
      cycle,
      phase: "error",
      error: error.message,
      options,
      totals,
      updatedAt: nowIso()
    });
  }

  if (options.maxCycles > 0 && cycle >= options.maxCycles) break;
  if (!(await stopRequested())) await sleep(options.delayMs);
}

totals = await exportLeads({
  csvName: "autopilot-leads.csv",
  jsonName: "autopilot-leads.json"
});

await writeStatus({
  status: "stopped",
  cycle,
  phase: "stopped",
  options,
  totals,
  updatedAt: nowIso()
});
await appendLog(`[autopilot] Stopped. Exported qualified=${totals.exported}; contactable=${totals.contactable}; total=${totals.total}`);
