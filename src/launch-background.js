import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureBackgroundTasks } from "./process-manager.js";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

function launch(name, args) {
  const out = fs.openSync(path.join(dataDir, `${name}.out.log`), "a");
  const err = fs.openSync(path.join(dataDir, `${name}.err.log`), "a");
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true
  });
  child.unref();
  fs.writeFileSync(path.join(dataDir, `${name}-pid.txt`), `${child.pid}\n`, "utf8");
  return child.pid;
}

const serverPid = launch("server", ["src/server.js"]);
const managed = await ensureBackgroundTasks([
  "source-harvester",
  "source-harvester-social",
  "source-harvester-specialist",
  "source-harvester-ecosystem",
  "enrichment-worker",
  "qualified-exporter",
  "supervisor"
]);

console.log(`serverPid=${serverPid}`);
for (const task of managed) {
  console.log(`${task.name}=${task.pid} (${task.status})`);
}
