// mods/engineering-cockpit/src/register.tsx
import { atom, read } from "claude-code";

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

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
var DEFAULT_PROTECTED_GLOBS = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/id_ed25519",
  "**/id_ed25519.*",
  "**/.npmrc",
  "**/.netrc",
  "**/credentials",
  "**/credentials.*"
];
var DEFAULT_PROTECTED_EXCEPTIONS = [
  "**/.env.example",
  "**/.env.sample",
  "**/.env.template"
];

// packages/core/src/classify.ts
var CHECKS = ["build", "test", "lint", "typecheck", "security"];
function isCheckName(value) {
  return typeof value === "string" && CHECKS.includes(value);
}

// packages/core/src/util.ts
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function registerCommand(host, spec) {
  try {
    await host.command.register(spec);
    return true;
  } catch (error) {
    host.ui.toast(`/${spec.name} is unavailable: ${errorMessage(error)}`);
    return false;
  }
}

// packages/core/src/config.ts
var GUARD_TIERS = [
  "preview-only",
  "button",
  "typed-code",
  "always-block"
];
function defaultConfig() {
  return {
    guard: {
      confirmTier: "button",
      protectedPaths: [...DEFAULT_PROTECTED_GLOBS],
      protectedExceptions: [...DEFAULT_PROTECTED_EXCEPTIONS]
    },
    evidence: {
      required: ["build", "test", "lint", "typecheck"],
      commands: {},
      maxAgeMinutes: 30,
      gateMode: "enforce",
      runTimeoutMs: 3e5
    },
    contract: {
      objective: "",
      allowed: [],
      forbidden: [],
      mode: "warn"
    },
    architecture: {
      mode: "warn",
      layers: [],
      baselineFile: "architecture-baseline.json"
    },
    meter: {
      contextWarnPercent: 70,
      contextCriticalPercent: 90,
      costWarnUsd: 5,
      rateWarnPercent: 80
    },
    cache: {
      ttlSeconds: 300
    },
    firewall: {
      mode: "warn",
      allowHosts: [],
      allowProcesses: []
    }
  };
}
function parseConfig(input) {
  const errors = [];
  const value = defaultConfig();
  if (input === void 0) return { value, errors };
  if (!isJsonObject(input)) {
    errors.push("config must be a JSON object; defaults are in use");
    return { value, errors };
  }
  const section = (root, key) => {
    const found = root[key];
    if (found === void 0) return {};
    if (isJsonObject(found)) return found;
    errors.push(`${key} must be an object; defaults are in use`);
    return {};
  };
  const read2 = (source, scope, key, check, fallback) => {
    const candidate = source[key];
    if (candidate === void 0) return fallback;
    const checked = check(candidate);
    if (checked === void 0) {
      errors.push(`${scope}.${key} is invalid; default used`);
      return fallback;
    }
    return checked;
  };
  const asString = (candidate) => typeof candidate === "string" ? candidate : void 0;
  const asPositive = (candidate) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : void 0;
  const asStrings = (candidate) => Array.isArray(candidate) && candidate.every((item) => typeof item === "string") ? [...candidate] : void 0;
  const asMode = (candidate) => candidate === "observe" || candidate === "warn" || candidate === "enforce" ? candidate : void 0;
  const asTier = (candidate) => GUARD_TIERS.find((tier) => tier === candidate);
  const guard = section(input, "guard");
  value.guard.confirmTier = read2(guard, "guard", "confirmTier", asTier, value.guard.confirmTier);
  value.guard.protectedPaths = read2(
    guard,
    "guard",
    "protectedPaths",
    asStrings,
    value.guard.protectedPaths
  );
  value.guard.protectedExceptions = read2(
    guard,
    "guard",
    "protectedExceptions",
    asStrings,
    value.guard.protectedExceptions
  );
  const evidence2 = section(input, "evidence");
  value.evidence.required = read2(
    evidence2,
    "evidence",
    "required",
    (candidate) => {
      if (!Array.isArray(candidate) || !candidate.every(isCheckName)) return void 0;
      return candidate.filter(isCheckName);
    },
    value.evidence.required
  );
  value.evidence.maxAgeMinutes = read2(
    evidence2,
    "evidence",
    "maxAgeMinutes",
    asPositive,
    value.evidence.maxAgeMinutes
  );
  value.evidence.gateMode = read2(evidence2, "evidence", "gateMode", asMode, value.evidence.gateMode);
  value.evidence.runTimeoutMs = read2(
    evidence2,
    "evidence",
    "runTimeoutMs",
    asPositive,
    value.evidence.runTimeoutMs
  );
  const commands = section(evidence2, "commands");
  value.evidence.commands = parseCommands(commands, errors);
  const contract2 = section(input, "contract");
  value.contract.objective = read2(contract2, "contract", "objective", asString, "");
  value.contract.allowed = read2(contract2, "contract", "allowed", asStrings, []);
  value.contract.forbidden = read2(contract2, "contract", "forbidden", asStrings, []);
  value.contract.mode = read2(contract2, "contract", "mode", asMode, value.contract.mode);
  const architecture2 = section(input, "architecture");
  value.architecture.mode = read2(
    architecture2,
    "architecture",
    "mode",
    asMode,
    value.architecture.mode
  );
  value.architecture.layers = parseLayers(architecture2, errors);
  value.architecture.baselineFile = read2(
    architecture2,
    "architecture",
    "baselineFile",
    asString,
    value.architecture.baselineFile
  );
  const meter2 = section(input, "meter");
  value.meter.contextWarnPercent = read2(
    meter2,
    "meter",
    "contextWarnPercent",
    asPositive,
    value.meter.contextWarnPercent
  );
  value.meter.contextCriticalPercent = read2(
    meter2,
    "meter",
    "contextCriticalPercent",
    asPositive,
    value.meter.contextCriticalPercent
  );
  value.meter.costWarnUsd = read2(meter2, "meter", "costWarnUsd", asPositive, value.meter.costWarnUsd);
  value.meter.rateWarnPercent = read2(
    meter2,
    "meter",
    "rateWarnPercent",
    asPositive,
    value.meter.rateWarnPercent
  );
  const cache = section(input, "cache");
  value.cache.ttlSeconds = read2(cache, "cache", "ttlSeconds", asPositive, value.cache.ttlSeconds);
  const firewall = section(input, "firewall");
  value.firewall.mode = read2(firewall, "firewall", "mode", asMode, value.firewall.mode);
  value.firewall.allowHosts = read2(firewall, "firewall", "allowHosts", asStrings, []);
  value.firewall.allowProcesses = read2(firewall, "firewall", "allowProcesses", asStrings, []);
  return { value, errors };
}
function parseCommands(commands, errors) {
  const out = {};
  for (const key of Object.keys(commands)) {
    if (!isCheckName(key)) {
      errors.push(`evidence.commands.${key} is not a check (${CHECKS.join(", ")})`);
      continue;
    }
    const list = commands[key];
    const valid = Array.isArray(list) && list.every(
      (argv) => Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === "string" && item.length > 0)
    );
    if (!valid) {
      errors.push(`evidence.commands.${key} must be a list of argv arrays; check skipped`);
      continue;
    }
    out[key] = list.map((argv) => [...argv]);
  }
  return out;
}
function parseLayers(architecture2, errors) {
  const raw = architecture2["layers"];
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) {
    errors.push("architecture.layers must be a list; no layers in use");
    return [];
  }
  const layers = [];
  for (const item of raw) {
    if (!isJsonObject(item) || typeof item["name"] !== "string" || !Array.isArray(item["paths"]) || !item["paths"].every((path) => typeof path === "string") || !Array.isArray(item["mayDependOn"]) || !item["mayDependOn"].every((name) => typeof name === "string")) {
      errors.push("architecture.layers entry is invalid; entry skipped");
      continue;
    }
    layers.push({
      name: item["name"],
      paths: [...item["paths"]],
      mayDependOn: [...item["mayDependOn"]]
    });
  }
  return layers;
}
var CONFIG_PATH = `${STATE_DIR}/config.json`;
async function loadConfig(read2) {
  let text;
  try {
    text = await read2(CONFIG_PATH);
  } catch {
    return parseConfig(void 0);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      value: defaultConfig(),
      errors: [`${CONFIG_PATH} is not valid JSON; defaults are in use`]
    };
  }
  return parseConfig(parsed);
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/readiness.ts
function assessReadiness(input) {
  const scope = !input.contract.active ? { label: "Scope", verdict: "UNKNOWN", detail: "no change contract recorded" } : input.contract.violations === 0 ? { label: "Scope", verdict: "PASS", detail: `within contract (${input.contract.mode})` } : {
    label: "Scope",
    verdict: "FAIL",
    detail: `${input.contract.violations} write(s) outside the contract`
  };
  const failing = input.evidence.checks.filter((item) => item.verdict !== "PASS");
  const evidence2 = {
    label: "Evidence",
    verdict: input.evidence.overall,
    detail: input.evidence.checks.length === 0 ? "no checks configured or run" : failing.length === 0 ? "all required checks current" : failing.map((item) => `${item.check} ${item.verdict} (${item.reason})`).join("; ")
  };
  const review2 = {
    label: "Review",
    verdict: input.review.verdict,
    detail: input.review.reason
  };
  const architecture2 = {
    label: "Architecture",
    verdict: input.architecture.verdict,
    detail: input.architecture.reason
  };
  const items = [scope, evidence2, review2, architecture2];
  const overall = worstVerdict(items.map((item) => item.verdict));
  const verdict = overall === "PASS" ? "READY" : overall === "FAIL" ? "NOT READY" : "UNKNOWN";
  return { verdict, items };
}

