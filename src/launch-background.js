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

function launchFocusedHarvester(name, channelArg, offset, maxQueries = 180) {
  return launch(name, [
    "src/source-harvester.js",
    `--workerName=${name}`,
    `--onlyChannels=${channelArg}`,
    `--queryOffsetBase=${offset}`,
    `--maxQueries=${maxQueries}`,
    "--limitPerQuery=12",
    "--delayMs=6500",
    "--fetchPages=true",
    "--deepEnrich=true",
    "--exportEvery=3"
  ]);
}

const serverPid = launch("server", ["src/server.js"]);
const focused = [
  ["source-harvester-linkedin", launchFocusedHarvester("source-harvester-linkedin", "linkedin", 12000, 220)],
  ["source-harvester-platforms", launchFocusedHarvester("source-harvester-platforms", "myfxbook,mql5,specialist", 15000, 220)],
  ["source-harvester-registries", launchFocusedHarvester("source-harvester-registries", "ecosystem,recruitment", 18000, 160)]
];

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
for (const [name, pid] of focused) {
  console.log(`${name}=${pid} (started)`);
}
for (const task of managed) {
  console.log(`${task.name}=${task.pid} (${task.status})`);
}
