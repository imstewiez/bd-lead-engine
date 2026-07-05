import fs from "node:fs";
import path from "node:path";
import { getRootDir } from "./store.js";

const rootDir = getRootDir();
const envPath = path.join(rootDir, ".env");

function unquote(value = "") {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadLocalEnv() {
  if (!fs.existsSync(envPath)) return { loaded: false, path: envPath, keys: [] };
  const loaded = [];
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = unquote(line.slice(index + 1));
    if (!/^[A-Z0-9_]+$/i.test(key)) continue;
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return { loaded: true, path: envPath, keys: loaded };
}

export function searchApiStatus() {
  return {
    brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    serpapi: Boolean(process.env.SERPAPI_KEY),
    searchFallbackEngines: process.env.SEARCH_FALLBACK_ENGINES || "default"
  };
}

loadLocalEnv();
