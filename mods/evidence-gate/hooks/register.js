// mods/evidence-gate/src/register.tsx
import { atom, read, update } from "claude-code";

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
function violation(mode, policyId, message, remediation) {
  const decision = mode === "enforce" ? "block" : mode === "warn" ? "warn" : "allow";
  return remediation === void 0 ? { decision, policyId, message } : { decision, policyId, message, remediation };
}
function describeDecision(decision) {
  const head = `[${decision.policyId}] ${decision.message}`;
  return decision.remediation === void 0 ? head : `${head} ${decision.remediation}`;
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
function splitSegments(command) {
  return command.split(/&&|\|\||;|\||\n/).map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}
function tokenize(segment) {
  const tokens = [];
  let current = "";
  let quote = null;
  let hasToken = false;
  for (const ch of segment) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) tokens.push(current);
  return tokens;
}
var WRAPPERS = /* @__PURE__ */ new Set(["env", "time", "sudo", "nohup", "command", "exec", "nice"]);
function argvOf(segment) {
  const tokens = tokenize(segment);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (WRAPPERS.has(token) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || token.startsWith("-")) {
      index++;
      continue;
    }
    break;
  }
  return tokens.slice(index);
}
var SCRIPT_CHECKS = {
  build: "build",
  test: "test",
  lint: "lint",
  typecheck: "typecheck",
  "type-check": "typecheck",
  "check:types": "typecheck"
};
function checkOf(argv) {
  const head = argv[0] ?? "";
  const base = head.replace(/^.*\//, "");
  const second = argv[1] ?? "";
  const third = argv[2] ?? "";
  const positional = argv.slice(1).filter((token) => !token.startsWith("-"));
  switch (base) {
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun": {
      if (positional[0] === "audit") return "security";
      if (positional[0] === "run" || positional[0] === "run-script") {
        return SCRIPT_CHECKS[positional[1] ?? ""] ?? null;
      }
      return SCRIPT_CHECKS[positional[0] ?? ""] ?? null;
    }
    case "npx":
    case "pnpx":
    case "bunx": {
      const tool = (positional[0] ?? "").replace(/^.*\//, "");
      if (tool === "jest" || tool === "vitest") return "test";
      if (tool === "eslint") return "lint";
      if (tool === "tsc") return argv.includes("--noEmit") ? "typecheck" : "build";
      return null;
    }
    case "jest":
    case "vitest":
      return "test";
    case "tsc":
      return argv.includes("--noEmit") ? "typecheck" : "build";
    case "eslint":
      return "lint";
    case "biome":
      return second === "check" || second === "lint" ? "lint" : null;
    case "prettier":
      return argv.includes("--check") ? "lint" : null;
    case "pytest":
    case "py.test":
      return "test";
    case "python":
    case "python3":
      return second === "-m" && third === "pytest" ? "test" : null;
    case "mypy":
    case "pyright":
      return "typecheck";
    case "ruff":
      return second === "check" || second === "format" && argv.includes("--check") ? "lint" : null;
    case "pip-audit":
    case "safety":
    case "osv-scanner":
    case "govulncheck":
      return "security";
    case "go":
      if (second === "test") return "test";
      if (second === "build") return "build";
      if (second === "vet") return "lint";
      return null;
    case "golangci-lint":
      return "lint";
    case "cargo":
      if (second === "test") return "test";
      if (second === "build") return "build";
      if (second === "clippy") return "lint";
      if (second === "check") return "typecheck";
      if (second === "audit") return "security";
      return null;
    case "mvn":
    case "mvnw":
      if (second === "test") return "test";
      if (second === "package" || second === "install" || second === "verify") return "build";
      return null;
    case "gradle":
    case "gradlew":
      if (second === "test") return "test";
      if (second === "build") return "build";
      return null;
    case "dotnet":
      if (second === "test") return "test";
      if (second === "build") return "build";
      if (second === "format" && argv.includes("--verify-no-changes")) return "lint";
      return null;
    case "make":
      return SCRIPT_CHECKS[second] ?? null;
    case "turbo":
      return second === "run" ? SCRIPT_CHECKS[third] ?? null : null;
    default:
      return null;
  }
}
function gitActionOf(argv) {
  if (argv[0] === "gh") {
    return argv[1] === "pr" && argv[2] === "create" ? "pr-create" : null;
  }
  if (argv[0] !== "git") return null;
  let index = 1;
  while (index < argv.length) {
    const token = argv[index] ?? "";
    if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
      index += 2;
      continue;
    }
    if (token.startsWith("-")) {
      index++;
      continue;
    }
    break;
  }
  const subcommand = argv[index];
  if (subcommand === "commit") return "commit";
  if (subcommand === "push") return "push";
  return null;
}
function gitSubcommand(argv) {
  if (argv[0] !== "git") return null;
  for (const token of argv.slice(1)) {
    if (!token.startsWith("-")) return token;
  }
  return null;
}
function shortFlags(argv) {
  return argv.filter((token) => token.startsWith("-") && !token.startsWith("--")).map((token) => token.slice(1)).join("");
}
var DANGER_RULES = [
  {
    id: "pipe-to-shell",
    level: "always-block",
    reason: "downloads and executes code without review",
    matches: (_argv, text) => /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/.test(text)
  },
  {
    id: "disk-overwrite",
    level: "always-block",
    reason: "formats or overwrites a block device",
    matches: (_argv, text) => /(^|\s)mkfs(\.\w+)?\b/.test(text) || /\bdd\s+if=/.test(text) || /of=\/dev\//.test(text)
  },
  {
    id: "database-drop",
    level: "always-block",
    reason: "drops a whole database or schema",
    matches: (_argv, text) => /\bdrop\s+(database|schema)\b/i.test(text)
  },
  {
    id: "cloud-project-delete",
    level: "always-block",
    reason: "deletes a cloud project and everything in it",
    matches: (argv) => argv[0] === "gcloud" && argv[1] === "projects" && argv[2] === "delete"
  },
  {
    id: "recursive-force-delete",
    level: "confirm",
    reason: "deletes a tree of files without prompts",
    matches: (argv) => {
      if (argv[0] !== "rm") return false;
      const flags = shortFlags(argv);
      const recursive = /[rR]/.test(flags) || argv.includes("--recursive");
      const force = /f/.test(flags) || argv.includes("--force");
      return recursive && force;
    }
  },
  {
    id: "git-force-push",
    level: "confirm",
    reason: "rewrites remote history",
    matches: (argv) => gitSubcommand(argv) === "push" && argv.some(
      (token) => token === "--force" || token === "-f" || token.startsWith("--force-with-lease")
    )
  },
  {
    id: "git-hard-reset",
    level: "confirm",
    reason: "discards uncommitted work",
    matches: (argv) => gitSubcommand(argv) === "reset" && argv.includes("--hard")
  },
  {
    id: "git-clean-force",
    level: "confirm",
    reason: "deletes untracked files",
    matches: (argv) => gitSubcommand(argv) === "clean" && shortFlags(argv).includes("f")
  },
  {
    id: "sql-table-destruction",
    level: "confirm",
    reason: "drops or truncates table data",
    matches: (_argv, text) => /\b(drop\s+table|truncate\s+table)\b/i.test(text)
  },
  {
    id: "infrastructure-delete",
    level: "confirm",
    reason: "deletes cluster or infrastructure resources",
    matches: (argv) => argv[0] === "kubectl" && argv[1] === "delete" || argv[0] === "helm" && argv[1] === "uninstall" || argv[0] === "terraform" && argv[1] === "destroy" || argv[0] === "aws" && argv[1] === "cloudformation" && argv[2] === "delete-stack" || argv[0] === "az" && argv[1] === "group" && argv[2] === "delete"
  },
  {
    id: "docker-prune",
    level: "confirm",
    reason: "removes docker images, containers or volumes",
    matches: (argv) => argv[0] === "docker" && (argv[1] === "system" || argv[1] === "volume") && argv[2] === "prune"
  },
  {
    id: "world-writable",
    level: "confirm",
    reason: "makes files world-writable",
    matches: (argv) => argv[0] === "chmod" && shortFlags(argv).includes("R") && argv.includes("777")
  }
];
function analyzeCommand(command) {
  const checks = [];
  const gitActions = [];
  const dangers = [];
  const seenRules = /* @__PURE__ */ new Set();
  const addDanger = (rule) => {
    if (seenRules.has(rule.id)) return;
    seenRules.add(rule.id);
    dangers.push({ rule: rule.id, level: rule.level, reason: rule.reason });
  };
  for (const rule of DANGER_RULES) {
    if (rule.matches([], command)) addDanger(rule);
  }
  for (const segment of splitSegments(command)) {
    const argv = argvOf(segment);
    const check = checkOf(argv);
    if (check !== null && !checks.includes(check)) checks.push(check);
    const action = gitActionOf(argv);
    if (action !== null && !gitActions.includes(action)) gitActions.push(action);
    for (const rule of DANGER_RULES) {
      if (rule.matches(argv, segment)) addDanger(rule);
    }
  }
  return { checks, gitActions, dangers };
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
function appendCapped(list, item, cap) {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
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
  const evidence = section(input, "evidence");
  value.evidence.required = read2(
    evidence,
    "evidence",
    "required",
    (candidate) => {
      if (!Array.isArray(candidate) || !candidate.every(isCheckName)) return void 0;
      return candidate.filter(isCheckName);
    },
    value.evidence.required
  );
  value.evidence.maxAgeMinutes = read2(
    evidence,
    "evidence",
    "maxAgeMinutes",
    asPositive,
    value.evidence.maxAgeMinutes
  );
  value.evidence.gateMode = read2(evidence, "evidence", "gateMode", asMode, value.evidence.gateMode);
  value.evidence.runTimeoutMs = read2(
    evidence,
    "evidence",
    "runTimeoutMs",
    asPositive,
    value.evidence.runTimeoutMs
  );
  const commands = section(evidence, "commands");
  value.evidence.commands = parseCommands(commands, errors);
  const contract = section(input, "contract");
  value.contract.objective = read2(contract, "contract", "objective", asString, "");
  value.contract.allowed = read2(contract, "contract", "allowed", asStrings, []);
  value.contract.forbidden = read2(contract, "contract", "forbidden", asStrings, []);
  value.contract.mode = read2(contract, "contract", "mode", asMode, value.contract.mode);
  const architecture = section(input, "architecture");
  value.architecture.mode = read2(
    architecture,
    "architecture",
    "mode",
    asMode,
    value.architecture.mode
  );
  value.architecture.layers = parseLayers(architecture, errors);
  value.architecture.baselineFile = read2(
    architecture,
    "architecture",
    "baselineFile",
    asString,
    value.architecture.baselineFile
  );
  const meter = section(input, "meter");
  value.meter.contextWarnPercent = read2(
    meter,
    "meter",
    "contextWarnPercent",
    asPositive,
    value.meter.contextWarnPercent
  );
  value.meter.contextCriticalPercent = read2(
    meter,
    "meter",
    "contextCriticalPercent",
    asPositive,
    value.meter.contextCriticalPercent
  );
  value.meter.costWarnUsd = read2(meter, "meter", "costWarnUsd", asPositive, value.meter.costWarnUsd);
  value.meter.rateWarnPercent = read2(
    meter,
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

// packages/core/src/evidence.ts
function evaluateChecks(required, latest, currentFingerprint, nowMs, maxAgeMs) {
  return required.map((check) => {
    const record = latest.get(check) ?? null;
    if (record === null) {
      return { check, verdict: "UNKNOWN", reason: "not run", record };
    }
    if (record.source !== "run") {
      return { check, verdict: "UNKNOWN", reason: "observed only; never a pass", record };
    }
    if (record.exitCode === null) {
      return { check, verdict: "UNKNOWN", reason: "exit code unavailable", record };
    }
    if (record.exitCode !== 0) {
      return { check, verdict: "FAIL", reason: `exit ${record.exitCode}`, record };
    }
    if (currentFingerprint === null) {
      return { check, verdict: "UNKNOWN", reason: "repository state unreadable", record };
    }
    if (record.fingerprint !== currentFingerprint) {
      return { check, verdict: "STALE", reason: "files changed after the run", record };
    }
    if (nowMs - record.ranAt > maxAgeMs) {
      return { check, verdict: "STALE", reason: "older than the configured age", record };
    }
    return { check, verdict: "PASS", reason: "current", record };
  });
}
function overallVerdict(statuses) {
  return worstVerdict(statuses.map((status2) => status2.verdict));
}
function gateDecision(action, statuses, mode) {
  const blocking = statuses.filter((status2) => status2.verdict !== "PASS");
  const label = action === "pr-create" ? "pull request" : action;
  if (blocking.length === 0) {
    return { decision: "allow", policyId: "evidence-gate", message: `${label}: evidence current` };
  }
  const detail = blocking.map((status2) => `${status2.check} ${status2.verdict} (${status2.reason})`);
  return violation(
    mode,
    "evidence-gate",
    `${label} needs current evidence: ${detail.join("; ")}`,
    "Run /evidence run to refresh the required checks, then retry."
  );
}

// packages/core/src/git.ts
function parseStatusZ(output) {
  const records = output.split("\0");
  const entries = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? "";
    if (record.length < 4) continue;
    const index = record.charAt(0);
    const worktree = record.charAt(1);
    const path = record.slice(3);
    if (index === "R" || index === "C") i++;
    entries.push({
      path,
      index,
      worktree,
      isUntracked: index === "?" && worktree === "?"
    });
  }
  return entries;
}
async function currentHead(run) {
  const result = await run(["git", "rev-parse", "HEAD"]);
  if (result.exitCode !== 0) return null;
  const head = result.stdout.trim();
  return head.length > 0 ? head : null;
}
async function workingTreeChanges(run) {
  const result = await run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (result.exitCode !== 0) return null;
  return parseStatusZ(result.stdout);
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
async function fingerprintFiles(entries) {
  const sorted = [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const lines = [];
  for (const [path, content] of sorted) {
    const digest = content === null ? "<absent>" : await sha256Hex(content);
    lines.push(`${path}\0${digest}`);
  }
  return sha256Hex(lines.join("\n"));
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
function card(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(
    Box,
    {
      key: input.key,
      flexDirection: "column",
      borderStyle: "round",
      borderColor: input.look.tone,
      paddingX: 1
    },
    /* @__PURE__ */ h(Text, { weight: "bold", color: input.look.tone }, input.look.glyph, " ", input.title),
    (input.lines ?? []).map((line) => /* @__PURE__ */ h(Text, { dimColor: true, wrap: "truncate-end" }, line))
  );
}
function band(kit, name, segments) {
  const { Box, Text } = kit;
  const parts = [];
  segments.forEach((segment, index) => {
    if (index > 0) parts.push(/* @__PURE__ */ h(Text, { dimColor: true }, " · "));
    parts.push(
      /* @__PURE__ */ h(Text, { color: segment.tone, weight: segment.bold === true ? "bold" : "regular" }, segment.text)
    );
  });
  return /* @__PURE__ */ h(Box, { flexDirection: "row" }, /* @__PURE__ */ h(Text, { color: "claude" }, "◆ "), /* @__PURE__ */ h(Text, { dimColor: true }, name, " "), parts);
}
function empty(kit, text, hint) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, { dimColor: true, italic: true }, text), hint === void 0 ? null : /* @__PURE__ */ h(Text, { color: "suggestion" }, "→ ", hint));
}

// mods/evidence-gate/src/register.tsx
var PANE = "evidence-gate";
var MAX_RECORDS = 50;
var MAX_TIMEOUT_MS = 6e5;
var IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var status = atom({ plugin: "evidence-gate", key: "status" }, IDLE, {
  shape: "status-1"
});
function runnerOf($) {
  return async (argv) => {
    const result = await $.process.run(argv);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}
async function readOrNull($, path) {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}
async function repoFingerprint($) {
  const run = runnerOf($);
  const head = await currentHead(run);
  const changes = await workingTreeChanges(run);
  if (changes === null) return null;
  const entries = [["HEAD", head]];
  for (const change of changes) {
    entries.push([change.path, await readOrNull($, change.path)]);
  }
  return fingerprintFiles(entries);
}
async function storedRecords($) {
  const value = await $.store.get("records");
  return Array.isArray(value) ? value : [];
}
function latestByCheck(records) {
  const latest = /* @__PURE__ */ new Map();
  for (const record of records) latest.set(record.check, record);
  return latest;
}
async function snapshotOf($) {
  const config = (await loadConfig((path) => $.fs.read(path))).value;
  const fingerprint = await repoFingerprint($);
  const statuses = evaluateChecks(
    config.evidence.required,
    latestByCheck(await storedRecords($)),
    fingerprint,
    await $.clock.now(),
    config.evidence.maxAgeMinutes * 6e4
  );
  const configured = Object.values(config.evidence.commands).some(
    (list) => Array.isArray(list) && list.length > 0
  );
  return { config, configured, statuses, overall: overallVerdict(statuses), fingerprint };
}
async function publish($, snap) {
  await update($, status, () => ({
    overall: snap.overall,
    fingerprint: snap.fingerprint,
    checks: snap.statuses.map((item) => ({
      check: item.check,
      verdict: item.verdict,
      reason: item.reason,
      ranAt: item.record?.ranAt ?? null
    }))
  }));
}
async function runCheck($, config, check) {
  const commands = config.evidence.commands[check] ?? [];
  const startedAt = await $.clock.now();
  const timeoutMs = Math.min(config.evidence.runTimeoutMs, MAX_TIMEOUT_MS);
  let exitCode = commands.length === 0 ? null : 0;
  for (const argv of commands) {
    try {
      const result = await $.process.run(argv, { timeoutMs });
      if (result.exitCode !== 0) {
        exitCode = result.exitCode;
        break;
      }
    } catch {
      exitCode = null;
      break;
    }
  }
  const endedAt = await $.clock.now();
  return {
    check,
    argv: commands[0] ?? [],
    exitCode,
    fingerprint: await repoFingerprint($),
    ranAt: endedAt,
    durationMs: endedAt - startedAt,
    source: "run"
  };
}
function summaryOf(snap) {
  const lines = snap.statuses.map((item) => `${item.check}: ${item.verdict} (${item.reason})`);
  const notice = snap.configured ? [] : ["No evidence commands are configured in .agentic-mods/config.json, so git gates only warn."];
  return [`evidence: ${snap.overall}`, ...lines, ...notice].join("\n");
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "evidence",
      description: "Show or run the verification checks: /evidence [run [check...] | clear]"
    });
    return next(e);
  });
  on("command.run", { command: "evidence" }, async ($, e) => {
    const [subcommand = "status", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    if (subcommand === "clear") {
      await $.store.set("records", []);
      await publish($, await snapshotOf($));
      return { text: "Recorded evidence cleared." };
    }
    if (subcommand === "run") {
      const requested = rest.filter(isCheckName);
      const before = await snapshotOf($);
      const targets = requested.length > 0 ? requested : before.config.evidence.required;
      let records = await storedRecords($);
      for (const check of targets) {
        const record = await runCheck($, before.config, check);
        records = appendCapped(records, record, MAX_RECORDS);
        await $.store.set("records", records);
      }
      const after = await snapshotOf($);
      await publish($, after);
      return { text: summaryOf(after) };
    }
    if (subcommand === "status") {
      const snap = await snapshotOf($);
      await publish($, snap);
      await $.ui.open({ id: PANE, title: "Evidence" });
      return { text: summaryOf(snap) };
    }
    return { text: `Usage: /evidence [run [${CHECKS.join("|")}...] | clear]` };
  });
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const actions = analyzeCommand(e.command).gitActions;
    if (actions.length === 0) return next(e);
    const snap = await snapshotOf($);
    await publish($, snap);
    for (const action of actions) {
      const mode = snap.configured ? snap.config.evidence.gateMode : "warn";
      const decision = gateDecision(action, snap.statuses, mode);
      if (decision.decision === "block") return { deny: describeDecision(decision) };
      if (decision.decision === "warn") $.ui.toast(describeDecision(decision));
    }
    return next(e);
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "evidence-gate failed closed: the gated action was not checked." }
  );
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, status);
    if (current.checks.length === 0) return next(e);
    const kit = $.ui.resolve(e);
    return band(
      kit,
      "evidence",
      current.checks.map((item) => {
        const look = verdictLook(item.verdict);
        return { text: `${look.glyph} ${item.check}`, tone: look.tone };
      })
    );
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e);
    const { Box, Text } = kit;
    const current = await read($, status);
    if (current.checks.length === 0) {
      return empty(kit, "No checks configured or run yet.", "/evidence run");
    }
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, header(kit, {
      title: "Evidence",
      meta: `${current.checks.length} check(s)`,
      badge: chip(kit, current.overall, verdictLook(current.overall))
    }), current.checks.map(
      (item) => card(kit, {
        key: item.check,
        title: `${item.check}  ${item.verdict}`,
        look: verdictLook(item.verdict),
        lines: [item.reason]
      })
    ), /* @__PURE__ */ h(Text, { dimColor: true }, "Commit, push and PR are gated on these checks."));
  });
}
export {
  register
};
