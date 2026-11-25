// mods/performance-budget/src/register.tsx
import { atom, update } from "claude-code";

// packages/core/src/policy.ts
var RANK = { PASS: 0, STALE: 1, UNKNOWN: 2, FAIL: 3 };
function worstVerdict(verdicts) {
  if (verdicts.length === 0) return "UNKNOWN";
  let worst = "PASS";
  for (const verdict of verdicts) {
    if (RANK[verdict] > RANK[worst]) worst = verdict;
  }
  return worst;
}

// packages/core/src/budgets.ts
function parseMetrics(format, text) {
  if (format === "go-bench") return parseGoBench(text);
  const parsed = JSON.parse(text);
  switch (format) {
    case "generic":
      return parseGeneric(parsed);
    case "vite-stats":
      return parseStats(parsed);
    case "jmh":
      return parseJmh(parsed);
    case "pytest-benchmark":
      return parsePytest(parsed);
  }
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function parseGeneric(parsed) {
  const list = Array.isArray(parsed) ? parsed : asRecord(parsed)?.["metrics"];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const record = asRecord(item);
    if (record === null || typeof record["name"] !== "string" || typeof record["value"] !== "number" || !Number.isFinite(record["value"])) {
      continue;
    }
    out.push({
      name: record["name"],
      value: record["value"],
      unit: typeof record["unit"] === "string" ? record["unit"] : ""
    });
  }
  return out;
}
function parseStats(parsed) {
  const assets = asRecord(parsed)?.["assets"];
  if (!Array.isArray(assets)) return [];
  let total = 0;
  for (const asset of assets) {
    const record = asRecord(asset);
    if (record === null || typeof record["size"] !== "number") continue;
    const name = typeof record["name"] === "string" ? record["name"] : "";
    if (/\.(js|mjs|css)$/.test(name)) total += record["size"];
  }
  return [{ name: "bundle-total", value: total, unit: "bytes" }];
}
function parseJmh(parsed) {
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const item of parsed) {
    const record = asRecord(item);
    const primary = asRecord(record?.["primaryMetric"]);
    if (record === null || primary === null || typeof record["benchmark"] !== "string" || typeof primary["score"] !== "number") {
      continue;
    }
    out.push({
      name: record["benchmark"],
      value: primary["score"],
      unit: typeof primary["scoreUnit"] === "string" ? primary["scoreUnit"] : ""
    });
  }
  return out;
}
function parsePytest(parsed) {
  const benchmarks = asRecord(parsed)?.["benchmarks"];
  if (!Array.isArray(benchmarks)) return [];
  const out = [];
  for (const item of benchmarks) {
    const record = asRecord(item);
    const stats = asRecord(record?.["stats"]);
    if (record === null || stats === null || typeof record["name"] !== "string") continue;
    if (typeof stats["mean"] !== "number") continue;
    out.push({ name: record["name"], value: stats["mean"], unit: "s" });
  }
  return out;
}
function parseGoBench(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const match = /^(Benchmark\S+?)(?:-\d+)?\s+\d+\s+([\d.]+)\s+ns\/op/.exec(line.trim());
    if (match === null) continue;
    out.push({ name: match[1] ?? "", value: Number(match[2]), unit: "ns/op" });
  }
  return out;
}
function evaluateBudgets(metrics, budgets) {
  return budgets.map((budget) => {
    const metric = metrics.find((candidate) => candidate.name === budget.name);
    if (metric === void 0) {
      return {
        name: budget.name,
        value: null,
        max: budget.max,
        unit: budget.unit,
        verdict: "UNKNOWN",
        reason: "no measurement"
      };
    }
    if (metric.unit !== budget.unit) {
      return {
        name: budget.name,
        value: metric.value,
        max: budget.max,
        unit: budget.unit,
        verdict: "UNKNOWN",
        reason: `unit ${metric.unit || "none"} does not match ${budget.unit}`
      };
    }
    const within = metric.value <= budget.max;
    return {
      name: budget.name,
      value: metric.value,
      max: budget.max,
      unit: budget.unit,
      verdict: within ? "PASS" : "FAIL",
      reason: within ? "within budget" : "over budget"
    };
  });
}

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
function normalizePath(input) {
  let path = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// mods/performance-budget/src/register.tsx
var FORMATS = [
  "generic",
  "vite-stats",
  "jmh",
  "pytest-benchmark",
  "go-bench"
];
var IDLE = { verdict: "UNKNOWN", rows: ["no measurement checked yet"] };
var status = atom({ plugin: "performance-budget", key: "status" }, IDLE, {
  shape: "status-1"
});
async function budgetsOf($) {
  try {
    const parsed = JSON.parse(await $.fs.read(".agentic-mods/budgets.json"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => typeof item === "object" && item !== null && typeof item.name === "string" && typeof item.max === "number" && typeof item.unit === "string"
    );
  } catch {
    return [];
  }
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "perf",
      description: "Check a measurement against budgets: /perf check <generic|vite-stats|jmh|pytest-benchmark|go-bench> <path>"
    });
    return next(e);
  });
  on("command.run", { command: "perf" }, async ($, e) => {
    const [subcommand = "", format = "", ...rest] = e.args.trim().split(/\s+/);
    const chosen = FORMATS.find((value) => value === format);
    if (subcommand !== "check" || chosen === void 0 || rest.length === 0) {
      return { text: `Usage: /perf check <${FORMATS.join("|")}> <path>` };
    }
    const path = normalizePath(rest.join(" "));
    const budgets = await budgetsOf($);
    if (budgets.length === 0) {
      return { text: "No budgets: add .agentic-mods/budgets.json as a list of {name, max, unit}." };
    }
    const metrics = parseMetrics(chosen, await $.fs.read(path));
    const rows = evaluateBudgets(metrics, budgets);
    const verdict = worstVerdict(rows.map((row) => row.verdict));
    const lines = rows.map((row) => {
      const value = row.value === null ? "missing" : `${row.value} ${row.unit}`;
      return `${row.name}: ${row.verdict} (${value}, budget ${row.max} ${row.unit}, ${row.reason})`;
    });
    await update($, status, () => ({ verdict, rows: lines }));
    return { text: lines.join("\n") };
  });
}
export {
  register
};
