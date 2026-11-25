// mods/dependency-radar/src/register.tsx
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

// packages/core/src/manifests.ts
var MANIFEST_FILES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts"
];
function isManifestFile(path) {
  const name = path.replace(/^.*\//, "");
  return MANIFEST_FILES.includes(name) || name.endsWith(".csproj");
}
function parseManifest(path, text) {
  const name = path.replace(/^.*\//, "");
  if (name === "package.json") return parsePackageJson(text);
  if (name === "requirements.txt") return parseRequirements(text);
  if (name === "pyproject.toml") return parsePyproject(text);
  if (name === "go.mod") return parseGoMod(text);
  if (name === "Cargo.toml") return parseCargo(text);
  if (name === "pom.xml") return parseMaven(text);
  if (name === "build.gradle" || name === "build.gradle.kts") return parseGradle(text);
  if (name.endsWith(".csproj")) return parseCsproj(text);
  return [];
}
function parsePackageJson(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("package.json is not an object");
  const record = parsed;
  const out = [];
  for (const [key, isDev] of [
    ["dependencies", false],
    ["devDependencies", true]
  ]) {
    const block = record[key];
    if (typeof block !== "object" || block === null) continue;
    for (const [name, version] of Object.entries(block)) {
      if (typeof version === "string") out.push({ name, version, isDev, ecosystem: "npm" });
    }
  }
  return out;
}
function parseRequirements(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (line === "" || line.startsWith("-")) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*(.*)$/.exec(line);
    if (match === null) continue;
    out.push({
      name: match[1] ?? "",
      version: (match[2] ?? "").trim(),
      isDev: false,
      ecosystem: "pypi"
    });
  }
  return out;
}
function parsePyproject(text) {
  const block = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
  if (block === null) return [];
  const out = [];
  for (const match of (block[1] ?? "").matchAll(/"([^"]+)"/g)) {
    const spec = match[1] ?? "";
    const parsed = /^([A-Za-z0-9_.-]+)\s*(.*)$/.exec(spec.trim());
    if (parsed === null) continue;
    out.push({
      name: parsed[1] ?? "",
      version: (parsed[2] ?? "").trim(),
      isDev: false,
      ecosystem: "pypi"
    });
  }
  return out;
}
function parseGoMod(text) {
  const out = [];
  const addLine = (line) => {
    const match = /^\s*([^\s]+)\s+(v[^\s]+)/.exec(line.replace(/\/\/.*$/, ""));
    if (match !== null) {
      out.push({ name: match[1] ?? "", version: match[2] ?? "", isDev: false, ecosystem: "go" });
    }
  };
  for (const block of text.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) {
    for (const line of (block[1] ?? "").split("\n")) addLine(line);
  }
  for (const single of text.matchAll(/^require\s+([^(\n]+)$/gm)) addLine(single[1] ?? "");
  return out;
}
function parseCargo(text) {
  const out = [];
  let section = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      if (line === "[dependencies]") section = "dependencies";
      else if (line === "[dev-dependencies]") section = "dev-dependencies";
      else section = null;
      continue;
    }
    if (section === null || line === "" || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (match === null) continue;
    const value = (match[2] ?? "").trim();
    const version = /"([^"]+)"/.exec(value)?.[1] ?? value;
    out.push({
      name: match[1] ?? "",
      version,
      isDev: section === "dev-dependencies",
      ecosystem: "cargo"
    });
  }
  return out;
}
function parseMaven(text) {
  const out = [];
  for (const block of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = block[1] ?? "";
    const group = /<groupId>([^<]+)<\/groupId>/.exec(body)?.[1];
    const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(body)?.[1];
    const version = /<version>([^<]+)<\/version>/.exec(body)?.[1] ?? "managed";
    const scope = /<scope>([^<]+)<\/scope>/.exec(body)?.[1];
    if (group === void 0 || artifact === void 0) continue;
    out.push({
      name: `${group}:${artifact}`,
      version,
      isDev: scope === "test",
      ecosystem: "maven"
    });
  }
  return out;
}
function parseGradle(text) {
  const out = [];
  const pattern = /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly)\s*\(?\s*['"]([^:'"]+):([^:'"]+):([^'"]+)['"]/gm;
  for (const match of text.matchAll(pattern)) {
    out.push({
      name: `${match[2] ?? ""}:${match[3] ?? ""}`,
      version: match[4] ?? "",
      isDev: (match[1] ?? "").startsWith("test"),
      ecosystem: "gradle"
    });
  }
  return out;
}
function parseCsproj(text) {
  const out = [];
  for (const match of text.matchAll(
    /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g
  )) {
    out.push({
      name: match[1] ?? "",
      version: match[2] ?? "managed",
      isDev: false,
      ecosystem: "nuget"
    });
  }
  return out;
}
function majorOf(version) {
  const match = /(\d+)/.exec(version);
  return match?.[1] === void 0 ? null : Number(match[1]);
}
function diffDependencies(before, after) {
  const key = (dep) => `${dep.ecosystem}:${dep.isDev ? "dev" : "run"}:${dep.name}`;
  const beforeMap = new Map(before.map((dep) => [key(dep), dep]));
  const afterMap = new Map(after.map((dep) => [key(dep), dep]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, dep] of afterMap) {
    const prior = beforeMap.get(id);
    if (prior === void 0) {
      added.push(dep);
      continue;
    }
    if (prior.version !== dep.version) {
      const fromMajor = majorOf(prior.version);
      const toMajor = majorOf(dep.version);
      changed.push({
        name: dep.name,
        from: prior.version,
        to: dep.version,
        isMajor: fromMajor !== null && toMajor !== null && fromMajor !== toMajor
      });
    }
  }
  for (const [id, dep] of beforeMap) {
    if (!afterMap.has(id)) removed.push(dep);
  }
  return { added, removed, changed };
}

// mods/dependency-radar/src/register.tsx
var IDLE = { verdict: "UNKNOWN", changes: [], scan: "no scan recorded" };
var status = atom({ plugin: "dependency-radar", key: "status" }, IDLE, {
  shape: "status-1"
});
async function readOrNull($, path) {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}
function parseOrNull(path, text) {
  if (text === null) return [];
  try {
    return parseManifest(path, text);
  } catch {
    return null;
  }
}
async function analyse($, path, before, after) {
  const previous = parseOrNull(path, before);
  const current = parseOrNull(path, after);
  if (previous === null || current === null) {
    await update($, status, (state) => ({
      ...state,
      verdict: "UNKNOWN",
      changes: [`${path}: could not be parsed; review it by hand`]
    }));
    return;
  }
  const diff = diffDependencies(previous, current);
  const changes = [
    ...diff.added.map((dep) => `+ ${dep.name} ${dep.version}${dep.isDev ? " (dev)" : ""}`),
    ...diff.removed.map((dep) => `- ${dep.name} ${dep.version}`),
    ...diff.changed.map(
      (item) => `${item.isMajor ? "MAJOR " : ""}~ ${item.name} ${item.from} -> ${item.to}`
    )
  ].map((line) => truncate(`${path}: ${line}`, 200));
  const verdict = changes.length === 0 ? "PASS" : "UNKNOWN";
  await update($, status, (state) => ({ ...state, verdict, changes: changes.slice(0, 50) }));
  for (const item of diff.changed) {
    if (item.isMajor)
      $.ui.toast(`dependency-radar: major change to ${item.name}; review before release`);
  }
}
async function readScan($) {
  let parsed;
  try {
    parsed = JSON.parse(await $.fs.read(stateRelativePath("scans/latest.json")));
  } catch {
    return "no scan recorded (.agentic-mods/scans/latest.json)";
  }
  if (!Array.isArray(parsed)) return "scan file is not a list; ignored";
  const entries = parsed.filter(
    (item) => typeof item === "object" && item !== null && typeof item.name === "string" && typeof item.severity === "string"
  );
  const serious = entries.filter((item) => item.severity === "high" || item.severity === "critical");
  const verdict = serious.length > 0 ? "FAIL" : "PASS";
  const summary = `${entries.length} finding(s), ${serious.length} high or critical`;
  await update($, status, (state) => ({ ...state, verdict, scan: summary }));
  return summary;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "radar",
      description: "Read the recorded dependency scan: /radar scan"
    });
    return next(e);
  });
  on("command.run", { command: "radar" }, async ($) => ({ text: `scan: ${await readScan($)}` }));
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const path = normalizePath(e.file_path);
    if (!isManifestFile(path)) return next(e);
    const before = await readOrNull($, path);
    const ran = await next(e);
    if (ran.deny === void 0) await analyse($, path, before, await readOrNull($, path));
    return ran;
  });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const path = normalizePath(e.file_path);
    if (!isManifestFile(path)) return next(e);
    const before = await readOrNull($, path);
    const ran = await next(e);
    if (ran.deny === void 0) await analyse($, path, before, await readOrNull($, path));
    return ran;
  });
}
export {
  register
};
