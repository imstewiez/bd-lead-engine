import "./env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getRootDir } from "./store.js";
import { nowIso, sleep } from "./utils.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const statusPath = path.join(dataDir, "engine-control-status.json");
const logPath = path.join(dataDir, "engine-control.log");
const args = new Set(process.argv.slice(2));

function run(command, commandArgs = [], options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: rootDir, encoding: "utf8", shell: false, ...options });
  return { command: [command, ...commandArgs].join(" "), status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

async function log(message) {
  await fs.mkdir(dataDir, { recursive: true });
  const line = `${nowIso()} ${message}\n`;
  await fs.appendFile(logPath, line, "utf8");
  console.log(message);
}

async function writeStatus(status) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify({ ...status, updatedAt: nowIso() }, null, 2)}\n`, "utf8");
}

function killPid(pid) {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed === process.pid) return { pid, skipped: true };
  try {
    process.kill(parsed);
  } catch {}
  const force = process.platform === "win32" ? run("taskkill", ["/PID", String(parsed), "/F"]) : run("kill", ["-9", String(parsed)]);
  return { pid: parsed, forceStatus: force.status, stderr: force.stderr.trim(), stdout: force.stdout.trim() };
}

async function pidFiles() {
  const files = await fs.readdir(dataDir).catch(() => []);
  return files.filter((file) => file.endsWith("-pid.txt"));
}

async function stopPidFile(file) {
  const full = path.join(dataDir, file);
  let pid = null;
  try {
    const raw = await fs.readFile(full, "utf8");
    pid = Number(raw.trim().split(/\s+/)[0]);
  } catch {}
  const result = killPid(pid);
  await fs.rm(full, { force: true }).catch(() => {});
  return { file, ...result };
}

function killPort8787() {
  if (process.platform !== "win32") return [];
  const netstat = run("cmd", ["/c", "netstat -ano | findstr :8787"]);
  const pids = new Set();
  for (const line of `${netstat.stdout}\n${netstat.stderr}`.split(/\r?\n/)) {
    const match = line.trim().match(/\s(\d+)$/);
    if (match) pids.add(Number(match[1]));
  }
  return [...pids].filter((pid) => pid && pid !== process.pid).map(killPid);
}

async function clearStopFiles() {
  const files = await fs.readdir(dataDir).catch(() => []);
  const removed = [];
  for (const file of files.filter((item) => item.endsWith("-stop"))) {
    await fs.rm(path.join(dataDir, file), { force: true }).catch(() => {});
    removed.push(file);
  }
  return removed;
}

async function stopEngine() {
  await log("[engine] stopping existing managed processes");
  const files = await pidFiles();
  const killed = [];
  for (const file of files) killed.push(await stopPidFile(file));
  const portKills = killPort8787();
  const stopFiles = await clearStopFiles();
  await sleep(1000);
  return { killed, portKills, stopFiles };
}

async function sanitizeContacts() {
  await log("[engine] sanitizing platform contacts");
  return run(process.execPath, ["src/contact-sanitizer.js"], { stdio: "inherit" });
}

async function startEngine() {
  await log("[engine] starting background tasks");
  const result = run(process.execPath, ["src/launch-background.js"], { stdio: "inherit" });
  await sleep(3500);
  return result;
}

async function pullLatest() {
  if (args.has("--no-pull")) return { skipped: true };
  await log("[engine] pulling latest main");
  const result = run("git", ["pull", "origin", "main"], { stdio: "inherit" });
  return result;
}

async function cloudSnapshot() {
  await log("[engine] writing cloud snapshot");
  return run(process.execPath, ["src/cloud-logger.js", "--once"], { stdio: "inherit" });
}

async function printReport() {
  await log("[engine] printing unified report");
  return run(process.execPath, ["src/system-report.js"], { stdio: "inherit" });
}

const startedAt = nowIso();
await writeStatus({ status: "running", phase: "started", startedAt });
const pull = await pullLatest();
const stop = await stopEngine();
const sanitize = await sanitizeContacts();
const start = await startEngine();
const cloud = await cloudSnapshot();
const report = await printReport();
await writeStatus({ status: "done", phase: "done", startedAt, finishedAt: nowIso(), pull, stop, sanitize, start, cloud, report });
await log("[engine] ready");
