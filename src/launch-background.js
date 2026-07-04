import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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
const sourceHarvesterPid = launch("source-harvester", [
  "src/source-harvester.js",
  "--concurrency=1",
  "--batchSize=80",
  "--limitPerQuery=8",
  "--delayMs=12000",
  "--fetchPages=true",
  "--deepPerLead=true",
  "--storePerLead=true",
  "--maxContactPages=5",
  "--maxExternalWebsites=3",
  "--maxTrailQueries=12",
  "--trailLimit=5",
  "--exportEveryCycle=true",
  "--minScore=38"
]);
const enrichmentWorkerPid = launch("enrichment-worker", [
  "src/enrichment-worker.js",
  "--delayMs=2500",
  "--idleMs=30000",
  "--staleHours=72",
  "--maxContactPages=6",
  "--maxExternalWebsites=4",
  "--maxTrailQueries=14",
  "--trailLimit=6"
]);
const qualifiedExporterPid = launch("qualified-exporter", [
  "src/qualified-exporter.js",
  "--intervalMs=45000"
]);

console.log(`serverPid=${serverPid}`);
console.log(`sourceHarvesterPid=${sourceHarvesterPid}`);
console.log(`enrichmentWorkerPid=${enrichmentWorkerPid}`);
console.log(`qualifiedExporterPid=${qualifiedExporterPid}`);
