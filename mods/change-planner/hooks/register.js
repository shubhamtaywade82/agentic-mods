// mods/change-planner/src/register.tsx
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
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// mods/change-planner/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no plan recorded" };
var gate = atom({ plugin: "change-planner", key: "gate" }, IDLE, { shape: "gate-1" });
async function loadPlan($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath("plan.json")));
    return {
      objective: String(parsed.objective ?? ""),
      files: Array.isArray(parsed.files) ? parsed.files.map(String) : [],
      tests: Array.isArray(parsed.tests) ? parsed.tests.map(String) : [],
      risks: String(parsed.risks ?? "")
    };
  } catch {
    return null;
  }
}
function verdictOf(plan) {
  return plan.files.length > 0 && plan.tests.length > 0 && plan.risks.trim() !== "" ? "PASS" : "UNKNOWN";
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "change-plan",
      description: "Change plan: /change-plan set <objective> | <files> | <tests> | <risks>, /change-plan show, /change-plan contract"
    });
    return next(e);
  });
  on("command.run", { command: "change-plan" }, async ($, e) => {
    const [subcommand = "show", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    if (subcommand === "set") {
      const [objective = "", files = "", tests = "", risks = ""] = rest.join(" ").split("|").map((part) => part.trim());
      if (objective === "" || files === "" || tests === "" || risks === "") {
        return {
          text: "Usage: /change-plan set <objective> | <comma-separated files> | <comma-separated tests> | <risks>"
        };
      }
      const plan2 = {
        objective: truncate(objective, 300),
        files: files.split(",").map((path) => normalizePath(path)).filter((path) => path !== ""),
        tests: tests.split(",").map((path) => normalizePath(path)).filter((path) => path !== ""),
        risks: truncate(risks, 1e3)
      };
      await $.fs.write(stateRelativePath("plan.json"), `${JSON.stringify(plan2, null, 2)}
`);
      await update($, gate, () => ({
        verdict: verdictOf(plan2),
        phase: "planned",
        reason: `${plan2.files.length} file(s), ${plan2.tests.length} test(s)`
      }));
      return { text: `Plan recorded: ${plan2.files.length} file(s), ${plan2.tests.length} test(s).` };
    }
    const plan = await loadPlan($);
    if (plan === null) return { text: "No plan recorded. Use /change-plan set first." };
    if (subcommand === "contract") {
      const contract = {
        objective: plan.objective,
        allowed: plan.files,
        forbidden: [],
        mode: "warn"
      };
      await $.fs.write(stateRelativePath("contract.json"), `${JSON.stringify(contract, null, 2)}
`);
      return { text: `Change contract written: ${plan.files.length} allowed path(s), mode warn.` };
    }
    return {
      text: [
        `objective: ${plan.objective}`,
        `files: ${plan.files.join(", ")}`,
        `tests: ${plan.tests.join(", ")}`,
        `risks: ${plan.risks}`
      ].join("\n")
    };
  });
}
export {
  register
};