// packages/core/src/ui.tsx
var VERDICTS = {
  PASS: { tone: "success", glyph: "✓" },
  READY: { tone: "success", glyph: "✓" },
  FAIL: { tone: "error", glyph: "✗" },
  "NOT READY": { tone: "error", glyph: "✗" },
  BLOCKED: { tone: "error", glyph: "✗" },
  WARN: { tone: "warning", glyph: "!" },
  DEFERRED: { tone: "warning", glyph: "»" },
  STALE: { tone: "warning", glyph: "↻" },
  UNKNOWN: { tone: "inactive", glyph: "○" }
};
var NEUTRAL = { tone: "inactive", glyph: "○" };
function verdictLook(verdict) {
  return VERDICTS[verdict.toUpperCase()] ?? NEUTRAL;
}
function chip(kit, label, look) {
  const { Text } = kit;
  return /* @__PURE__ */ h(Text, { inverse: true, weight: "bold", color: look.tone }, ` ${look.glyph} ${label} `);
}
function header(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }, /* @__PURE__ */ h(Text, { weight: "bold", color: "claude" }, "◆ ", input.title), /* @__PURE__ */ h(Box, { flexDirection: "row", gap: 1 }, input.meta === void 0 ? null : /* @__PURE__ */ h(Text, { dimColor: true }, input.meta), input.badge ?? null));
}
function meter(kit, label, percent, look) {
  const { Progress } = kit;
  const clamped = Math.max(0, Math.min(100, percent));
  return /* @__PURE__ */ h(
    Progress,
    {
      label,
      value: clamped,
      max: 100,
      valueText: `${Math.round(clamped)}%`,
      color: look.tone
    }
  );
}

