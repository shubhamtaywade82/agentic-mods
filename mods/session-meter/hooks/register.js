// mods/session-meter/src/register.tsx
import { atom, read, update } from "claude-code";

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

// packages/core/src/session.ts
function levelOf(percent, warnAt, criticalAt) {
  if (percent >= criticalAt) return "critical";
  if (percent >= warnAt) return "warn";
  return "ok";
}
function formatPercent(percent) {
  return `${Math.round(percent * 10) / 10}%`;
}
function formatUsd(usd) {
  return `$${usd.toFixed(2)}`;
}
function rateLevel(percentUsed, warnAt) {
  if (percentUsed >= 100) return "critical";
  return percentUsed >= warnAt ? "warn" : "ok";
}

// mods/session-meter/src/register.tsx
var IDLE = { contextPercent: null, usd: null, rateLimits: [], warning: null };
var meter = atom({ plugin: "session-meter", key: "meter" }, IDLE, { shape: "meter-1" });
function register(on) {
  on("session.measure", async ($, e, next) => {
    const config = (await loadConfig((path) => $.fs.read(path))).value.meter;
    const windowSize = e.context.window;
    const tokens = e.context.tokens ?? 0;
    const contextPercent = windowSize > 0 ? tokens / windowSize * 100 : null;
    const usd = e.cost?.usd ?? null;
    const rateLimits = e.rateLimits.map((limit) => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed
    }));
    const warnings = [];
    if (contextPercent !== null && levelOf(contextPercent, config.contextWarnPercent, config.contextCriticalPercent) !== "ok") {
      warnings.push(`context ${formatPercent(contextPercent)}`);
    }
    if (usd !== null && usd >= config.costWarnUsd) warnings.push(`cost ${formatUsd(usd)}`);
    for (const limit of rateLimits) {
      if (rateLevel(limit.percentUsed, config.rateWarnPercent) !== "ok") {
        warnings.push(`${limit.kind} ${formatPercent(limit.percentUsed)}`);
      }
    }
    const warning = warnings.length > 0 ? warnings.join(", ") : null;
    const previous = await read($, meter);
    await update($, meter, () => ({ contextPercent, usd, rateLimits, warning }));
    if (warning !== null && warning !== previous.warning) {
      $.ui.toast(`session-meter: ${warning}`);
    }
    return next(e);
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const state = await read($, meter);
    if (state.contextPercent === null && state.usd === null && state.rateLimits.length === 0) {
      return next(e);
    }
    const { Box, Text } = $.ui.resolve(e);
    const parts = [];
    if (state.contextPercent !== null) parts.push(`context ${formatPercent(state.contextPercent)}`);
    if (state.usd !== null) parts.push(`cost ${formatUsd(state.usd)}`);
    for (const limit of state.rateLimits)
      parts.push(`${limit.kind} ${formatPercent(limit.percentUsed)}`);
    return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, { dimColor: state.warning === null }, parts.join(" · "), state.warning === null ? "" : ` · warning: ${state.warning}`));
  });
}
export {
  register
};
