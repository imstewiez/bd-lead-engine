import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");

export const BACKGROUND_TASKS = {
  "source-harvester": {
    args: [
      "src/source-harvester.js",
      "--maxQueries=180",
      "--limitPerQuery=12",
      "--delayMs=7000",
      "--fetchPages=true",
      "--deepEnrich=true",
      "--searchContacts=true",
      "--maxContactPages=8",
      "--maxExternalWebsites=6",
      "--maxTrailQueries=24",
      "--trailLimit=8",
      "--exportEvery=3"
    ]
  },
  "enrichment-worker": {
    args: [
      "src/enrichment-worker.js",
      "--delayMs=2500",
      "--idleMs=12000",
      "--staleHours=48",
      "--hotStaleHours=10",
      "--contactlessStaleHours=14",
      "--maxAttempts=10",
      "--maxContactPages=8",
      "--maxExternalWebsites=6",
      "--maxTrailQueries=24",
      "--trailLimit=8"
    ]
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
  if (pid && isPidRunning(pid)) return { name, status: "running", pid };
  return launchDetachedTask(name);
}

export async function ensureBackgroundTasks(names = Object.keys(BACKGROUND_TASKS)) {
  const results = [];
  for (const name of names) {
    results.push(await ensureTask(name));
  }
  return results;
}