// mods/engineering-cockpit/src/register.tsx
var PANE = "engineering-cockpit";
var EVIDENCE_IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var CONTRACT_IDLE = { active: false, objective: "", violations: 0, mode: "warn" };
var IMPACT_IDLE = {
  selection: [],
  untested: [],
  full: false,
  reason: "not computed yet"
};
var REVIEW_IDLE = {
  verdict: "UNKNOWN",
  openHigh: 0,
  open: 0,
  reason: "no review findings recorded"
};
var ARCH_IDLE = {
  verdict: "UNKNOWN",
  reason: "not scanned yet",
  fresh: 0,
  baseline: 0
};
var MIGRATION_IDLE = { verdict: "UNKNOWN", findings: [] };
var RADAR_IDLE = { verdict: "UNKNOWN", changes: [], scan: "no scan recorded" };
var BUDGET_IDLE = { verdict: "UNKNOWN", rows: ["no measurement checked yet"] };
var evidence = atom({ plugin: "evidence-gate", key: "status" }, EVIDENCE_IDLE, {
  shape: "status-1"
});
var contract = atom({ plugin: "change-contract", key: "status" }, CONTRACT_IDLE, {
  shape: "status-1"
});
var impact = atom({ plugin: "test-impact", key: "impact" }, IMPACT_IDLE, {
  shape: "impact-1"
});
var review = atom({ plugin: "review-tracker", key: "gate" }, REVIEW_IDLE, {
  shape: "gate-1"
});
var architecture = atom({ plugin: "architecture-guard", key: "status" }, ARCH_IDLE, {
  shape: "status-1"
});
var migration = atom({ plugin: "migration-sentinel", key: "status" }, MIGRATION_IDLE, {
  shape: "status-1"
});
var radar = atom({ plugin: "dependency-radar", key: "status" }, RADAR_IDLE, {
  shape: "status-1"
});
var budget = atom({ plugin: "performance-budget", key: "status" }, BUDGET_IDLE, {
  shape: "status-1"
});
async function readinessInput($) {
  const [ev, ct, rv, ar] = await Promise.all([
    read($, evidence),
    read($, contract),
    read($, review),
    read($, architecture)
  ]);
  return { contract: ct, evidence: ev, review: rv, architecture: ar };
}
async function rowsOf($) {
  const [ct, im, ev, rv, ar, mg, rd, bd] = await Promise.all([
    read($, contract),
    read($, impact),
    read($, evidence),
    read($, review),
    read($, architecture),
    read($, migration),
    read($, radar),
    read($, budget)
  ]);
  const impactVerdict = im.full || im.untested.length > 0 ? "UNKNOWN" : "PASS";
  const readiness = assessReadiness(await readinessInput($));
  return [
    {
      label: "CONTRACT",
      verdict: !ct.active ? "UNKNOWN" : ct.violations === 0 ? "PASS" : "FAIL",
      detail: ct.active ? `${ct.mode} · ${ct.violations} write(s) outside scope` : "no contract recorded"
    },
    {
      label: "IMPACT",
      verdict: impactVerdict,
      detail: im.full ? `full suite: ${im.reason}` : `${im.selection.length} test(s) selected · ${im.untested.length} untested change(s)`
    },
    {
      label: "EVIDENCE",
      verdict: ev.overall,
      detail: ev.checks.map((item) => `${item.check} ${item.verdict}`).join(" · ") || "no checks run"
    },
    { label: "REVIEW", verdict: rv.verdict, detail: rv.reason },
    { label: "ARCHITECTURE", verdict: ar.verdict, detail: ar.reason },
    {
      label: "MIGRATION",
      verdict: mg.verdict,
      detail: mg.findings[0] ?? "no migration changes reviewed"
    },
    { label: "DEPENDENCIES", verdict: rd.verdict, detail: rd.changes[0] ?? rd.scan },
    { label: "PERFORMANCE", verdict: bd.verdict, detail: bd.rows[0] ?? "no measurement checked" },
    {
      label: "RELEASE",
      verdict: readiness.verdict === "READY" ? "PASS" : readiness.verdict === "NOT READY" ? "FAIL" : "UNKNOWN",
      detail: `readiness ${readiness.verdict}`
    }
  ];
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "agentic",
      description: "Cockpit: /agentic status | doctor | privacy"
    });
    return next(e);
  });
  on("command.run", { command: "agentic" }, async ($, e) => {
    const subcommand = e.args.trim() || "status";
    if (subcommand === "status") {
      await $.ui.open({ id: PANE, title: "Engineering cockpit" });
      const rows = await rowsOf($);
      return {
        text: rows.map(
          (row) => `${verdictLook(row.verdict).glyph} ${row.label.padEnd(13)} ${row.verdict.padEnd(9)} ${row.detail}`
        ).join("\n")
      };
    }
    if (subcommand === "doctor") {
      const loaded = await loadConfig((path) => $.fs.read(path));
      const rows = await rowsOf($);
      const lines = [
        loaded.errors.length === 0 ? "config: valid" : "config problems:",
        ...loaded.errors.map((message) => `  ${message}`),
        `cockpit rows with UNKNOWN: ${rows.filter((row) => row.verdict === "UNKNOWN").map((row) => row.label).join(", ") || "none"}`
      ];
      return { text: lines.join("\n") };
    }
    if (subcommand === "privacy") {
      return {
        text: [
          "Local only. No network calls and no remote telemetry are made by these mods.",
          "Files written under .agentic-mods/: contract.json, findings.json, ledger.json,",
          "architecture-baseline.json, audit/*.jsonl, incidents/*, scans/* (read only).",
          "Session values are kept in each mod's own store, shared across sessions on this machine.",
          "Secret-looking values are redacted before they are written to an audit or timeline file."
        ].join("\n")
      };
    }
    return { text: "Usage: /agentic status | doctor | privacy" };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e);
    const { Box, Text } = kit;
    const rows = await rowsOf($);
    const readiness = assessReadiness(await readinessInput($));
    const passing = rows.filter((row) => row.verdict === "PASS").length;
    const failing = rows.filter((row) => row.verdict === "FAIL").length;
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, header(kit, {
      title: "Engineering cockpit",
      meta: `${passing} pass · ${failing} fail · ${rows.length - passing - failing} unknown`,
      badge: chip(kit, readiness.verdict, verdictLook(readiness.verdict))
    }), meter(
      kit,
      "Gates passing",
      passing / Math.max(1, rows.length) * 100,
      verdictLook(failing > 0 ? "FAIL" : passing === rows.length ? "PASS" : "WARN")
    ), /* @__PURE__ */ h(Box, { flexDirection: "column", marginTop: 1 }, rows.map((row) => /* @__PURE__ */ h(Box, { key: row.label, flexDirection: "row", gap: 1 }, /* @__PURE__ */ h(Box, { width: 14 }, /* @__PURE__ */ h(Text, { weight: "bold" }, row.label)), /* @__PURE__ */ h(Box, { width: 12 }, chip(kit, row.verdict, verdictLook(row.verdict))), /* @__PURE__ */ h(Text, { dimColor: true, wrap: "truncate-end" }, row.detail)))));
  });
}
export {
  register
};
