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
    args: harvesterArgs("source-harvester", ["--onlyIntents=partner,intent", "--maxQueries=170", "--limitPerQuery=12", "--delayMs=5200", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=9", "--maxExternalWebsites=7", "--maxTrailQueries=26", "--trailLimit=10", "--exportEvery=3"])
  },
  "source-harvester-social": {
    args: harvesterArgs("source-harvester-social", ["--onlyIntents=social", "--queryOffsetBase=3000", "--maxQueries=190", "--limitPerQuery=12", "--delayMs=5000", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=9", "--maxExternalWebsites=7", "--maxTrailQueries=26", "--trailLimit=10", "--exportEvery=3"])
  },
  "source-harvester-specialist": {
    args: harvesterArgs("source-harvester-specialist", ["--onlyIntents=specialist,forum", "--queryOffsetBase=6000", "--maxQueries=170", "--limitPerQuery=12", "--delayMs=5200", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=9", "--maxExternalWebsites=7", "--maxTrailQueries=26", "--trailLimit=10", "--exportEvery=3"])
  },
  "source-harvester-ecosystem": {
    args: harvesterArgs("source-harvester-ecosystem", ["--onlyIntents=ecosystem,recruitment", "--queryOffsetBase=9000", "--maxQueries=135", "--limitPerQuery=10", "--delayMs=6200", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=9", "--maxExternalWebsites=7", "--maxTrailQueries=24", "--trailLimit=9", "--exportEvery=3"])
  },
  "source-harvester-linkedin": {
    args: harvesterArgs("source-harvester-linkedin", ["--onlyChannels=linkedin", "--queryOffsetBase=12000", "--maxQueries=260", "--limitPerQuery=18", "--delayMs=4300", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=10", "--maxExternalWebsites=8", "--maxTrailQueries=30", "--trailLimit=12", "--exportEvery=3"])
  },
  "source-harvester-instagram": {
    args: harvesterArgs("source-harvester-instagram", ["--onlyChannels=instagram", "--queryOffsetBase=15000", "--maxQueries=260", "--limitPerQuery=18", "--delayMs=4600", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=10", "--maxExternalWebsites=8", "--maxTrailQueries=30", "--trailLimit=12", "--exportEvery=3"])
  },
  "source-harvester-platforms": {
    args: harvesterArgs("source-harvester-platforms", ["--onlyChannels=myfxbook,mql5,specialist", "--queryOffsetBase=18000", "--maxQueries=220", "--limitPerQuery=12", "--delayMs=6200", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=10", "--maxExternalWebsites=8", "--maxTrailQueries=28", "--trailLimit=10", "--maxMql5QueryShare=0.45", "--minMql5Queries=30", "--exportEvery=3"])
  },
  "source-harvester-communities": {
    args: harvesterArgs("source-harvester-communities", ["--onlyChannels=telegram,discord,forum,x,tiktok,facebook_threads", "--queryOffsetBase=21000", "--maxQueries=260", "--limitPerQuery=15", "--delayMs=5200", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=9", "--maxExternalWebsites=7", "--maxTrailQueries=28", "--trailLimit=12", "--exportEvery=3"])
  },
  "source-harvester-events": {
    args: harvesterArgs("source-harvester-events", ["--onlyChannels=ecosystem,recruitment", "--queryOffsetBase=24000", "--maxQueries=190", "--limitPerQuery=12", "--delayMs=5800", "--fetchPages=true", "--deepEnrich=true", "--searchContacts=true", "--maxContactPages=9", "--maxExternalWebsites=8", "--maxTrailQueries=24", "--trailLimit=10", "--exportEvery=3"])
  },
  "enrichment-worker": {
    args: ["src/enrichment-worker.js", "--delayMs=2200", "--idleMs=5000", "--staleHours=6", "--hotStaleHours=0.75", "--contactlessStaleHours=0.75", "--rotationHours=2", "--maxAttempts=25", "--maxContactPages=10", "--maxExternalWebsites=8", "--maxTrailQueries=26", "--trailLimit=10"]
  },
  "smart-enrichment-worker": {
    args: ["src/smart-enrichment-worker.js", "--delayMs=5000", "--idleMs=12000", "--maxTrailQueries=28", "--trailLimit=12", "--maxContactPages=10"]
  },
  "contact-gap-worker": {
    args: ["src/contact-gap-worker.js", "--delayMs=4500", "--idleMs=12000", "--maxTrailQueries=30", "--trailLimit=12", "--maxContactPages=10"]
  },
  "lead-cleaner": {
    args: ["src/cleanup-worker.js", "--intervalMs=45000", "--limit=1000"]
  },
  "qualified-exporter": {
    args: ["src/qualified-exporter.js", "--intervalMs=45000"]
  },
  "cloud-logger-worker": {
    args: ["src/cloud-logger.js", "--loop=true", "--intervalMs=600000"]
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

export async function startBackgroundTask(name) {
  const task = BACKGROUND_TASKS[name];
  if (!task) return { name, status: "unknown_task", pid: null };
  await fsp.mkdir(dataDir, { recursive: true });
  const out = fs.openSync(path.join(dataDir, `${name}.out.log`), "a");
  const err = fs.openSync(path.join(dataDir, `${name}.err.log`), "a");
  const child = spawn(process.execPath, task.args, {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true,
    env: process.env
  });
  child.unref();
  await fsp.writeFile(pidPathFor(name), `${child.pid}\n${new Date().toISOString()}\n`, "utf8");
  return { name, pid: child.pid, status: "started" };
}

export async function ensureBackgroundTasks(names = Object.keys(BACKGROUND_TASKS)) {
  const results = [];
  for (const name of names) {
    const pid = await readPid(name);
    if (pid && isPidRunning(pid)) {
      const retired = await retireStaleHarvester(name, pid);
      if (!retired) {
        results.push({ name, pid, status: "running" });
        continue;
      }
    }
    results.push(await startBackgroundTask(name));
  }
  return results;
}
