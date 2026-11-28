// mods/markdown-preview/src/register.tsx
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

// packages/core/src/classify.ts
var CHECKS = ["build", "test", "strength", "lint", "typecheck", "security"];
function isCheckName(value) {
  return typeof value === "string" && CHECKS.includes(value);
}

// packages/core/src/strength.ts
var DEFAULT_STRENGTH_SETTINGS = {
  enabled: false,
  threshold: 60,
  budgetMs: 12e4,
  scope: "diff"
};

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
      runTimeoutMs: 3e5,
      strength: { ...DEFAULT_STRENGTH_SETTINGS }
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
  const asBoolean = (candidate) => typeof candidate === "boolean" ? candidate : void 0;
  const asThreshold = (candidate) => typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0 && candidate <= 100 ? candidate : void 0;
  const asBudgetMs = (candidate) => typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0 ? candidate : void 0;
  const asStrengthScope = (candidate) => candidate === "diff" || candidate === "suite" ? candidate : void 0;
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
  const requiredRaw = read2(
    evidence,
    "evidence",
    "required",
    (candidate) => {
      if (!Array.isArray(candidate) || !candidate.every(isCheckName)) return void 0;
      return candidate.filter(isCheckName);
    },
    value.evidence.required
  );
  const strengthSection = section(evidence, "strength");
  value.evidence.strength = {
    enabled: read2(strengthSection, "evidence.strength", "enabled", asBoolean, DEFAULT_STRENGTH_SETTINGS.enabled),
    threshold: read2(strengthSection, "evidence.strength", "threshold", asThreshold, DEFAULT_STRENGTH_SETTINGS.threshold),
    budgetMs: read2(strengthSection, "evidence.strength", "budgetMs", asBudgetMs, DEFAULT_STRENGTH_SETTINGS.budgetMs),
    scope: read2(strengthSection, "evidence.strength", "scope", asStrengthScope, DEFAULT_STRENGTH_SETTINGS.scope)
  };
  if (requiredRaw.includes("strength") && !value.evidence.strength.enabled) {
    errors.push(
      'evidence.required names "strength" but evidence.strength is not enabled; the strength check is skipped'
    );
    value.evidence.required = requiredRaw.filter((check) => check !== "strength");
  } else {
    value.evidence.required = requiredRaw;
  }
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

// packages/core/src/ui.tsx
function header(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }, /* @__PURE__ */ h(Text, { weight: "bold", color: "claude" }, "◆ ", input.title), /* @__PURE__ */ h(Box, { flexDirection: "row", gap: 1 }, input.meta === void 0 ? null : /* @__PURE__ */ h(Text, { dimColor: true }, input.meta), input.badge ?? null));
}
function empty(kit, text, hint) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, { dimColor: true, italic: true }, text), hint === void 0 ? null : /* @__PURE__ */ h(Text, { color: "suggestion" }, "→ ", hint));
}

// mods/markdown-preview/src/register.tsx
var PANE = "markdown-preview";
var MAX_BYTES = 2e5;
var IDLE = { path: "", text: "" };
var document = atom({ plugin: "markdown-preview", key: "document" }, IDLE, {
  shape: "document-1"
});
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "preview",
      description: "Render a repository Markdown file in a pane: /preview <path>"
    });
    return next(e);
  });
  on("command.run", { command: "preview" }, async ($, e) => {
    const path = normalizePath(e.args.trim());
    if (path === "" || isAbsolutePath(path) || hasParentSegment(path)) {
      return { text: "Usage: /preview <relative path inside the repository>" };
    }
    const config = (await loadConfig((p) => $.fs.read(p))).value.guard;
    if (isProtectedPath(path, config.protectedPaths, config.protectedExceptions)) {
      return { text: `${path} is a protected secret file and is not rendered.` };
    }
    let text;
    try {
      const stat = await $.fs.stat(path);
      if (stat.kind !== "file" || stat.size > MAX_BYTES) {
        return { text: `${path} is not a readable file under ${MAX_BYTES} bytes.` };
      }
      text = await $.fs.read(path);
    } catch {
      return { text: `${path} does not exist or cannot be read.` };
    }
    await update($, document, () => ({ path, text }));
    await $.ui.open({ id: PANE, title: "Preview" });
    return { text: `Previewing ${path}.` };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e);
    const { Box, Markdown } = kit;
    const current = await read($, document);
    if (current.path === "") return empty(kit, "No document open.", "/preview <file.md>");
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, header(kit, { title: current.path.split("/").pop() ?? current.path, meta: current.path }), /* @__PURE__ */ h(Markdown, { key: "document", text: current.text }));
  });
}
export {
  register
};