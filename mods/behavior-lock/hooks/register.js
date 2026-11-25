// mods/behavior-lock/src/register.tsx
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

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// packages/core/src/surface.ts
var EXPORT_DECL = /^export\s+(?:declare\s+)?(async\s+)?(function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
var EXPORT_DEFAULT = /^export\s+default\b/;
var EXPORT_LIST = /^export\s*\{([^}]*)\}/;
function extractSurface(source) {
  const entries = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const declaration = EXPORT_DECL.exec(line);
    if (declaration !== null) {
      entries.push({
        name: declaration[3] ?? "",
        signature: line.replace(/\s*\{?\s*$/, "").slice(0, 300)
      });
      continue;
    }
    if (EXPORT_DEFAULT.test(line)) {
      entries.push({ name: "default", signature: line.slice(0, 300) });
      continue;
    }
    const list = EXPORT_LIST.exec(line);
    if (list !== null) {
      for (const part of (list[1] ?? "").split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop() ?? "";
        if (name !== "") entries.push({ name, signature: `re-export ${name}` });
      }
    }
  }
  return entries;
}
function diffSurface(before, after) {
  const beforeMap = new Map(before.map((entry) => [entry.name, entry.signature]));
  const afterMap = new Map(after.map((entry) => [entry.name, entry.signature]));
  const removed = [...beforeMap.keys()].filter((name) => !afterMap.has(name)).sort();
  const added = [...afterMap.keys()].filter((name) => !beforeMap.has(name)).sort();
  const changed = [...beforeMap.keys()].filter((name) => afterMap.has(name) && beforeMap.get(name) !== afterMap.get(name)).sort();
  return { removed, changed, added };
}

// mods/behavior-lock/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no baseline captured" };
var gate = atom({ plugin: "behavior-lock", key: "gate" }, IDLE, { shape: "gate-1" });
async function surfaceOf($, files) {
  const out = {};
  for (const path of files) {
    out[path] = extractSurface(await $.fs.read(path));
  }
  return out;
}
function flatten(files) {
  return Object.entries(files).flatMap(
    ([file, entries]) => entries.map((entry) => ({ name: `${file}#${entry.name}`, signature: entry.signature }))
  );
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "lock",
      description: "Behavior lock: /lock capture <name> <files...> | /lock compare <name>"
    });
    return next(e);
  });
  on("command.run", { command: "lock" }, async ($, e) => {
    const [subcommand = "", name = "", ...files] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    if (!/^[a-z0-9-]{1,40}$/.test(name)) {
      return {
        text: "Usage: /lock capture|compare <name> [files...]. The name is lowercase letters, digits or dashes."
      };
    }
    const path = stateRelativePath(`behavior/${name}.json`);
    if (subcommand === "capture") {
      if (files.length === 0) return { text: "Name the files to capture." };
      const normalized = files.map(normalizePath);
      const baseline = { name, files: await surfaceOf($, normalized) };
      await $.fs.write(path, `${JSON.stringify(baseline, null, 2)}
`);
      const count = Object.values(baseline.files).reduce((sum, list) => sum + list.length, 0);
      await update($, gate, () => ({
        verdict: "PASS",
        phase: "baseline",
        reason: `${count} export(s) captured as ${name}`
      }));
      return { text: `Baseline ${name}: ${count} export(s) across ${normalized.length} file(s).` };
    }
    if (subcommand === "compare") {
      let baseline;
      try {
        baseline = JSON.parse(await $.fs.read(path));
      } catch {
        return { text: `No baseline named ${name}. Capture it first.` };
      }
      const current = await surfaceOf($, Object.keys(baseline.files));
      const diff = diffSurface(flatten(baseline.files), flatten(current));
      const breaking = diff.removed.length + diff.changed.length;
      await update($, gate, () => ({
        verdict: breaking === 0 ? "PASS" : "FAIL",
        phase: "compared",
        reason: truncate(
          `${diff.removed.length} removed, ${diff.changed.length} changed, ${diff.added.length} added`,
          200
        )
      }));
      const lines = [
        breaking === 0 ? "Surface matches the baseline (additions only)." : "Breaking surface change.",
        ...diff.removed.map((item) => `removed: ${item}`),
        ...diff.changed.map((item) => `changed: ${item}`),
        ...diff.added.map((item) => `added: ${item}`)
      ];
      return { text: lines.join("\n") };
    }
    return { text: "Usage: /lock capture|compare <name> [files...]" };
  });
}
export {
  register
};
