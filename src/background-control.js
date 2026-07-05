import fs from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_TASKS, isPidRunning, pidPathFor, readPid } from "./process-manager.js";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const dataDir = path.join(rootDir, "data");
const action = String(process.argv[2] || "status").toLowerCase();
const taskNames = Object.keys(BACKGROUND_TASKS);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopPathFor(name) {
  return path.join(dataDir, `${name}-stop`);
}

async function taskStatus(name) {
  const pid = await readPid(name);
  const running = Boolean(pid && isPidRunning(pid));
  return { name, pid, running };
}

async function printStatus() {
  const statuses = [];
  for (const name of taskNames) statuses.push(await taskStatus(name));
  for (const item of statuses) {
    console.log(`${item.name}: ${item.running ? "running" : "stopped"}${item.pid ? ` pid=${item.pid}` : ""}`);
  }
  return statuses;
}

async function requestStop() {
  await fs.mkdir(dataDir, { recursive: true });
  for (const name of taskNames) {
    await fs.writeFile(stopPathFor(name), `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
  }
  console.log(`Stop requested for ${taskNames.length} background tasks.`);
}

async function killRunning() {
  const statuses = await printStatus();
  for (const item of statuses) {
    if (!item.pid || !item.running) continue;
    try {
      process.kill(item.pid);
      console.log(`Stopped ${item.name} pid=${item.pid}`);
    } catch (error) {
      console.log(`Could not stop ${item.name} pid=${item.pid}: ${error.message}`);
    }
  }

  await sleep(1000);
  for (const name of taskNames) {
    const pid = await readPid(name);
    if (pid && isPidRunning(pid)) {
      try {
        process.kill(pid, "SIGKILL");
        console.log(`Force-stopped ${name} pid=${pid}`);
      } catch (error) {
        console.log(`Could not force-stop ${name} pid=${pid}: ${error.message}`);
      }
    }
    await fs.rm(pidPathFor(name), { force: true }).catch(() => {});
  }
}

async function clearStopFiles() {
  for (const name of taskNames) {
    await fs.rm(stopPathFor(name), { force: true }).catch(() => {});
  }
}

if (action === "status") {
  await printStatus();
} else if (action === "stop") {
  await requestStop();
  await sleep(1500);
  await printStatus();
} else if (action === "kill") {
  await requestStop();
  await killRunning();
  await clearStopFiles();
  console.log("Background task pid files cleaned. Start the app again with npm start.");
} else {
  console.error(`Unknown action: ${action}. Use status, stop, or kill.`);
  process.exitCode = 1;
}
