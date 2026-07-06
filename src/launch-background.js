import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { BACKGROUND_TASKS, ensureBackgroundTasks } from "./process-manager.js";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

const PROFILE_TASKS = {
  light: ["source-harvester", "enrichment-worker", "qualified-exporter", "supervisor"],
  balanced: ["source-harvester", "source-harvester-social", "source-harvester-platforms", "enrichment-worker", "smart-enrichment-worker", "lead-cleaner", "qualified-exporter", "supervisor"],
  full: Object.keys(BACKGROUND_TASKS)
};

function workerSelection() {
  const requested = String(process.env.ENGINE_BACKGROUND_PROFILE || "balanced").trim().toLowerCase();
  const profile = PROFILE_TASKS[requested] ? requested : "balanced";
  return { profile, tasks: PROFILE_TASKS[profile] };
}

function launchServer() {
  const out = fs.openSync(path.join(dataDir, "server.out.log"), "a");
  const err = fs.openSync(path.join(dataDir, "server.err.log"), "a");
  const child = spawn(process.execPath, ["src/server.js"], { cwd: rootDir, detached: true, stdio: ["ignore", out, err], windowsHide: true });
  child.unref();
  fs.writeFileSync(path.join(dataDir, "server-pid.txt"), `${child.pid}\n${new Date().toISOString()}\n`, "utf8");
  return child.pid;
}

const serverPid = launchServer();
const { profile, tasks } = workerSelection();
console.log(`server=${serverPid} (started)`);
console.log(`background_profile=${profile} tasks=${tasks.join(",")}`);
const results = await ensureBackgroundTasks(tasks);
for (const task of results) console.log(`${task.name}=${task.pid} (${task.status})`);
