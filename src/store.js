import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "leads.json");
const backupPath = path.join(dataDir, "leads.json.bak");
const lockPath = path.join(dataDir, "leads.lock");

const emptyDb = () => ({
  leads: [],
  runs: [],
  updatedAt: nowIso()
});

export function getRootDir() {
  return rootDir;
}

export function getDbPath() {
  return dbPath;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDb(db = {}) {
  return {
    ...db,
    leads: Array.isArray(db.leads) ? db.leads : [],
    runs: Array.isArray(db.runs) ? db.runs : [],
    updatedAt: db.updatedAt || nowIso()
  };
}

async function parseDbFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  if (!raw.trim()) {
    const error = new SyntaxError(`${path.basename(filePath)} is empty`);
    error.code = "EMPTY_JSON";
    throw error;
  }
  return normalizeDb(JSON.parse(raw));
}

async function quarantineBadDb(error) {
  const stamp = nowIso().replace(/[:.]/g, "-");
  const corruptPath = path.join(dataDir, `leads.corrupt.${stamp}.json`);
  await fs.copyFile(dbPath, corruptPath).catch(() => {});
  await fs.appendFile(
    path.join(dataDir, "store-recovery.log"),
    `${nowIso()} recovered leads.json after ${error.name || "Error"}: ${error.message || error}\n`,
    "utf8"
  ).catch(() => {});
  return corruptPath;
}

export async function readDb() {
  await fs.mkdir(dataDir, { recursive: true });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await parseDbFile(dbPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        const db = emptyDb();
        await writeDb(db);
        return db;
      }

      const transient = error instanceof SyntaxError || error.code === "EMPTY_JSON" || ["EBUSY", "EPERM", "EACCES"].includes(error.code);
      if (!transient || attempt === 8) {
        try {
          const backupDb = await parseDbFile(backupPath);
          await quarantineBadDb(error);
          await writeDb(backupDb);
          return backupDb;
        } catch {
          await quarantineBadDb(error);
          const db = emptyDb();
          await writeDb(db);
          return db;
        }
      }

      await sleep(60 * attempt + Math.floor(Math.random() * 120));
    }
  }

  return emptyDb();
}

async function withDbLock(fn) {
  await fs.mkdir(dataDir, { recursive: true });
  const started = Date.now();
  while (true) {
    let handle = null;
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${nowIso()}\n`, "utf8");
      return await fn();
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 30000) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
      }
      await sleep(80 + Math.floor(Math.random() * 120));
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
        await fs.rm(lockPath, { force: true }).catch(() => {});
      }
    }
  }
}

async function renameWithRetry(tempPath, finalPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await fs.rename(tempPath, finalPath);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      await sleep(80 * attempt + Math.floor(Math.random() * 120));
    }
  }

  try {
    await fs.copyFile(tempPath, finalPath);
    await fs.rm(tempPath, { force: true });
    return;
  } catch (fallbackError) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    fallbackError.message = `${fallbackError.message}; rename retry failed after ${lastError?.code || "unknown"}: ${lastError?.message || ""}`;
    throw fallbackError;
  }
}

export async function writeDb(db) {
  await fs.mkdir(dataDir, { recursive: true });
  db.updatedAt = nowIso();
  const serialized = `${JSON.stringify(normalizeDb(db), null, 2)}\n`;
  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, serialized, "utf8");
  await renameWithRetry(tempPath, dbPath);
  await fs.writeFile(backupPath, serialized, "utf8").catch(() => {});
}

export async function upsertLeads(incoming, runId) {
  return withDbLock(async () => {
    const db = await readDb();
    const existingById = new Map(db.leads.map((lead) => [lead.id, lead]));
    const created = [];
    const updated = [];

    for (const lead of incoming) {
      const current = existingById.get(lead.id);
      if (!current) {
        const next = {
          ...lead,
          stage: lead.stage || "new",
          notes: "",
          runIds: runId ? [runId] : [],
          firstSeen: lead.firstSeen || nowIso(),
          lastSeen: nowIso()
        };
        db.leads.push(next);
        existingById.set(next.id, next);
        created.push(next);
        continue;
      }

      const next = {
        ...current,
        ...lead,
        stage: current.stage || lead.stage || "new",
        notes: current.notes || "",
        runIds: [...new Set([...(current.runIds || []), runId].filter(Boolean))],
        firstSeen: current.firstSeen || lead.firstSeen || nowIso(),
        lastSeen: nowIso()
      };
      const index = db.leads.findIndex((item) => item.id === lead.id);
      db.leads[index] = next;
      existingById.set(next.id, next);
      updated.push(next);
    }

    await writeDb(db);
    return { created, updated, total: db.leads.length };
  });
}

export async function addRun(run) {
  return withDbLock(async () => {
    const db = await readDb();
    db.runs.unshift(run);
    db.runs = db.runs.slice(0, 50);
    await writeDb(db);
  });
}

export async function updateLead(id, patch) {
  return withDbLock(async () => {
    const db = await readDb();
    const index = db.leads.findIndex((lead) => lead.id === id);
    if (index === -1) return null;
    db.leads[index] = {
      ...db.leads[index],
      ...patch,
      updatedAt: nowIso()
    };
    await writeDb(db);
    return db.leads[index];
  });
}

export async function listLeads(filters = {}) {
  const db = await readDb();
  let leads = [...db.leads];
  const q = String(filters.q || "").trim().toLowerCase();
  if (q) {
    leads = leads.filter((lead) =>
      [
        lead.name,
        lead.title,
        lead.snippet,
        lead.url,
        lead.domain,
        lead.country,
        lead.leadType,
        lead.segment,
        ...(lead.languages || []),
        ...(lead.evidence || [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  if (filters.priority) leads = leads.filter((lead) => lead.priority === filters.priority);
  if (filters.leadType) leads = leads.filter((lead) => lead.leadType === filters.leadType);
  if (filters.stage) leads = leads.filter((lead) => lead.stage === filters.stage);
  if (filters.segment) leads = leads.filter((lead) => lead.segment === filters.segment);

  leads.sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.lastSeen).localeCompare(String(a.lastSeen)));
  return leads;
}
