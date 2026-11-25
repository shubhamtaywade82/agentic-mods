// mods/regression-orchestrator/src/register.tsx
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
async function workingTreeChanges(run) {
  const result = await run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (result.exitCode !== 0) return null;
  return parseStatusZ(result.stdout);
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/regression.ts
var DEFAULT_RISK_WEIGHTS = {
  publicApi: 30,
  schema: 30,
  sharedLibrary: 20,
  auth: 25,
  lockfile: 15,
  buildConfig: 20,
  manyFiles: 15,
  testsOnly: -10,
  docsOnly: -30
};
var PATTERNS = {
  publicApi: /(openapi|swagger|\.graphql$|\.proto$|(^|\/)(api|routes?|controllers?)\/)/i,
  sharedLibrary: /(^|\/)(packages|shared|lib)\//,
  auth: /(auth|login|session|jwt|oauth|permission|rbac)/i,
  lockfile: /(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock)$/,
  buildConfig: /(tsconfig[^/]*\.json|webpack[^/]*|vite\.config[^/]*|turbo\.json|build\.gradle[^/]*|pom\.xml|Makefile|Dockerfile)$/
};
var TEST_FILE = /(\.test\.|\.spec\.|(^|\/)tests?\/|_test\.(go|py)$|(^|\/)test_[^/]*\.py$)/;
var DOC_FILE = /\.(md|txt|rst|adoc)$/i;
var SCHEMA_FILE = /(^|\/)(migrations?|db\/migrate|prisma\/migrations|flyway|liquibase)(\/|$)|\.sql$/i;
function riskLevelOf(score) {
  if (score >= 60) return "full";
  if (score >= 40) return "cross-component";
  if (score >= 20) return "component";
  return "targeted";
}
function assessRegression(changed, weights = DEFAULT_RISK_WEIGHTS) {
  const reasons = [];
  let score = 0;
  const add = (factor, reason) => {
    score += weights[factor];
    reasons.push(`${weights[factor] >= 0 ? "+" : ""}${weights[factor]}  ${reason}`);
  };
  const paths = changed.map((path) => path.replace(/\\/g, "/"));
  if (paths.some((path) => PATTERNS.publicApi.test(path)))
    add("publicApi", "public API or contract file changed");
  if (paths.some((path) => SCHEMA_FILE.test(path)))
    add("schema", "database schema or migration changed");
  if (paths.some((path) => PATTERNS.sharedLibrary.test(path)))
    add("sharedLibrary", "shared library code changed");
  if (paths.some((path) => PATTERNS.auth.test(path)))
    add("auth", "authentication or authorization code changed");
  if (paths.some((path) => PATTERNS.lockfile.test(path)))
    add("lockfile", "dependency lockfile changed");
  if (paths.some((path) => PATTERNS.buildConfig.test(path)))
    add("buildConfig", "build configuration changed");
  if (paths.length > 20) add("manyFiles", `${paths.length} files changed`);
  if (paths.length > 0 && paths.every((path) => TEST_FILE.test(path)))
    add("testsOnly", "only test files changed");
  if (paths.length > 0 && paths.every((path) => DOC_FILE.test(path)))
    add("docsOnly", "only documentation changed");
  const clamped = Math.max(0, Math.min(100, score));
  const level = riskLevelOf(clamped);
  const requires = requiredChecks(level);
  return { score: clamped, level, reasons: [`score ${clamped} (${level})`, ...reasons], requires };
}
function requiredChecks(level) {
  switch (level) {
    case "targeted":
      return ["unit-targeted"];
    case "component":
      return ["unit-targeted", "component-suite"];
    case "cross-component":
      return ["unit-targeted", "component-suite", "consumer-compatibility", "api-contract"];
    case "full":
      return ["full-suite"];
  }
}

// mods/regression-orchestrator/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no regression scope run" };
var gate = atom({ plugin: "regression-orchestrator", key: "gate" }, IDLE, {
  shape: "gate-1"
});
function runnerOf($) {
  return async (argv) => {
    const result = await $.process.run(argv);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}
async function commandsOf($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath("regression.json")));
    const commands = parsed.commands;
    if (typeof commands !== "object" || commands === null) return {};
    const out = {};
    for (const [name, argv] of Object.entries(commands)) {
      if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === "string")) {
        out[name] = [...argv];
      }
    }
    return out;
  } catch {
    return {};
  }
}
async function assess($) {
  const changes = await workingTreeChanges(runnerOf($));
  if (changes === null) return null;
  return assessRegression(changes.map((change) => change.path));
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "regression",
      description: "Regression scope: /regression assess | /regression run"
    });
    return next(e);
  });
  on("command.run", { command: "regression" }, async ($, e) => {
    const subcommand = e.args.trim() || "assess";
    if (subcommand === "assess") {
      const risk = await assess($);
      if (risk === null) return { text: "Not a git repository; the scope cannot be assessed." };
      await $.store.set("assessment", risk);
      return { text: [...risk.reasons, `required: ${risk.requires.join(", ")}`].join("\n") };
    }
    if (subcommand === "run") {
      const risk = await assess($) ?? null;
      if (risk === null) return { text: "Not a git repository; nothing was run." };
      const commands = await commandsOf($);
      const results = [];
      let verdict = "PASS";
      for (const name of risk.requires) {
        const argv = commands[name];
        if (argv === void 0) {
          verdict = verdict === "FAIL" ? "FAIL" : "UNKNOWN";
          results.push(`${name}: not configured in .agentic-mods/regression.json`);
          continue;
        }
        const result = await $.process.run(argv, { timeoutMs: 6e5 });
        if (result.exitCode !== 0) verdict = "FAIL";
        results.push(
          `${name}: ${result.exitCode === 0 ? "passed" : `failed (exit ${result.exitCode})`}`
        );
      }
      await update($, gate, () => ({
        verdict,
        phase: "ran",
        reason: `${risk.level} scope: ${risk.requires.length} check(s)`
      }));
      return {
        text: [`regression ${risk.level} (score ${risk.score}): ${verdict}`, ...results].join("\n")
      };
    }
    return { text: "Usage: /regression assess | /regression run" };
  });
}
export {
  register
};
