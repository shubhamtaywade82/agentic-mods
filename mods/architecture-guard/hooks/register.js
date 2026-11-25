// mods/architecture-guard/src/register.tsx
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

// packages/core/src/git.ts
function parseNameList(output) {
  return output.split(/[\0\n]/).map((path) => path.trim()).filter((path) => path.length > 0);
}

// packages/core/src/governance.ts
function layerOf(path, layers) {
  const normalized = normalizePath(path);
  for (const layer of layers) {
    if (layer.paths.some((glob) => globToRegExp(glob).test(normalized))) return layer;
  }
  return null;
}
function violationKey(fromPath, toPath) {
  return `${normalizePath(fromPath)} -> ${normalizePath(toPath)}`;
}
function findLayerViolations(layers, fromPath, importedPaths) {
  const from = layerOf(fromPath, layers);
  if (from === null) return [];
  const violations = [];
  for (const toPath of importedPaths) {
    const to = layerOf(toPath, layers);
    if (to === null || to.name === from.name) continue;
    if (from.mayDependOn.includes(to.name)) continue;
    violations.push({
      fromPath: normalizePath(fromPath),
      fromLayer: from.name,
      toPath: normalizePath(toPath),
      toLayer: to.name,
      key: violationKey(fromPath, toPath)
    });
  }
  return violations;
}
function newViolations(found, baseline) {
  return found.filter((item) => !baseline.has(item.key));
}
function architectureDecision(mode, fresh) {
  if (fresh.length === 0) {
    return { decision: "allow", policyId: "architecture-guard", message: "no new violations" };
  }
  const first = fresh[0];
  const summary = fresh.slice(0, 3).map((item) => `${item.fromPath} (${item.fromLayer}) imports ${item.toPath} (${item.toLayer})`).join("; ");
  return violation(
    mode,
    "architecture-guard",
    `new layer violation${fresh.length === 1 ? "" : "s"}: ${summary}`,
    first === void 0 ? void 0 : `Move the dependency behind an interface owned by ${first.fromLayer}, or record it in the baseline with a reason.`
  );
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/imports.ts
var TS_IMPORT = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
var PY_FROM = /^\s*from\s+([.\w]+)\s+import\b/gm;
var PY_IMPORT = /^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm;
var JAVA_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?\s*;/gm;
var GO_SINGLE = /^\s*import\s+"([^"]+)"/gm;
var GO_BLOCK = /import\s*\(([\s\S]*?)\)/g;
var GO_QUOTED = /"([^"]+)"/g;
var RUST_USE = /^\s*(?:pub\s+)?use\s+([\w:]+)/gm;
var CSHARP_USING = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm;
function collect(pattern, source, group = 1) {
  const found = [];
  for (const match of source.matchAll(pattern)) {
    const value = match[group];
    if (value !== void 0 && value.length > 0) found.push(value);
  }
  return found;
}
function extractImports(language, source) {
  let found;
  switch (language) {
    case "typescript":
      found = collect(TS_IMPORT, source);
      break;
    case "python":
      found = [
        ...collect(PY_FROM, source),
        ...collect(PY_IMPORT, source).flatMap(
          (list) => list.split(",").map((item) => item.trim().replace(/\s+as\s+\w+$/, ""))
        )
      ];
      break;
    case "java":
      found = collect(JAVA_IMPORT, source);
      break;
    case "go": {
      found = collect(GO_SINGLE, source);
      for (const block of source.matchAll(GO_BLOCK)) {
        found.push(...collect(GO_QUOTED, block[1] ?? ""));
      }
      break;
    }
    case "rust":
      found = collect(RUST_USE, source);
      break;
    case "csharp":
      found = collect(CSHARP_USING, source);
      break;
  }
  return [...new Set(found)];
}
function dirname(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
function normalizeSegments(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
var TS_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
function resolveTypeScriptImport(fromFile, specifier, known) {
  if (!specifier.startsWith(".")) return null;
  const base = normalizeSegments(`${dirname(fromFile)}/${specifier}`);
  const stripped = base.replace(/\.(m|c)?jsx?$/, "");
  const candidates = [];
  for (const suffix of TS_SUFFIXES) candidates.push(`${base}${suffix}`);
  for (const suffix of [".ts", ".tsx", ".mts", ".cts"]) candidates.push(`${stripped}${suffix}`);
  for (const suffix of ["/index.ts", "/index.tsx", "/index.js"]) candidates.push(`${base}${suffix}`);
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}
function resolveJavaImport(specifier, known) {
  const relative = `${specifier.replace(/\./g, "/")}.java`;
  for (const path of known) {
    if (path === relative || path.endsWith(`/${relative}`)) return path;
  }
  return null;
}

// mods/architecture-guard/src/register.tsx
var PANE = "architecture-guard";
var MAX_SCAN_FILES = 2e3;
var MAX_BYTES = 3e5;
var TS_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
var JAVA_FILE = /\.java$/;
var IDLE = {
  verdict: "UNKNOWN",
  reason: "not scanned yet",
  fresh: 0,
  baseline: 0
};
var status = atom({ plugin: "architecture-guard", key: "status" }, IDLE, {
  shape: "status-1"
});
function languageOf(path) {
  if (TS_FILE.test(path)) return "typescript";
  if (JAVA_FILE.test(path)) return "java";
  return null;
}
async function knownFiles($) {
  const cached = await $.store.get("known");
  if (Array.isArray(cached)) return new Set(cached);
  const result = await $.process.run(["git", "ls-files", "-z"]);
  const files = result.exitCode === 0 ? parseNameList(result.stdout) : [];
  await $.store.set("known", files);
  return new Set(files);
}
async function baselineOf($, file) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath(file)));
    const list = Array.isArray(parsed.violations) ? parsed.violations : [];
    return new Set(list.filter((item) => typeof item === "string"));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function targetsOf(path, content, known) {
  const language = languageOf(path);
  if (language === null) return [];
  const specifiers = extractImports(language, content);
  const targets = [];
  for (const specifier of specifiers) {
    const target = language === "typescript" ? resolveTypeScriptImport(path, specifier, known) : resolveJavaImport(specifier, known);
    if (target !== null && target !== path) targets.push(target);
  }
  return targets;
}
async function judge($, path, content) {
  const config = (await loadConfig((p) => $.fs.read(p))).value.architecture;
  if (config.layers.length === 0 || languageOf(path) === null) return allowed("architecture-guard");
  const known = await knownFiles($);
  const found = findLayerViolations(config.layers, path, targetsOf(path, content, known));
  const fresh = newViolations(found, await baselineOf($, config.baselineFile));
  const decision = architectureDecision(config.mode, fresh);
  const verdict = fresh.length === 0 ? "PASS" : config.mode === "enforce" ? "FAIL" : "UNKNOWN";
  await update($, status, (current) => ({
    ...current,
    verdict,
    reason: fresh.length === 0 ? "no new layer violations" : `${fresh.length} new layer violation(s)`,
    fresh: fresh.length
  }));
  return decision;
}
async function scan($) {
  const config = (await loadConfig((p) => $.fs.read(p))).value.architecture;
  if (config.layers.length === 0) return "No layers configured in .agentic-mods/config.json.";
  await $.store.delete("known");
  const known = await knownFiles($);
  const sources = [...known].filter((path) => languageOf(path) !== null).slice(0, MAX_SCAN_FILES);
  const all = [];
  for (const path of sources) {
    try {
      if ((await $.fs.stat(path)).size > MAX_BYTES) continue;
      const content = await $.fs.read(path);
      const found = findLayerViolations(config.layers, path, targetsOf(path, content, known));
      for (const item of found) all.push(item.key);
    } catch {
    }
  }
  await $.fs.write(
    stateRelativePath(config.baselineFile),
    `${JSON.stringify({ violations: [...new Set(all)].sort() }, null, 2)}
`
  );
  await update($, status, (current) => ({
    ...current,
    verdict: "PASS",
    reason: "baseline recorded; only new violations are reported",
    baseline: new Set(all).size
  }));
  return `Scanned ${sources.length} file(s); baseline records ${new Set(all).size} existing violation(s).`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "architecture",
      description: "Architecture layer checks: /architecture scan (records the baseline) or /architecture status"
    });
    return next(e);
  });
  on("command.run", { command: "architecture" }, async ($, e) => {
    const subcommand = e.args.trim();
    if (subcommand === "scan") return { text: await scan($) };
    const current = await read($, status);
    return {
      text: `architecture: ${current.verdict} · ${current.reason} · baseline ${current.baseline}`
    };
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    if (languageOf(e.file_path) === null) return next(e);
    const decision = await judge($, e.file_path, e.new_string);
    if (decision.decision === "block") return { deny: describeDecision(decision) };
    if (decision.decision === "warn") $.ui.toast(describeDecision(decision));
    return next(e);
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "architecture-guard failed closed on Edit." }
  );
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    if (languageOf(e.file_path) === null) return next(e);
    const decision = await judge($, e.file_path, e.content);
    if (decision.decision === "block") return { deny: describeDecision(decision) };
    if (decision.decision === "warn") $.ui.toast(describeDecision(decision));
    return next(e);
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "architecture-guard failed closed on Write." }
  );
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const current = await read($, status);
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, null, "Architecture: ", current.verdict), /* @__PURE__ */ h(Text, { dimColor: true }, current.reason, " · baseline ", current.baseline));
  });
}
export {
  register
};
