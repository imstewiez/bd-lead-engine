import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const HARVESTER_STALE_MS = 15 * 60 * 1000;

function harvesterArgs(name, extra = []) {
  return ["src/source-harvester.js", `--workerName=${name}`, ...extra];
}

export const BACKGROUND_TASKS = {
  "source-harvester": {
    args: harvesterArgs("source-harvester", ["--onlyIntents=partner,intent", "--maxQueries=140", "--limitPerQuery=10", "--delayMs=6000", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=6", "--maxTrailQueries=24", "--trailLimit=8", "--exportEvery=3"])
  },
  "source-harvester-social": {
    args: harvesterArgs("source-harvester-social", ["--onlyIntents=social", "--queryOffsetBase=3000", "--maxQueries=150", "--limitPerQuery=10", "--delayMs=5500", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=7", "--maxExternalWebsites=6", "--maxTrailQueries=24", "--trailLimit=8", "--exportEvery=3"])
  },
  "source-harvester-specialist": {
    args: harvesterArgs("source-harvester-specialist", ["--onlyIntents=specialist,forum", "--queryOffsetBase=6000", "--maxQueries=140", "--limitPerQuery=10", "--delayMs=6000", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=6", "--maxTrailQueries=24", "--trailLimit=8", "--exportEvery=3"])
  },
  "source-harvester-ecosystem": {
    args: harvesterArgs("source-harvester-ecosystem", ["--onlyIntents=ecosystem,recruitment", "--queryOffsetBase=9000", "--maxQueries=110", "--limitPerQuery=8", "--delayMs=7000", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=6", "--maxTrailQueries=22", "--trailLimit=8", "--exportEvery=3"])
  },
  "source-harvester-linkedin": {
    args: harvesterArgs("source-harvester-linkedin", ["--onlyChannels=linkedin", "--queryOffsetBase=12000", "--maxQueries=240", "--limitPerQuery=15", "--delayMs=4800", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=7", "--maxTrailQueries=28", "--trailLimit=10", "--exportEvery=3"])
  },
  "source-harvester-instagram": {
    args: harvesterArgs("source-harvester-instagram", ["--onlyChannels=instagram", "--queryOffsetBase=15000", "--maxQueries=210", "--limitPerQuery=15", "--delayMs=5200", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=7", "--maxTrailQueries=28", "--trailLimit=10", "--exportEvery=3"])
  },
  "source-harvester-platforms": {
    args: harvesterArgs("source-harvester-platforms", ["--onlyChannels=myfxbook,mql5,specialist", "--queryOffsetBase=18000", "--maxQueries=180", "--limitPerQuery=10", "--delayMs=7000", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=7", "--maxTrailQueries=24", "--trailLimit=8", "--maxMql5QueryShare=0.45", "--minMql5Queries=25", "--exportEvery=3"])
  },
  "source-harvester-communities": {
    args: harvesterArgs("source-harvester-communities", ["--onlyChannels=telegram,discord,forum,x,tiktok,facebook_threads", "--queryOffsetBase=21000", "--maxQueries=220", "--limitPerQuery=12", "--delayMs=6000", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=7", "--maxExternalWebsites=6", "--maxTrailQueries=24", "--trailLimit=10", "--exportEvery=3"])
  },
  "source-harvester-events": {
    args: harvesterArgs("source-harvester-events", ["--onlyChannels=ecosystem,recruitment", "--queryOffsetBase=24000", "--maxQueries=170", "--limitPerQuery=10", "--delayMs=6500", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=8", "--maxExternalWebsites=7", "--maxTrailQueries=22", "--trailLimit=8", "--exportEvery=3"])
  },
  "enrichment-worker": {
    args: ["src/enrichment-worker.js", "--delayMs=2500", "--idleMs=6000", "--staleHours=6", "--hotStaleHours=1", "--contactlessStaleHours=1", "--rotationHours=2", "--maxAttempts=25", "--maxContactPages=8", "--maxExternalWebsites=6", "--maxTrailQueries=24", "--trailLimit=8"]
  },
  "smart-enrichment-worker": {
    args: ["src/smart-enrichment-worker.js", "--delayMs=7000", "--idleMs=15000", "--maxTrailQueries=24", "--trailLimit=10", "--maxContactPages=8"]
  },
  "lead-cleaner": {
    args: ["src/cleanup-worker.js", "--intervalMs=45000", "--limit=1000"]
  },
  "qualified-exporter": {
    args: ["src/qualified-exporter.js", "--intervalMs=45000"]
  },
  supervisor: {
    args: ["src/supervisor.js", "--intervalMs=60000"]
  }
};

export function pidPathFor(name) {
  return path.join(dataDir, `${name}-pid.txt`);
}

export function isPidRunning(pid) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readPid(name) {
  try {
    const raw = await fsp.readFile(pidPathFor(name), "utf8");
    const pid = Number(raw.trim().split(/\s+/)[0]);
    return Number.isInteger(pid) ? pid : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function statusAgeMs(name) {
  try {
    const raw = await fsp.readFile(path.join(dataDir, `${name}-status.json`), "utf8");
    const status = JSON.parse(raw);
    const updated = Date.parse(status.updatedAt || "");
    return Number.isFinite(updated) ? Date.now() - updated : Infinity;
  } catch {
    return Infinity;
  }
}

async function retireStaleHarvester(name, pid) {
  if (!name.startsWith("source-harvester")) return false;
  const age = await statusAgeMs(name);
  if (age < HARVESTER_STALE_MS) return false;
  try {
    process.kill(pid);
  } catch {}
  await fsp.rm(pidPathFor(name), { force: true }).catch(() => {});
  return true;
}

export async function launchDetachedTask(name) {
  const task = BACKGROUND_TASKS[name];
  if (!task) throw new Error(`Unknown background task: ${name}`);
  await fsp.mkdir(dataDir, { recursive: true });
  const out = fs.openSync(path.join(dataDir, `${name}.out.log`), "a");
  const err = fs.openSync(path.join(dataDir, `${name}.err.log`), "a");
  const child = spawn(process.execPath, task.args, {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true
  });
  child.unref();
  await fsp.writeFile(pidPathFor(name), `${child.pid}\n${new Date().toISOString()}\n`, "utf8");
  return { name, status: "started", pid: child.pid };
}

export async function ensureTask(name) {
  const pid = await readPid(name);
  if (pid && isPidRunning(pid)) {
    const retired = await retireStaleHarvester(name, pid);
    if (!retired) return { name, status: "running", pid };
    return launchDetachedTask(name);
  }
  return launchDetachedTask(name);
}

function normalizeTaskNames(names = Object.keys(BACKGROUND_TASKS)) {
  const requested = [...new Set(names.filter(Boolean))];
  if (!requested.includes("lead-cleaner") && requested.some((name) => ["enrichment-worker", "qualified-exporter", "supervisor", "smart-enrichment-worker"].includes(name))) {
    const index = Math.max(requested.indexOf("enrichment-worker"), 0);
    requested.splice(index + 1, 0, "lead-cleaner");
  }
  return requested;
}

export async function ensureBackgroundTasks(names = Object.keys(BACKGROUND_TASKS)) {
  const results = [];
  for (const name of normalizeTaskNames(names)) {
    results.push(await ensureTask(name));
  }
  return results;
}
