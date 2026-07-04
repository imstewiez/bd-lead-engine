import { exportLeads } from "./exporter.js";
import { sleep } from "./utils.js";

function numberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number(raw || process.env[name.toUpperCase()] || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const intervalMs = numberArg("intervalMs", 45000);

async function runOnce() {
  const result = await exportLeads({
    csvName: "autopilot-qualified-leads.csv",
    jsonName: "autopilot-qualified-leads.json",
    contactCsvName: "autopilot-qualified-contactable-leads.csv",
    contactJsonName: "autopilot-qualified-contactable-leads.json",
    hotCsvName: "autopilot-hot-leads.csv",
    hotJsonName: "autopilot-hot-leads.json"
  });

  console.log(
    `[qualified-exporter] ${new Date().toISOString()} total=${result.total} qualified=${result.exported} contactable=${result.contactable} hot=${result.hot} social=${result.social} instagram=${result.instagram} linkedin=${result.linkedin} x=${result.x}`
  );
}

while (true) {
  try {
    await runOnce();
  } catch (error) {
    console.error(`[qualified-exporter] ${new Date().toISOString()} ${error.stack || error.message}`);
  }
  await sleep(intervalMs);
}
