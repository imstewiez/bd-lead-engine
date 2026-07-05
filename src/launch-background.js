import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { BACKGROUND_TASKS, ensureBackgroundTasks } from "./process-manager.js";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

function launchServer() {
  const out = fs.openSync(path.join(dataDir, "server.out.log"), "a");
  const err = fs.openSync(path.join(dataDir, "server.err.log"), "a");
  const child = spawn(process.execPath, ["src/server.js"], { cwd: rootDir, detached: true, stdio: ["ignore", out, err], windowsHide: true });
  child.unref();
  fs.writeFileSync(path.join(dataDir, "server-pid.txt"), `${child.pid}\n${new Date().toISOString()}\n`, "utf8");
  return child.pid;
}

const serverPid = launchServer();
console.log(`server=${serverPid} (started)`);
const results = await ensureBackgroundTasks(Object.keys(BACKGROUND_TASKS));
for (const task of results) console.log(`${task.name}=${task.pid} (${task.status})`);
