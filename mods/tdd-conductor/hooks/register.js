// mods/tdd-conductor/src/register.tsx
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

// packages/core/src/tdd.ts
var ENVIRONMENT = /Cannot find module|MODULE_NOT_FOUND|ModuleNotFoundError|ImportError|SyntaxError|error TS\d+|Could not resolve|command not found|ENOENT|ECONNREFUSED|compilation failed|cannot find symbol|undefined reference/i;
var BEHAVIORAL = /AssertionError|AssertionFailed|expect\(|toBe\(|toEqual\(|Expected|Received|assert(ion)?\s|\bFAIL\b|\d+ failed|failures?:\s*[1-9]/i;
function classifyFailure(stdout, stderr) {
  const text = `${stdout}
${stderr}`;
  if (ENVIRONMENT.test(text)) return "environment";
  if (BEHAVIORAL.test(text)) return "behavioral";
  return "unknown";
}
function nextPhase(current, event) {
  switch (event) {
    case "red-verified":
      if (current === "idle" || current === "refactor" || current === "complete")
        return { ok: true, phase: "red" };
      return { ok: false, reason: `RED is not valid from ${current}` };
    case "green-verified":
      if (current === "red") return { ok: true, phase: "green" };
      if (current === "refactor") return { ok: true, phase: "refactor" };
      return { ok: false, reason: `GREEN is not valid from ${current}` };
    case "refactor":
      if (current === "green") return { ok: true, phase: "refactor" };
      return { ok: false, reason: `REFACTOR needs GREEN first; now ${current}` };
    case "complete":
      if (current === "green" || current === "refactor") return { ok: true, phase: "complete" };
      return { ok: false, reason: `a cycle completes from GREEN or REFACTOR; now ${current}` };
    case "red-rejected":
    case "green-rejected":
    case "exception":
      return { ok: true, phase: current };
  }
}
function productionWriteAllowed(phase) {
  return phase === "red" || phase === "refactor";
}
var TEST_PATH = /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/|_test\.(go|py)$|(^|\/)test_[^/]*\.py$)/;
function isTestPath(path) {
  return TEST_PATH.test(path.replace(/\\/g, "/"));
}

// mods/tdd-conductor/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "idle", reason: "no TDD cycle started" };
var gate = atom({ plugin: "tdd-conductor", key: "gate" }, IDLE, { shape: "gate-1" });
async function commandOf($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath("tdd.json")));
    if (Array.isArray(parsed.command) && parsed.command.length > 0 && parsed.command.every((item) => typeof item === "string")) {
      return [...parsed.command];
    }
  } catch {
  }
  return null;
}
async function phaseOf($) {
  const value = await $.store.get("phase");
  return value === "red" || value === "green" || value === "refactor" || value === "complete" ? value : "idle";
}
async function publish($, phase, verdict, reason) {
  await $.store.set("phase", phase);
  await update($, gate, () => ({ verdict, phase, reason: truncate(reason, 200) }));
}
async function runTests($, testPath) {
  const command = await commandOf($);
  if (command === null)
    return 'No test command configured. Add {"command": [...]} to .agentic-mods/tdd.json.';
  if (testPath.startsWith("-")) return `Not a test path: ${testPath}`;
  try {
    const result = await $.process.run([...command, normalizePath(testPath)], {
      timeoutMs: 6e5
    });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return `Could not run the test command: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
async function guardProduction($, path) {
  if (isTestPath(path)) return null;
  const phase = await phaseOf($);
  if (productionWriteAllowed(phase)) return null;
  if (await $.store.get("exception") === true) return null;
  return `tdd-conductor: ${path} is production code, and the cycle is ${phase}. Write a failing test first (/tdd-cycle red <test>), or record an exception with /tdd-cycle exception <reason>.`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "tdd-cycle",
      description: "TDD cycle: /tdd-cycle red|green|refactor|complete <test path>, /tdd-cycle exception <reason>, /tdd-cycle status"
    });
    return next(e);
  });
  on("command.run", { command: "tdd-cycle" }, async ($, e) => {
    const [subcommand = "status", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    const phase = await phaseOf($);
    if (subcommand === "status") {
      return {
        text: `TDD phase: ${phase}${await $.store.get("exception") === true ? " (exception recorded)" : ""}`
      };
    }
    if (subcommand === "exception") {
      const reason = rest.join(" ").trim();
      if (reason === "") return { text: "Usage: /tdd-cycle exception <reason>" };
      await $.store.set("exception", true);
      const logPath = stateRelativePath("tdd-exceptions.log");
      const earlier = await $.fs.read(logPath).catch(() => "");
      await $.fs.write(
        logPath,
        `${earlier}${new Date(await $.clock.now()).toISOString()} ${truncate(reason, 300)}
`
      );
      return { text: "Exception recorded: production edits are allowed until the next RED." };
    }
    const testPath = rest.join(" ");
    if (subcommand === "red") {
      if (testPath === "") return { text: "Usage: /tdd-cycle red <test path>" };
      const run = await runTests($, testPath);
      if (typeof run === "string") return { text: run };
      await $.store.set("exception", false);
      const kind = classifyFailure(run.stdout, run.stderr);
      if (run.exitCode === 0) {
        await publish($, phase, "UNKNOWN", "the test passed: RED needs a failing test");
        return {
          text: "RED rejected: the test passed. Write a test that fails for the missing behavior."
        };
      }
      if (kind !== "behavioral") {
        await publish($, phase, "UNKNOWN", `RED rejected: the failure is ${kind}, not behavioral`);
        return {
          text: `RED rejected: the failure is ${kind}. Fix the environment or compile error first.`
        };
      }
      const transition = nextPhase(phase, "red-verified");
      if (!transition.ok) return { text: transition.reason };
      await publish($, transition.phase, "PASS", `RED verified: ${testPath}`);
      return {
        text: `RED verified: ${testPath} fails for a behavioral reason. Implement the minimum to pass it.`
      };
    }
    if (subcommand === "green") {
      if (testPath === "") return { text: "Usage: /tdd-cycle green <test path>" };
      const transition = nextPhase(phase, "green-verified");
      if (!transition.ok) return { text: transition.reason };
      const run = await runTests($, testPath);
      if (typeof run === "string") return { text: run };
      if (run.exitCode !== 0) {
        await publish($, phase, "FAIL", `GREEN not reached: ${testPath} still fails`);
        return { text: `GREEN not reached: ${testPath} still fails.` };
      }
      const label = transition.phase === "refactor" ? "REFACTOR verified" : "GREEN verified";
      await publish($, transition.phase, "PASS", `${label}: ${testPath}`);
      return { text: `${label}: ${testPath} passes.` };
    }
    if (subcommand === "refactor") {
      const transition = nextPhase(phase, "refactor");
      if (!transition.ok) return { text: transition.reason };
      await publish(
        $,
        transition.phase,
        "UNKNOWN",
        "REFACTOR started: run /tdd-cycle green <test> to confirm it stays green"
      );
      return {
        text: "REFACTOR started. Keep behavior unchanged; confirm with /tdd-cycle green <test path>."
      };
    }
    if (subcommand === "complete") {
      const transition = nextPhase(phase, "complete");
      if (!transition.ok) return { text: transition.reason };
      await publish($, transition.phase, "PASS", "cycle complete");
      return { text: "Cycle complete." };
    }
    return {
      text: "Usage: /tdd-cycle red|green|refactor|complete <test path> | /tdd-cycle exception <reason> | /tdd-cycle status"
    };
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const denial = await guardProduction($, e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "tdd-conductor failed closed on Edit." }
  );
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const denial = await guardProduction($, e.file_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "tdd-conductor failed closed on Write." }
  );
  on("tool.call", { tool: "NotebookEdit" }, async ($, e, next) => {
    const denial = await guardProduction($, e.notebook_path);
    return denial === null ? next(e) : { deny: denial };
  }).catch(
    (_$, e, next) => next.called ? next(e) : { deny: "tdd-conductor failed closed on NotebookEdit." }
  );
}
export {
  register
};
