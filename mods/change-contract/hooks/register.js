// mods/change-contract/src/register.tsx
import { atom, read, update } from "claude-code";

// packages/core/src/policy.ts
function allowed(policyId) {
  return { decision: "allow", policyId, message: "" };
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

// packages/core/src/governance.ts
function parseContractJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed;
  const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
  const mode = record["mode"];
  if (typeof record["objective"] !== "string") return null;
  if (!isStrings(record["allowed"]) || !isStrings(record["forbidden"])) return null;
  if (mode !== "observe" && mode !== "warn" && mode !== "enforce") return null;
  return {
    objective: record["objective"],
    allowed: [...record["allowed"]],
    forbidden: [...record["forbidden"]],
    mode
  };
}
function contractDecision(contract, path) {
  const normalized = normalizePath(path);
  if (matchesAnyGlob(normalized, contract.forbidden)) {
    return violation(
      contract.mode,
      "change-contract",
      `${normalized} is forbidden by the contract`,
      "Amend the contract with /contract amend if this change is intended."
    );
  }
  if (contract.allowed.length > 0 && !matchesAnyGlob(normalized, contract.allowed)) {
    return violation(
      contract.mode,
      "change-contract",
      `${normalized} is outside the allowed scope`,
      "Amend the contract with /contract amend if this change is intended."
    );
  }
  return { decision: "allow", policyId: "change-contract", message: "within scope" };
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/ui.tsx
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

// mods/change-contract/src/register.tsx
var MAX_VIOLATIONS = 50;
var IDLE = { active: false, objective: "", violations: 0, mode: "warn" };
var status = atom({ plugin: "change-contract", key: "status" }, IDLE, {
  shape: "status-1"
});
function isActive(spec) {
  return spec.objective.trim() !== "" || spec.allowed.length > 0 || spec.forbidden.length > 0;
}
async function loadContract($) {
  const configured = (await loadConfig((path) => $.fs.read(path))).value.contract;
  let fromFile;
  try {
    fromFile = parseContractJson(await $.fs.read(stateRelativePath("contract.json")));
  } catch {
    fromFile = null;
  }
  return fromFile ?? { ...configured };
}
async function saveContract($, spec) {
  await $.fs.write(stateRelativePath("contract.json"), `${JSON.stringify(spec, null, 2)}
`);
  await update($, status, (current) => ({
    ...current,
    active: isActive(spec),
    objective: spec.objective,
    mode: spec.mode
  }));
}
async function judge($, path) {
  const spec = await loadContract($);
  if (!isActive(spec)) return allowed("change-contract");
  return contractDecision(spec, path);
}
async function recordViolation($, decision) {
  const list = await $.store.get("violations");
  const existing = Array.isArray(list) ? list : [];
  const next = appendCapped(
    existing,
    `${(/* @__PURE__ */ new Date()).toISOString()} ${describeDecision(decision)}`,
    MAX_VIOLATIONS
  );
  await $.store.set("violations", next);
  await update($, status, (current) => ({ ...current, violations: next.length }));
}
async function guardWrite($, path) {
  const decision = await judge($, normalizePath(path));
  if (decision.decision === "allow") return null;
  await recordViolation($, decision);
  if (decision.decision === "block") return describeDecision(decision);
  $.ui.toast(describeDecision(decision));
  return null;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "contract",
      description: "Show, set or amend the change contract: /contract show|set|allow|forbid|mode|violations|close"
    });
    return next(e);
  });
  on("command.run", { command: "contract" }, async ($, e) => {
    const [subcommand = "show", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    const text = rest.join(" ");
    const spec = await loadContract($);
    switch (subcommand) {
      case "show":
        return {
          text: [
            `objective: ${spec.objective || "not set"}`,
            `allowed: ${spec.allowed.join(", ") || "anything not forbidden"}`,
            `forbidden: ${spec.forbidden.join(", ") || "none"}`,
            `mode: ${spec.mode}`
          ].join("\n")
        };
      case "set":
        if (text === "") return { text: "Usage: /contract set <objective>" };
        await saveContract($, { ...spec, objective: text });
        return { text: "Objective recorded." };
      case "allow":
        if (rest.length === 0) return { text: "Usage: /contract allow <glob...>" };
        await saveContract($, { ...spec, allowed: [.../* @__PURE__ */ new Set([...spec.allowed, ...rest])] });
        return { text: `Allowed paths now: ${rest.join(", ")} added.` };
      case "forbid":
        if (rest.length === 0) return { text: "Usage: /contract forbid <glob...>" };
        await saveContract($, { ...spec, forbidden: [.../* @__PURE__ */ new Set([...spec.forbidden, ...rest])] });
        return { text: `Forbidden paths: ${rest.join(", ")} added.` };
      case "mode": {
        const mode = rest[0];
        if (mode !== "observe" && mode !== "warn" && mode !== "enforce") {
          return { text: "Usage: /contract mode observe|warn|enforce" };
        }
        await saveContract($, { ...spec, mode });
        return { text: `Contract mode: ${mode}.` };
      }
      case "violations": {
        const list = await $.store.get("violations");
        const rows = Array.isArray(list) ? list : [];
        return { text: rows.slice(-20).join("\n") || "No contract violations recorded." };
      }
      case "close":
        await saveContract($, { objective: "", allowed: [], forbidden: [], mode: spec.mode });
        return { text: "Contract closed." };
      default:
        return { text: "Usage: /contract show|set|allow|forbid|mode|violations|close" };
    }
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const denial = await guardWrite($, e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "change-contract failed closed on Edit." }
  );
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const denial = await guardWrite($, e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "change-contract failed closed on Write." }
  );
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, status);
    if (!current.active || current.violations === 0) return next(e);
    return band($.ui.resolve(e), "contract", [
      {
        text: `✗ ${current.violations} write${current.violations === 1 ? "" : "s"} outside scope`,
        tone: "error",
        bold: true
      },
      { text: `${current.mode} mode`, tone: "subtle" },
      { text: "/contract show", tone: "suggestion" }
    ]);
  });
}
export {
  register
};
