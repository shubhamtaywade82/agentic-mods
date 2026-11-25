// mods/defect-protocol/src/register.tsx
import { atom, read, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// mods/defect-protocol/src/register.tsx
var FIELDS = [
  "symptom",
  "repro",
  "expected",
  "actual",
  "hypothesis",
  "evidence",
  "root-cause",
  "fix",
  "regression-test",
  "risk",
  "impossible"
];
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "no defect open" };
var gate = atom({ plugin: "defect-protocol", key: "gate" }, IDLE, { shape: "gate-1" });
var defect = atom({ plugin: "defect-protocol", key: "defect" }, {}, {
  shape: "defect-1"
});
function gateOf(fields) {
  const reproduced = (fields["repro"] ?? "") !== "" || (fields["impossible"] ?? "") !== "";
  const fixed = (fields["fix"] ?? "") !== "" && (fields["regression-test"] ?? "") !== "";
  if (fixed) return { verdict: "PASS", phase: "fixed", reason: "fix and regression test recorded" };
  if (reproduced) return { verdict: "PASS", phase: "reproduced", reason: "reproduction recorded" };
  return { verdict: "UNKNOWN", phase: "open", reason: "no reproduction or impossibility reason" };
}
async function publish(fields) {
  return { gate: gateOf(fields), fields };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "defect",
      description: "Defect protocol: /defect open <title>, /defect set <field> <text>, /defect status"
    });
    return next(e);
  });
  on("command.run", { command: "defect" }, async ($, e) => {
    const [subcommand = "status", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    const current = await read($, defect);
    if (subcommand === "open") {
      const title = rest.join(" ").trim();
      if (title === "") return { text: "Usage: /defect open <title>" };
      const fields = { title: truncate(title, 200) };
      await update($, defect, () => fields);
      await update($, gate, () => gateOf(fields));
      return { text: `Defect opened: ${title}. Record the symptom and the reproduction next.` };
    }
    if (subcommand === "set") {
      const field = rest[0] ?? "";
      const text = rest.slice(1).join(" ").trim();
      if (!FIELDS.includes(field) || text === "") {
        return { text: `Usage: /defect set <${FIELDS.join("|")}> <text>` };
      }
      const fields = { ...current, [field]: truncate(text, 2e3) };
      await update($, defect, () => fields);
      await update($, gate, () => gateOf(fields));
      return { text: `${field} recorded.` };
    }
    const result = await publish(current);
    return {
      text: [
        `defect: ${result.gate.phase} (${result.gate.verdict})`,
        ...Object.entries(current).map(([key, value]) => `${key}: ${value}`)
      ].join("\n")
    };
  });
}
export {
  register
};
