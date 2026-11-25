// mods/contract-compatibility-guard/src/register.tsx
import { atom, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
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

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

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

// mods/contract-compatibility-guard/src/register.tsx
var CONTRACT_FILE = /(openapi|swagger)[^/]*\.(ya?ml|json)$|\.proto$|schema\.graphql$|asyncapi[^/]*\.(ya?ml|json)$/i;
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no compatibility check run" };
var gate = atom({ plugin: "contract-compatibility-guard", key: "gate" }, IDLE, { shape: "gate-1" });
async function commandsOf($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath("compat.json")));
    const out = {};
    for (const [name, argv] of Object.entries(parsed)) {
      if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === "string")) {
        out[name] = [...argv];
      }
    }
    return out;
  } catch {
    return {};
  }
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "compat",
      description: "Compatibility checks: /compat run [name] (tools from .agentic-mods/compat.json)"
    });
    return next(e);
  });
  on("command.run", { command: "compat" }, async ($, e) => {
    const [subcommand = "run", only = ""] = e.args.trim().split(/\s+/);
    if (subcommand !== "run") return { text: "Usage: /compat run [name]" };
    const commands = await commandsOf($);
    const names = only === "" ? Object.keys(commands) : [only];
    if (names.length === 0 || names.some((name) => commands[name] === void 0)) {
      return { text: 'No compatibility tool configured. Add {"name": ["argv", ...]} to .agentic-mods/compat.json.' };
    }
    const lines = [];
    let verdict = "PASS";
    for (const name of names) {
      const argv = commands[name] ?? [];
      const result = await $.process.run(argv, { timeoutMs: 3e5 });
      if (result.exitCode !== 0) verdict = "FAIL";
      const tail = redact(`${result.stdout}
${result.stderr}`).split("\n").slice(-6).join("\n");
      lines.push(`${name}: ${result.exitCode === 0 ? "compatible" : `incompatible or error (exit ${result.exitCode})`}`);
      if (result.exitCode !== 0) lines.push(truncate(tail, 800));
    }
    await update($, gate, () => ({
      verdict,
      phase: "checked",
      reason: truncate(`${names.length} tool(s) run: ${names.join(", ")}`, 200)
    }));
    return { text: lines.join("\n") };
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    if (CONTRACT_FILE.test(e.file_path)) {
      $.ui.toast("contract-compatibility-guard: a schema changed. Run /compat run before the review gate.");
    }
    return next(e);
  });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    if (CONTRACT_FILE.test(e.file_path)) {
      $.ui.toast("contract-compatibility-guard: a schema changed. Run /compat run before the review gate.");
    }
    return next(e);
  });
}
export {
  register
};
