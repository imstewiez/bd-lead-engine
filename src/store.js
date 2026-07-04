import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowIso } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "leads.json");
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

export async function readDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const db = emptyDb();
    await writeDb(db);
    return db;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function writeDb(db) {
  await fs.mkdir(dataDir, { recursive: true });
  db.updatedAt = nowIso();
  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, dbPath);
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
