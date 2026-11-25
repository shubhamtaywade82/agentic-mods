// packages/core/src/classify.ts
var CHECKS = ["build", "test", "lint", "typecheck", "security"];
function isCheckName(value) {
  return typeof value === "string" && CHECKS.includes(value);
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
var PathGuardError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PathGuardError";
  }
};
function normalizePath(input) {
  let path = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function hasParentSegment(path) {
  return normalizePath(path).split("/").includes("..");
}
function stateRelativePath(relative) {
  const path = normalizePath(relative);
  if (path === "" || isAbsolutePath(path) || hasParentSegment(path)) {
    throw new PathGuardError(`refusing a state path outside ${STATE_DIR}: ${relative}`);
  }
  return `${STATE_DIR}/${path}`;
}

// packages/core/src/util.ts
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const read = (source, scope, key, check, fallback) => {
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
  value.guard.confirmTier = read(guard, "guard", "confirmTier", asTier, value.guard.confirmTier);
  value.guard.protectedPaths = read(
    guard,
    "guard",
    "protectedPaths",
    asStrings,
    value.guard.protectedPaths
  );
  value.guard.protectedExceptions = read(
    guard,
    "guard",
    "protectedExceptions",
    asStrings,
    value.guard.protectedExceptions
  );
  const evidence = section(input, "evidence");
  value.evidence.required = read(
    evidence,
    "evidence",
    "required",
    (candidate) => {
      if (!Array.isArray(candidate) || !candidate.every(isCheckName)) return void 0;
      return candidate.filter(isCheckName);
    },
    value.evidence.required
  );
  value.evidence.maxAgeMinutes = read(
    evidence,
    "evidence",
    "maxAgeMinutes",
    asPositive,
    value.evidence.maxAgeMinutes
  );
  value.evidence.gateMode = read(evidence, "evidence", "gateMode", asMode, value.evidence.gateMode);
  value.evidence.runTimeoutMs = read(
    evidence,
    "evidence",
    "runTimeoutMs",
    asPositive,
    value.evidence.runTimeoutMs
  );
  const commands = section(evidence, "commands");
  value.evidence.commands = parseCommands(commands, errors);
  const contract = section(input, "contract");
  value.contract.objective = read(contract, "contract", "objective", asString, "");
  value.contract.allowed = read(contract, "contract", "allowed", asStrings, []);
  value.contract.forbidden = read(contract, "contract", "forbidden", asStrings, []);
  value.contract.mode = read(contract, "contract", "mode", asMode, value.contract.mode);
  const architecture = section(input, "architecture");
  value.architecture.mode = read(
    architecture,
    "architecture",
    "mode",
    asMode,
    value.architecture.mode
  );
  value.architecture.layers = parseLayers(architecture, errors);
  value.architecture.baselineFile = read(
    architecture,
    "architecture",
    "baselineFile",
    asString,
    value.architecture.baselineFile
  );
  const meter = section(input, "meter");
  value.meter.contextWarnPercent = read(
    meter,
    "meter",
    "contextWarnPercent",
    asPositive,
    value.meter.contextWarnPercent
  );
  value.meter.contextCriticalPercent = read(
    meter,
    "meter",
    "contextCriticalPercent",
    asPositive,
    value.meter.contextCriticalPercent
  );
  value.meter.costWarnUsd = read(meter, "meter", "costWarnUsd", asPositive, value.meter.costWarnUsd);
  value.meter.rateWarnPercent = read(
    meter,
    "meter",
    "rateWarnPercent",
    asPositive,
    value.meter.rateWarnPercent
  );
  const cache = section(input, "cache");
  value.cache.ttlSeconds = read(cache, "cache", "ttlSeconds", asPositive, value.cache.ttlSeconds);
  const firewall = section(input, "firewall");
  value.firewall.mode = read(firewall, "firewall", "mode", asMode, value.firewall.mode);
  value.firewall.allowHosts = read(firewall, "firewall", "allowHosts", asStrings, []);
  value.firewall.allowProcesses = read(firewall, "firewall", "allowProcesses", asStrings, []);
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
function parseLayers(architecture, errors) {
  const raw = architecture["layers"];
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
async function loadConfig(read) {
  let text;
  try {
    text = await read(CONFIG_PATH);
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

// packages/core/src/log.ts
var SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}/gi,
  /\b(api[_-]?key|access[_-]?token|secret|password|passwd)\b(\s*[:=]\s*)\S+/gi
];
function redact(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, ...rest) => {
      const label = typeof rest[0] === "string" && rest[0].length < 40 ? rest[0] : "";
      const separator = typeof rest[1] === "string" ? rest[1] : "";
      return label.length > 0 ? `${label}${separator}[redacted]` : "[redacted]";
    });
  }
  return out;
}
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
function appendJsonLine(existing, line, cap) {
  const lines = existing.split("\n").filter((item) => item.length > 0);
  lines.push(line);
  const kept = lines.length > cap ? lines.slice(lines.length - cap) : lines;
  return `${kept.join("\n")}
`;
}
function auditLine(record, at) {
  const safe = { at: new Date(at).toISOString() };
  for (const [key, value] of Object.entries(record)) {
    safe[key] = typeof value === "string" ? truncate(redact(value), 2e3) : value;
  }
  return JSON.stringify(safe);
}

