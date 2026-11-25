// mods/debug-timeline/src/register.tsx
import { atom, read, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/util.ts
function appendCapped(list, item, cap) {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
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

// mods/debug-timeline/src/register.tsx
var PANE = "debug-timeline";
var MAX_ENTRIES = 200;
var REPEAT_WINDOW = 20;
var REPEAT_THRESHOLD = 3;
var IDLE = { entries: [], repeated: [] };
var timeline = atom({ plugin: "debug-timeline", key: "timeline" }, IDLE, { shape: "timeline-1" });
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "hypothesis", description: "Record a debugging hypothesis: /hypothesis <text>" });
    await $.command.register({ name: "result", description: "Record a hypothesis outcome: /result <id> confirmed|rejected <evidence>" });
    await $.command.register({ name: "timeline", description: "Show the debugging timeline in a pane" });
    return next(e);
  });
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const command = truncate(redact(e.command), 300);
    const at = await $.clock.now();
    await update($, timeline, (current2) => {
      const entry = {
        id: `C${current2.entries.length + 1}`,
        at,
        kind: "command",
        text: command,
        outcome: null
      };
      const entries = appendCapped(current2.entries, entry, MAX_ENTRIES);
      const recent = entries.slice(-REPEAT_WINDOW).filter((item) => item.kind === "command");
      const counts = /* @__PURE__ */ new Map();
      for (const item of recent) counts.set(item.text, (counts.get(item.text) ?? 0) + 1);
      const repeated = [...counts].filter(([, count]) => count >= REPEAT_THRESHOLD).map(([text]) => text);
      return { entries, repeated };
    });
    const current = await read($, timeline);
    if (current.repeated.includes(command)) {
      $.ui.toast("debug-timeline: this command has run several times; state a hypothesis before running it again");
    }
    return next(e);
  });
  on("command.run", { command: "hypothesis" }, async ($, e) => {
    const text = truncate(redact(e.args.trim()), 500);
    if (text === "") return { text: "Usage: /hypothesis <text>" };
    const at = await $.clock.now();
    await update($, timeline, (current) => ({
      ...current,
      entries: appendCapped(
        current.entries,
        { id: `H${current.entries.length + 1}`, at, kind: "hypothesis", text, outcome: "open" },
        MAX_ENTRIES
      )
    }));
    return { text: "Hypothesis recorded as open." };
  });
  on("command.run", { command: "result" }, async ($, e) => {
    const [id = "", outcome = "", ...rest] = e.args.trim().split(/\s+/);
    if (!/^H\d+$/.test(id) || outcome !== "confirmed" && outcome !== "rejected" || rest.length === 0) {
      return { text: "Usage: /result <H-id> confirmed|rejected <evidence>" };
    }
    const evidence = truncate(redact(rest.join(" ")), 500);
    const resolved = outcome === "confirmed" ? "confirmed" : "rejected";
    const at = await $.clock.now();
    await update($, timeline, (current) => ({
      ...current,
      entries: appendCapped(
        current.entries.map((item) => item.id === id ? { ...item, outcome: resolved } : item),
        {
          id: `R${current.entries.length + 1}`,
          at,
          kind: "result",
          text: `${id} ${resolved}: ${evidence}`,
          outcome: resolved
        },
        MAX_ENTRIES
      )
    }));
    return { text: `${id} ${resolved}.` };
  });
  on("command.run", { command: "timeline" }, async ($) => {
    await $.ui.open({ id: PANE, title: "Debug timeline" });
    return { text: "Debug timeline pane opened." };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const current = await read($, timeline);
    if (current.entries.length === 0) {
      return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, { dimColor: true }, "Nothing recorded yet. Commands are recorded as they run."));
    }
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, current.entries.slice(-40).map((entry) => /* @__PURE__ */ h(Text, { key: entry.id, dimColor: entry.kind === "command" }, entry.id, " ", entry.kind, entry.outcome === null ? "" : ` [${entry.outcome}]`, ": ", entry.text)), current.repeated.length > 0 ? /* @__PURE__ */ h(Text, null, "Repeated commands: ", current.repeated.length) : null);
  });
}
export {
  register
};
