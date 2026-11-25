// mods/command-guard/src/register.tsx
import { atom, read } from "claude-code";

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
    matches: (argv) => gitSubcommand(argv) === "push" && argv.some((token) => token === "--force" || token === "-f" || token.startsWith("--force-with-lease"))
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
function sortDangers(dangers) {
  return [...dangers].sort((a, b) => a.level === b.level ? 0 : a.level === "always-block" ? -1 : 1);
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
function globToRegExp(glob) {
  const source = normalizePath(glob);
  let pattern = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (ch === "*") {
      if (source.charAt(i + 1) === "*") {
        if (source.charAt(i + 2) === "/") {
          pattern += "(?:.*/)?";
          i += 2;
        } else {
          pattern += ".*";
          i += 1;
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (ch === "?") {
      pattern += "[^/]";
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}
function matchesAnyGlob(path, globs) {
  const normalized = normalizePath(path);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}
function isProtectedPath(path, protectedGlobs = DEFAULT_PROTECTED_GLOBS, exceptions = DEFAULT_PROTECTED_EXCEPTIONS) {
  return matchesAnyGlob(path, protectedGlobs) && !matchesAnyGlob(path, exceptions);
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
async function shortCode(text, length = 6) {
  const hex = await sha256Hex(text);
  return hex.slice(0, length).toUpperCase();
}

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

// mods/command-guard/src/register.tsx
var PLUGIN = "command-guard";
var TIER_ORDER = ["preview-only", "button", "typed-code", "always-block"];
var incident = atom(
  { plugin: "incident-timeline", key: "incident" },
  { isOpen: false, profile: "standard", id: null },
  { shape: "incident-1" }
);
var ALLOW = { kind: "allow" };
function stricter(a, b) {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}
async function configOf($) {
  const loaded = await loadConfig((path) => $.fs.read(path));
  return loaded.value;
}
async function blockedCount($) {
  return Number(await $.store.get("blocked") ?? 0);
}
async function recordBlock($, tool, reason) {
  await $.store.set("blocked", await blockedCount($) + 1);
  const path = stateRelativePath("audit/command-guard.jsonl");
  let existing = "";
  try {
    existing = await $.fs.read(path);
  } catch {
    existing = "";
  }
  await $.fs.write(
    path,
    appendJsonLine(existing, auditLine({ plugin: PLUGIN, tool, decision: "deny", reason }, Date.now()), 500)
  );
}
async function judgeCommand($, command) {
  const analysis = analyzeCommand(command);
  const [top] = sortDangers(analysis.dangers);
  if (top === void 0) return ALLOW;
  if (top.level === "always-block") {
    return { kind: "deny", text: `command-guard: refused, ${top.reason}. The command was not run.` };
  }
  const config = await configOf($);
  const state = await read($, incident);
  let tier = config.guard.confirmTier;
  if (state.isOpen) tier = stricter(tier, "typed-code");
  const reasons = analysis.dangers.map((hit) => hit.reason).join("; ");
  switch (tier) {
    case "always-block":
      return { kind: "deny", text: `command-guard: this tier never runs confirm-level commands. ${reasons}.` };
    case "preview-only":
      return {
        kind: "deny",
        text: `command-guard: held for the person, not run. Command: ${command}. Reason: ${reasons}.`
      };
    case "button": {
      const answer = await $.ui.ask(`Run this command? ${command}
Reason: ${reasons}`, ["Proceed", "Cancel"]);
      return answer === "Proceed" ? ALLOW : { kind: "deny", text: "command-guard: cancelled by the person." };
    }
    case "typed-code": {
      const code = await shortCode(command, 6);
      const answer = await $.ui.ask(`${reasons}
To run it, type ${code}. Command: ${command}`);
      return answer.trim().toUpperCase() === code ? ALLOW : { kind: "deny", text: "command-guard: the confirmation code did not match; nothing ran." };
    }
  }
}
async function protectedDenial($, tool, path) {
  const config = await configOf($);
  if (!isProtectedPath(path, config.guard.protectedPaths, config.guard.protectedExceptions)) return null;
  const text = `command-guard: ${path} is a protected secret file. Change it yourself, or add an exception in .agentic-mods/config.json.`;
  await recordBlock($, tool, text);
  return text;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "guard",
      description: "Show command-guard's settings, config problems and blocks this session"
    });
    return next(e);
  });
  on("command.run", { command: "guard" }, async ($) => {
    const loaded = await loadConfig((path) => $.fs.read(path));
    const lines = [
      `command-guard: confirm tier ${loaded.value.guard.confirmTier}`,
      `blocked this session: ${await blockedCount($)}`,
      ...loaded.errors.map((message) => `config: ${message}`)
    ];
    return { text: lines.join("\n") };
  });
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const judgement = await judgeCommand($, e.command);
    if (judgement.kind === "deny") {
      await recordBlock($, "Bash", judgement.text);
      return { deny: judgement.text };
    }
    return next(e);
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "command-guard failed closed: the command was not judged." }
  );
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const denial = await protectedDenial($, "Edit", e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch((_$, e, next) => next.called ? next(e) : { deny: "command-guard failed closed on Edit." });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const denial = await protectedDenial($, "Write", e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch((_$, e, next) => next.called ? next(e) : { deny: "command-guard failed closed on Write." });
  on("tool.call", { tool: "Read" }, async ($, e, next) => {
    const denial = await protectedDenial($, "Read", e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch((_$, e, next) => next.called ? next(e) : { deny: "command-guard failed closed on Read." });
}
export {
  register
};
