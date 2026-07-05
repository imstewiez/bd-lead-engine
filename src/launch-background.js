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

function launchFocusedHarvester(name, channelArg, offset, maxQueries = 180, limitPerQuery = 12, delayMs = 6000) {
  return launch(name, [
    "src/source-harvester.js",
    `--workerName=${name}`,
    `--onlyChannels=${channelArg}`,
    `--queryOffsetBase=${offset}`,
    `--maxQueries=${maxQueries}`,
    `--limitPerQuery=${limitPerQuery}`,
    `--delayMs=${delayMs}`,
    "--fetchPages=true",
    "--deepEnrich=true",
    "--searchContacts=true",
    "--maxContactPages=8",
    "--maxExternalWebsites=7",
    "--maxTrailQueries=28",
    "--trailLimit=10",
    "--exportEvery=3"
  ]);
}

const serverPid = launch("server", ["src/server.js"]);
const focused = [
  ["source-harvester-linkedin", launchFocusedHarvester("source-harvester-linkedin", "linkedin", 12000, 240, 15, 4800)],
  ["source-harvester-instagram", launchFocusedHarvester("source-harvester-instagram", "instagram", 15000, 210, 15, 5200)],
  ["source-harvester-platforms", launchFocusedHarvester("source-harvester-platforms", "myfxbook,mql5,specialist", 18000, 260, 15, 5200)],
  ["source-harvester-communities", launchFocusedHarvester("source-harvester-communities", "telegram,discord,forum,x,tiktok,facebook_threads", 21000, 240, 12, 5500)],
  ["source-harvester-events", launchFocusedHarvester("source-harvester-events", "ecosystem,recruitment", 24000, 190, 12, 6200)]
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