// packages/core/src/native.ts
var NATIVE_MODS = [
  // safety and boundary
  "command-guard",
  "mod-firewall",
  // visibility and orientation
  "session-meter",
  "cache-clock",
  "task-orientation",
  "mission-control",
  "turn-replay",
  "markdown-preview",
  "switchboard",
  "response-modes",
  "next-steps",
  // verification and governance
  "evidence-gate",
  "change-contract",
  "test-impact",
  "review-tracker",
  "pr-readiness",
  "architecture-guard",
  "migration-sentinel",
  "dependency-radar",
  "performance-budget",
  "debug-timeline",
  "learning-ledger",
  "worktree-orchestrator",
  "engineering-cockpit",
  // presentation
  "boss-fight",
  "code-pet",
  "session-wrapped",
  "commentary",
  // incident
  "incident-timeline",
  // workflow layer
  "workflow-conductor",
  "tdd-conductor",
  "regression-orchestrator",
  "defect-protocol",
  "behavior-lock",
  "contract-compatibility-guard",
  "specification-guard",
  "change-planner",
  "observability-verifier",
  "release-conductor",
  "ci-triage",
  // local integrated mods
  "design-patterns",
  "guardian",
  "mod-template",
  "pulse",
  "sdlc",
  "trace",
  "verify"
];
function isNativeMod(name) {
  return NATIVE_MODS.includes(name);
}
var VENDORED_PLUGINS = [
  "sdlc-guard",
  "secret-guard",
  "model-router",
  "run-observer"
];
function isTrustedMod(name) {
  return isNativeMod(name) || VENDORED_PLUGINS.includes(name);
}

// mods/mod-firewall/src/register.tsx
var PLUGIN = "mod-firewall";
var AUDIT_CAP = 500;
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
function executableOf(argv) {
  return (argv[0] ?? "").replace(/^.*\//, "");
}
async function audit($, record) {
  const path = stateRelativePath("audit/firewall.jsonl");
  let existing;
  try {
    existing = await $.fs.read(path);
  } catch {
    existing = "";
  }
  await $.fs.write(path, appendJsonLine(existing, auditLine(record, Date.now()), AUDIT_CAP));
}
async function decide($, kind, origin, target, allowed) {
  if (origin === "engine" || isTrustedMod(origin)) return null;
  const config = (await loadConfig((path) => $.fs.read(path))).value.firewall;
  const isAllowed = allowed.includes(target);
  await audit($, { plugin: PLUGIN, kind, origin, target, allowed: isAllowed, mode: config.mode });
  if (isAllowed || config.mode === "observe") return null;
  const message = `mod-firewall: ${origin} may not ${kind === "http" ? "reach" : "start"} ${target}. Add it to .agentic-mods/config.json under firewall to allow it.`;
  if (config.mode === "warn") {
    $.ui.toast(truncate(message, 180));
    return null;
  }
  return message;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "firewall",
      description: "Show recent network and process decisions made for other mods"
    });
    return next(e);
  });
  on("command.run", { command: "firewall" }, async ($) => {
    const path = stateRelativePath("audit/firewall.jsonl");
    try {
      const lines = (await $.fs.read(path)).split("\n").filter((line) => line.length > 0);
      return { text: lines.slice(-20).join("\n") || "No decisions recorded yet." };
    } catch {
      return { text: "No decisions recorded yet." };
    }
  });
  on("http.fetch", async ($, e, next) => {
    const denial = await decide(
      $,
      "http",
      next.origin.plugin,
      hostOf(e.url),
      (await loadConfig((path) => $.fs.read(path))).value.firewall.allowHosts
    );
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "mod-firewall failed closed on an outbound request." }
  );
  on("process.run", async ($, e, next) => {
    const denial = await decide(
      $,
      "process",
      next.origin.plugin,
      executableOf(e.argv),
      (await loadConfig((path) => $.fs.read(path))).value.firewall.allowProcesses
    );
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "mod-firewall failed closed on a process launch." }
  );
}
export {
  register
};
