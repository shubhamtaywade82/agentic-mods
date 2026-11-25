// mods/specification-guard/src/register.tsx
import { atom, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
function normalizePath(input) {
  let path = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
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

// packages/core/src/spec.ts
var REQUIRED_SECTIONS = ["performance", "security", "compatibility", "observability", "rollback"];
function validateSpec(text) {
  const issues = [];
  const lines = text.split("\n");
  let scenarios = 0;
  let current = null;
  const closeScenario = () => {
    if (current === null) return;
    for (const step of ["Given", "When", "Then"]) {
      if (!current.steps.has(step)) {
        issues.push({ line: current.line, message: `scenario has no ${step} step` });
      }
    }
    current = null;
  };
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (/^Scenario(\s+Outline)?:/.test(line)) {
      closeScenario();
      scenarios++;
      current = { line: index + 1, steps: /* @__PURE__ */ new Set() };
      return;
    }
    const step = /^(Given|When|Then|And|But)\b/.exec(line);
    if (step !== null && current !== null) {
      const kind = step[1] ?? "";
      if (kind === "And" || kind === "But") return;
      current.steps.add(kind);
    }
  });
  closeScenario();
  if (scenarios === 0) issues.push({ line: 0, message: "no Scenario found" });
  const lower = text.toLowerCase();
  const missingSections = REQUIRED_SECTIONS.filter((section) => !lower.includes(section));
  const verdict = issues.length > 0 ? "FAIL" : missingSections.length > 0 ? "UNKNOWN" : "PASS";
  return { verdict, scenarios, issues, missingSections: [...missingSections] };
}

// mods/specification-guard/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no specification checked" };
var gate = atom({ plugin: "specification-guard", key: "gate" }, IDLE, { shape: "gate-1" });
var TEMPLATE = [
  "Feature: <name>",
  "",
  "  Scenario: <behaviour in one line>",
  "    Given <starting state>",
  "    When <action>",
  "    Then <observable result>",
  "",
  "Non-functional requirements:",
  "- performance: <budget>",
  "- security: <requirement>",
  "- compatibility: <what must keep working>",
  "- observability: <what must be logged or measured>",
  "- rollback: <how to revert>"
].join("\n");
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "spec",
      description: "Check acceptance criteria: /spec check <path> | /spec template"
    });
    return next(e);
  });
  on("command.run", { command: "spec" }, async ($, e) => {
    const [subcommand = "", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    if (subcommand === "template") return { text: TEMPLATE };
    if (subcommand !== "check" || rest.length === 0) {
      return { text: "Usage: /spec check <path to the specification> | /spec template" };
    }
    const path = normalizePath(rest.join(" "));
    const report = validateSpec(await $.fs.read(path));
    await update($, gate, () => ({
      verdict: report.verdict,
      phase: "specified",
      reason: truncate(`${report.scenarios} scenario(s), ${report.issues.length} issue(s) in ${path}`, 200)
    }));
    const lines = [
      `specification: ${report.verdict} (${report.scenarios} scenario(s))`,
      ...report.issues.map((issue) => `line ${issue.line}: ${issue.message}`),
      ...report.missingSections.length > 0 ? [`missing sections: ${report.missingSections.join(", ")}`] : []
    ];
    return { text: lines.join("\n") };
  });
}
export {
  register
};
