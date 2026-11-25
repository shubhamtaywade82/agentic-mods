// mods/test-impact/src/register.tsx
import { atom, read, update } from "claude-code";

// packages/core/src/adapters.ts
var JS_TEST = /(^|\/)(__tests__\/|test\/|tests\/)|\.(test|spec)\.[cm]?[jt]sx?$/;
var JAVA_TEST = /(^|\/)src\/test\//;
var PY_TEST = /(^|\/)tests?\/|(^|\/)test_[^/]*\.py$|_test\.py$/;
var GO_TEST = /_test\.go$/;
var RUST_TEST = /(^|\/)tests\/[^/]+\.rs$/;
var DOTNET_TEST = /(^|\/)[^/]*\.(Tests?|UnitTests?|IntegrationTests?)(\/|$)|Tests?\.cs$/;
var ADAPTERS = {
  javascript: {
    id: "javascript",
    label: "JavaScript / TypeScript",
    language: "typescript",
    manifests: ["package.json"],
    isTestFile: (path) => JS_TEST.test(path)
  },
  java: {
    id: "java",
    label: "Java / Spring",
    language: "java",
    manifests: ["pom.xml", "build.gradle", "build.gradle.kts"],
    isTestFile: (path) => JAVA_TEST.test(path)
  },
  python: {
    id: "python",
    label: "Python",
    language: "python",
    manifests: ["pyproject.toml", "requirements.txt", "setup.py"],
    isTestFile: (path) => PY_TEST.test(path)
  },
  go: {
    id: "go",
    label: "Go",
    language: "go",
    manifests: ["go.mod"],
    isTestFile: (path) => GO_TEST.test(path)
  },
  rust: {
    id: "rust",
    label: "Rust",
    language: "rust",
    manifests: ["Cargo.toml"],
    isTestFile: (path) => RUST_TEST.test(path)
  },
  dotnet: {
    id: "dotnet",
    label: ".NET",
    language: "csharp",
    manifests: ["*.csproj", "*.sln"],
    isTestFile: (path) => DOTNET_TEST.test(path)
  }
};

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

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
function parseNameList(output) {
  return output.split(/[\0\n]/).map((path) => path.trim()).filter((path) => path.length > 0);
}
async function workingTreeChanges(run) {
  const result = await run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (result.exitCode !== 0) return null;
  return parseStatusZ(result.stdout);
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
function buildTypeScriptGraph(sources) {
  const known = new Set(sources.keys());
  const graph = /* @__PURE__ */ new Map();
  for (const [file, source] of sources) {
    const edges = /* @__PURE__ */ new Set();
    for (const specifier of extractImports("typescript", source)) {
      const target = resolveTypeScriptImport(file, specifier, known);
      if (target !== null && target !== file) edges.add(target);
    }
    graph.set(file, edges);
  }
  return graph;
}
function dependentsOf(graph, changed) {
  const reverse = /* @__PURE__ */ new Map();
  for (const [file, targets] of graph) {
    for (const target of targets) {
      const importers = reverse.get(target) ?? /* @__PURE__ */ new Set();
      importers.add(file);
      reverse.set(target, importers);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const queue = [...changed];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === void 0 || seen.has(next)) continue;
    seen.add(next);
    for (const importer of reverse.get(next) ?? []) {
      if (!seen.has(importer)) queue.push(importer);
    }
  }
  return seen;
}

// mods/test-impact/src/register.tsx
var PANE = "test-impact";
var MAX_FILES = 3e3;
var MAX_BYTES = 3e5;
var JS_SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
var SHARED_CONFIG = /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|tsconfig[^/]*\.json|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|babel\.config\.[cm]?[jt]s|eslint\.config\.[cm]?[jt]s|turbo\.json)$/;
var IDLE = { selection: [], untested: [], full: false, reason: "not computed yet" };
var impact = atom({ plugin: "test-impact", key: "impact" }, IDLE, { shape: "impact-1" });
function runnerOf($) {
  return async (argv) => {
    const result = await $.process.run(argv);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}
function fullSuite(reason) {
  return { selection: [], untested: [], full: true, reason };
}
async function readSources($, paths) {
  const sources = /* @__PURE__ */ new Map();
  let skipped = Math.max(0, paths.length - MAX_FILES);
  for (const path of paths.slice(0, MAX_FILES)) {
    try {
      if ((await $.fs.stat(path)).size <= MAX_BYTES) sources.set(path, await $.fs.read(path));
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { sources, skipped };
}
async function computeImpact($) {
  const run = runnerOf($);
  const tracked = await run(["git", "ls-files", "-z"]);
  if (tracked.exitCode !== 0) return fullSuite("not a git repository; run the full suite");
  const changed = await workingTreeChanges(run);
  if (changed === null) return fullSuite("git status failed, so the impact is unknown");
  const changedPaths = changed.map((entry) => entry.path);
  if (changedPaths.some((path) => SHARED_CONFIG.test(path))) {
    return fullSuite("shared configuration changed: run the full suite");
  }
  const candidates = /* @__PURE__ */ new Set([...parseNameList(tracked.stdout), ...changedPaths]);
  const { sources, skipped } = await readSources(
    $,
    [...candidates].filter((path) => JS_SOURCE.test(path))
  );
  const graph = buildTypeScriptGraph(sources);
  const isTest = ADAPTERS.javascript.isTestFile;
  const changedSource = changedPaths.filter((path) => sources.has(path));
  const reached = /* @__PURE__ */ new Set([...dependentsOf(graph, changedSource), ...changedSource]);
  const selection = [...reached].filter((path) => isTest(path)).sort();
  const untested = changedSource.filter((path) => !isTest(path)).filter((path) => ![...dependentsOf(graph, [path])].some((file) => isTest(file))).sort();
  const traced = changedSource.length === 0 ? "no JavaScript or TypeScript source changed" : `${changedSource.length} changed source file(s) traced through the import graph`;
  const reason = skipped > 0 ? `${traced}; ${skipped} file(s) too large or unreadable were left out` : traced;
  return { selection, untested, full: false, reason };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "impact",
      description: "Select the tests that the current changes reach"
    });
    return next(e);
  });
  on("command.run", { command: "impact" }, async ($) => {
    const result = await computeImpact($);
    await update($, impact, () => result);
    await $.ui.open({ id: PANE, title: "Test impact" });
    if (result.full) return { text: `Run the full suite: ${result.reason}` };
    const lines = [
      `${result.reason}`,
      `tests to run (${result.selection.length}): ${result.selection.join(", ") || "none reach the change"}`,
      `changed code with no test reaching it: ${result.untested.join(", ") || "none"}`
    ];
    return { text: lines.join("\n") };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const current = await read($, impact);
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, null, current.full ? "Full suite required" : "Targeted selection"), /* @__PURE__ */ h(Text, { dimColor: true }, current.reason), current.selection.map((path) => /* @__PURE__ */ h(Text, { key: `test-${path}` }, "test ", path)), current.untested.map((path) => /* @__PURE__ */ h(Text, { key: `gap-${path}` }, "gap ", path)));
  });
}
export {
  register
};
