// mods/observability-verifier/src/register.tsx
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

// packages/core/src/util.ts
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
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
var CONFIG_PATH = `${STATE_DIR}/config.json`;
async function readJsonFile(read, path) {
  let text;
  try {
    text = await read(path);
  } catch {
    return { kind: "missing" };
  }
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "invalid", reason: `${path} is not valid JSON; fix or remove it` };
  }
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// mods/observability-verifier/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no health check run" };
var gate = atom({ plugin: "observability-verifier", key: "gate" }, IDLE, {
  shape: "gate-1"
});
async function checksOf($) {
  const file = await readJsonFile(
    (path) => $.fs.read(path),
    stateRelativePath("observability.json")
  );
  if (file.kind === "invalid") return { error: file.reason };
  if (file.kind === "missing" || !Array.isArray(file.value)) return [];
  return file.value.filter(
    (item) => typeof item === "object" && item !== null && typeof item.name === "string" && typeof item.url === "string" && typeof item.expectStatus === "number"
  );
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "observe",
      description: "Health checks after a change: /observe check"
    });
    return next(e);
  });
  on("command.run", { command: "observe" }, async ($, e) => {
    if (e.args.trim() !== "check") return { text: "Usage: /observe check" };
    const checks = await checksOf($);
    if (!Array.isArray(checks)) return { text: checks.error };
    if (checks.length === 0) {
      return {
        text: "No checks configured. Add a list of {name, url, expectStatus} to .agentic-mods/observability.json."
      };
    }
    const lines = [];
    let failures = 0;
    for (const check of checks) {
      try {
        const response = await $.http.fetch(check.url);
        const passed = response.status === check.expectStatus;
        if (!passed) failures++;
        lines.push(
          `${check.name}: ${passed ? "PASS" : "FAIL"} (${response.status}, expected ${check.expectStatus})`
        );
      } catch (error) {
        failures++;
        lines.push(
          `${check.name}: FAIL (${truncate(error instanceof Error ? error.message : "request failed", 120)})`
        );
      }
    }
    const verdict = failures === 0 ? "PASS" : "FAIL";
    await update($, gate, () => ({
      verdict,
      phase: "checked",
      reason: `${checks.length - failures}/${checks.length} health check(s) passed`
    }));
    return { text: lines.join("\n") };
  });
}
export {
  register
};
