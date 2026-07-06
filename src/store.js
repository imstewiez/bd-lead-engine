import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { nowIso } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "leads.json");
const backupPath = path.join(dataDir, "leads.json.bak");
const lockPath = path.join(dataDir, "leads.lock");

const TRANSIENT_FS_ERRORS = new Set(["EBUSY", "EPERM", "EACCES"]);
const RECOVERABLE_JSON_ERRORS = new Set(["EMPTY_JSON", "TRUNCATED_JSON"]);

const DEFAULT_LOCK_TIMEOUT_MS = Number(process.env.DB_LOCK_TIMEOUT_MS || 90_000);
const DEFAULT_LOCK_STALE_MS = Number(process.env.DB_LOCK_STALE_MS || 180_000);
const DEFAULT_RENAME_ATTEMPTS = Number(process.env.DB_RENAME_ATTEMPTS || 40);

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

function jitter(min = 25, max = 150) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isTransientFsError(error) {
  return TRANSIENT_FS_ERRORS.has(error?.code);
}

function isRecoverableJsonError(error) {
  return error instanceof SyntaxError || RECOVERABLE_JSON_ERRORS.has(error?.code);
}

function normalizeDb(db = {}) {
  return {
    ...db,
    leads: Array.isArray(db.leads) ? db.leads : [],
    runs: Array.isArray(db.runs) ? db.runs : [],
    updatedAt: db.updatedAt || nowIso()
  };
}

function createJsonParseError(filePath, raw, originalError) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    const error = new SyntaxError(`${path.basename(filePath)} is empty`);
    error.code = "EMPTY_JSON";
    return error;
  }

  const error = new SyntaxError(`${path.basename(filePath)} is not valid JSON: ${originalError.message}`);
  error.code = /unterminated|unexpected end/i.test(originalError.message) ? "TRUNCATED_JSON" : "INVALID_JSON";
  error.cause = originalError;
  error.bytes = Buffer.byteLength(raw, "utf8");
  return error;
}

async function readTextFileWithRetry(filePath, { attempts = 8 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let handle = null;
    try {
      handle = await fs.open(filePath, "r");
      return await handle.readFile("utf8");
    } catch (error) {
      lastError = error;
      if (!isTransientFsError(error) || attempt === attempts) throw error;
      await sleep(40 * attempt + jitter(25, 125));
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  throw lastError;
}

async function parseDbFile(filePath) {
  const raw = await readTextFileWithRetry(filePath);

  try {
    return normalizeDb(JSON.parse(raw));
  } catch (error) {
    throw createJsonParseError(filePath, raw, error);
  }
}

async function appendRecoveryLog(message) {
  await fs.appendFile(path.join(dataDir, "store-recovery.log"), `${nowIso()} ${message}\n`, "utf8").catch(() => {});
}

async function quarantineBadDb(error) {
  const stamp = nowIso().replace(/[:.]/g, "-");
  const corruptPath = path.join(dataDir, `leads.corrupt.${stamp}.${process.pid}.json`);
  await fs.copyFile(dbPath, corruptPath).catch(() => {});
  await appendRecoveryLog(`recovered leads.json after ${error?.name || "Error"}: ${error?.message || error}`);
  return corruptPath;
}

async function removeWithRetry(filePath, { attempts = 8 } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rm(filePath, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientFsError(error) || attempt === attempts) throw error;
      await sleep(35 * attempt + jitter(20, 100));
    }
  }

  if (lastError) throw lastError;
}

async function maybeRemoveStaleLock({ staleMs }) {
  try {
    const stat = await fs.stat(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < staleMs) return false;

    const stalePath = `${lockPath}.stale.${Date.now()}.${process.pid}.${randomUUID()}`;
    await fs.rename(lockPath, stalePath);
    await removeWithRetry(stalePath).catch(() => {});
    await appendRecoveryLog(`removed stale DB lock after ${Math.round(ageMs)}ms`);
    return true;
  } catch (error) {
    if (["ENOENT", "EPERM", "EACCES", "EBUSY"].includes(error.code)) return false;
    throw error;
  }
}

