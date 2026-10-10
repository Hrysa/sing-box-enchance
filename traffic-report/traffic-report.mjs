import { createReadStream } from "node:fs";
import process from "node:process";
import { createInterface } from "node:readline";

async function summarizeTraffic(logFile) {
  const hours = new Map();
  let untimed = 0;
  let lines = 0;
  let skipped = 0;
  const input = createInterface({
    input: createReadStream(logFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of input) {
    lines += 1;
    if (line.trim() === "") continue;
    try {
      const record = JSON.parse(line);
      if (!addHourlyConnection(hours, record, record?.closedAt ?? record?.collectedAt)) untimed += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    lines,
    skipped,
    untimed,
    hours: [...hours.values()]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((entry) => ({
        ...entry,
        domains: [...entry.domains.values()]
          .sort((left, right) => right.total - left.total || left.domain.localeCompare(right.domain))
          .slice(0, 5),
      })),
  };
}

function addConnection(domains, record) {
  const connection = record?.connection ?? record;
  const domain = normalizeDomain(connection?.metadata?.host);
  if (!domain) return false;

  const download = nonNegativeNumber(connection.download);
  const upload = nonNegativeNumber(connection.upload);
  const entry = domains.get(domain) ?? { domain, connections: 0, download: 0, upload: 0, total: 0 };
  entry.connections += 1;
  entry.download += download;
  entry.upload += upload;
  entry.total += download + upload;
  domains.set(domain, entry);
  return true;
}

function addHourlyConnection(hours, record, time) {
  const connection = record?.connection ?? record;
  if (!connection || typeof connection !== "object" || typeof time !== "string") return false;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return false;
  // Round in local time without changing the offset during DST transitions.
  const timestamp = date.getTime() - date.getMinutes() * 60_000
    - date.getSeconds() * 1_000 - date.getMilliseconds();
  const entry = hours.get(timestamp) ?? { timestamp, connections: 0, download: 0, upload: 0, total: 0, domains: new Map() };
  const download = nonNegativeNumber(connection.download);
  const upload = nonNegativeNumber(connection.upload);
  entry.connections += 1;
  entry.download += download;
  entry.upload += upload;
  entry.total += download + upload;
  addConnection(entry.domains, connection);
  hours.set(timestamp, entry);
  return true;
}

function formatHour(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:00 ${zone}`;
}

function normalizeDomain(value) {
  if (typeof value !== "string" || value.trim() === "") return "";
  let domain = value.trim().toLowerCase().replace(/\.$/, "");
  try {
    domain = new URL(domain.includes("://") ? domain : `//${domain}`, "http:").hostname;
  } catch {
    // Use the original value if it is not a URL-shaped host.
  }
  return domain.replace(/^\[|\]$/g, "");
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function printTrafficSummary(result, logFile) {
  console.log(`File: ${logFile}`);
  console.log(`Records: ${result.lines}; skipped invalid JSON: ${result.skipped}`);
  console.log("\nHourly traffic (local time; closed connections only, by close time):\n");
  if (result.hours.length === 0) {
    console.log("No timestamped traffic records.");
  }
  const rows = result.hours.flatMap((entry) => [
    { label: formatHour(entry.timestamp), entry },
    ...entry.domains.map((domain, index) => ({
      label: `  ${index === entry.domains.length - 1 ? "└──" : "├──"} ${domain.domain}`,
      entry: domain,
    })),
    null,
  ]);
  const widths = { label: 0, download: 0, upload: 0, total: 0, connections: 0 };
  for (const row of rows) {
    if (!row) continue;
    widths.label = Math.max(widths.label, row.label.length);
    for (const key of ["download", "upload", "total", "connections"]) {
      const value = key === "connections" ? String(row.entry[key]) : formatBytes(row.entry[key]);
      widths[key] = Math.max(widths[key], value.length);
    }
  }
  for (const row of rows) {
    console.log(row ? `${row.label.padEnd(widths.label)}  ${formatTraffic(row.entry, widths)}` : "");
  }
  if (result.untimed > 0) {
    console.log(`Records without a usable timestamp: ${result.untimed} (excluded from hourly traffic).`);
  }
  console.log("Hourly totals include all hosts; children show the top 5 named domains.");
  console.log("Whole-connection totals are assigned to the close hour, not measured within each hour.");

}

function formatTraffic(entry, widths) {
  return `download: ${formatBytes(entry.download).padStart(widths.download)} | upload: ${formatBytes(entry.upload).padStart(widths.upload)} | total: ${formatBytes(entry.total).padStart(widths.total)} | connections: ${String(entry.connections).padStart(widths.connections)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024 || nextUnit === units.at(-1)) break;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
}

const args = process.argv.slice(2);
if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
  console.log("Usage: node traffic-report.mjs <log-file>");
} else if (args.length !== 1) {
  console.error("Usage: node traffic-report.mjs <log-file>");
  process.exitCode = 1;
} else {
  try {
    printTrafficSummary(await summarizeTraffic(args[0]), args[0]);
  } catch (error) {
    console.error(`[report] ${error.message}`);
    process.exitCode = 1;
  }
}
