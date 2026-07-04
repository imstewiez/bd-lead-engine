import { runScan } from "./engine.js";

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => arg.split("="))
    .filter(([key]) => key?.startsWith("--"))
    .map(([key, value]) => [key.replace(/^--/, ""), value ?? "true"])
);

const options = {
  regionSet: args.get("region") || args.get("regionSet") || "global",
  maxQueries: Number(args.get("maxQueries") || 24),
  limitPerQuery: Number(args.get("limitPerQuery") || 8),
  fetchPages: args.get("fetchPages") !== "false",
  deepEnrich: args.get("deepEnrich") === "true",
  searchContacts: args.get("searchContacts") !== "false",
  maxContactPages: Number(args.get("maxContactPages") || 5),
  maxExternalWebsites: Number(args.get("maxExternalWebsites") || 3),
  exportEvery: Number(args.get("exportEvery") || 5),
  incremental: args.get("incremental") !== "false",
  queryOffset: Number(args.get("queryOffset") || 0),
  includePartners: args.get("includePartners") !== "false",
  includeRecruitment: args.get("includeRecruitment") !== "false",
  includeIntentPosts: args.get("includeIntentPosts") !== "false",
  includeEcosystem: args.get("includeEcosystem") !== "false"
};

await runScan(options, (progress) => {
  const prefix = `[${progress.status}]`;
  if (progress.message) console.log(prefix, progress.message);
});