async function acquireDbLock({ timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, staleMs = DEFAULT_LOCK_STALE_MS } = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  const startedAt = Date.now();
  const token = `${process.pid}:${Date.now()}:${randomUUID()}`;
  let attempt = 0;

  while (true) {
    attempt += 1;
    let handle = null;

    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, acquiredAt: nowIso() }, null, 2), "utf8");
      await handle.sync().catch(() => {});

      const heartbeatMs = Math.max(2_000, Math.min(10_000, Math.floor(staleMs / 4)));
      const heartbeat = setInterval(() => {
        const now = new Date();
        fs.utimes(lockPath, now, now).catch(() => {});
      }, heartbeatMs);
      heartbeat.unref?.();

      return async () => {
        clearInterval(heartbeat);
        await handle.close().catch(() => {});
        await removeWithRetry(lockPath).catch(async (error) => {
          await appendRecoveryLog(`failed to release DB lock: ${error.message || error}`);
        });
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});

      if (error.code !== "EEXIST") throw error;

      await maybeRemoveStaleLock({ staleMs }).catch(() => false);

      if (Date.now() - startedAt >= timeoutMs) {
        const timeoutError = new Error(`Timed out waiting for DB lock after ${timeoutMs}ms (${lockPath})`);
        timeoutError.code = "DB_LOCK_TIMEOUT";
        timeoutError.cause = error;
        throw timeoutError;
      }

      const backoff = Math.min(1_500, 40 * 2 ** Math.min(attempt, 5)) + jitter(25, 175);
      await sleep(backoff);
    }
  }
}

async function withDbLock(fn, options = {}) {
  const release = await acquireDbLock(options);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function fsyncDirectoryBestEffort(dirPath) {
  let handle = null;
  try {
    handle = await fs.open(dirPath, "r");
    await handle.sync();
  } catch {
    // Windows often disallows opening directories directly. The temp-file fsync
    // plus atomic rename is the important durability guarantee here.
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function writeTextAtomic(filePath, payload, { renameAttempts = DEFAULT_RENAME_ATTEMPTS } = {}) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = path.join(dir, `.${base}.tmp.${Date.now()}.${process.pid}.${randomUUID()}`);
  let handle = null;

  try {
    handle = await fs.open(tempPath, "wx");
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }

  let lastError = null;
  try {
    for (let attempt = 1; attempt <= renameAttempts; attempt += 1) {
      try {
        await fs.rename(tempPath, filePath);
        await fsyncDirectoryBestEffort(dir);
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientFsError(error) || attempt === renameAttempts) throw error;
        const backoff = Math.min(2_000, 50 * 2 ** Math.min(attempt - 1, 6)) + jitter(25, 250);
        await sleep(backoff);
      }
    }
  } catch (error) {
    await removeWithRetry(tempPath).catch(() => {});
    error.message = `${error.message}; atomic rename failed for ${filePath} after ${renameAttempts} attempts; previous file was left untouched`;
    error.cause = error.cause || lastError;
    throw error;
  }
}

async function writeDbUnlocked(db) {
  await fs.mkdir(dataDir, { recursive: true });
  const nextDb = normalizeDb({ ...db, updatedAt: nowIso() });
  const serialized = `${JSON.stringify(nextDb, null, 2)}\n`;

  await writeTextAtomic(dbPath, serialized);
  await writeTextAtomic(backupPath, serialized).catch(async (error) => {
    await appendRecoveryLog(`failed to update leads.json.bak: ${error.message || error}`);
  });

  return nextDb;
}

async function readDbUnlocked() {
  await fs.mkdir(dataDir, { recursive: true });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await parseDbFile(dbPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return await writeDbUnlocked(emptyDb());
      }

      const transient = isTransientFsError(error) || isRecoverableJsonError(error);
      if (!transient || attempt === 8) throw error;
      await sleep(60 * attempt + jitter(30, 180));
    }
  }

  return emptyDb();
}

async function recoverDbUnlocked(error) {
  try {
    return await parseDbFile(dbPath);
  } catch {
    // The lock holder sees the same corruption and is responsible for recovery.
  }

  try {
    const backupDb = await parseDbFile(backupPath);
    await quarantineBadDb(error);
    return await writeDbUnlocked(backupDb);
  } catch {
    await quarantineBadDb(error);
    return await writeDbUnlocked(emptyDb());
  }
}

export async function readDb() {
  return withDbLock(async () => {
    try {
      return await readDbUnlocked();
    } catch (error) {
      if (isTransientFsError(error) || isRecoverableJsonError(error)) {
        return recoverDbUnlocked(error);
      }
      throw error;
    }
  });
}

export async function writeDb(db) {
  return withDbLock(() => writeDbUnlocked(db));
}

export async function upsertLeads(incoming, runId) {
  return withDbLock(async () => {
    const db = await readDbUnlocked();
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

    const persisted = await writeDbUnlocked(db);
    return { created, updated, total: persisted.leads.length };
  });
}

export async function addRun(run) {
  return withDbLock(async () => {
    const db = await readDbUnlocked();
    db.runs.unshift(run);
    db.runs = db.runs.slice(0, 50);
    await writeDbUnlocked(db);
  });
}

export async function updateLead(id, patch) {
  return withDbLock(async () => {
    const db = await readDbUnlocked();
    const index = db.leads.findIndex((lead) => lead.id === id);
    if (index === -1) return null;
    db.leads[index] = {
      ...db.leads[index],
      ...patch,
      updatedAt: nowIso()
    };
    await writeDbUnlocked(db);
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
