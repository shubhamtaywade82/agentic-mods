// mods/incident-timeline/src/register.tsx
import { atom, read, update } from "claude-code";

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
function appendJsonLine(existing, line, cap) {
  const lines = existing.split("\n").filter((item) => item.length > 0);
  lines.push(line);
  const kept = lines.length > cap ? lines.slice(lines.length - cap) : lines;
  return `${kept.join("\n")}
`;
}
function auditLine(record, at) {
  const safe = { at: new Date(at).toISOString() };
  for (const [key, value] of Object.entries(record)) {
    safe[key] = typeof value === "string" ? truncate(redact(value), 2e3) : value;
  }
  return JSON.stringify(safe);
}

// packages/core/src/ui.tsx
function band(kit, name, segments) {
  const { Box, Text } = kit;
  const parts = [];
  segments.forEach((segment, index) => {
    if (index > 0) parts.push(/* @__PURE__ */ h(Text, { dimColor: true }, " · "));
    parts.push(
      /* @__PURE__ */ h(Text, { color: segment.tone, weight: segment.bold === true ? "bold" : "regular" }, segment.text)
    );
  });
  return /* @__PURE__ */ h(Box, { flexDirection: "row" }, /* @__PURE__ */ h(Text, { color: "claude" }, "◆ "), /* @__PURE__ */ h(Text, { dimColor: true }, name, " "), parts);
}

// mods/incident-timeline/src/register.tsx
var PLUGIN = "incident-timeline";
var TIMELINE_CAP = 2e3;
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
var IDLE = { isOpen: false, profile: "standard", id: null };
var incident = atom({ plugin: "incident-timeline", key: "incident" }, IDLE, {
  shape: "incident-1"
});
async function writeLine($, id, kind, text) {
  const path = stateRelativePath(`incidents/${id}.jsonl`);
  let existing;
  try {
    existing = await $.fs.read(path);
  } catch {
    existing = "";
  }
  const line = auditLine({ plugin: PLUGIN, kind, text, id }, Date.now());
  await $.fs.write(path, appendJsonLine(existing, line, TIMELINE_CAP));
  await $.store.set("lastIncident", id);
}
async function openIncident($, parts) {
  const [id = "", ...titleWords] = parts;
  if (!ID_PATTERN.test(id))
    return "Usage: /incident open <id> <title>. The id is letters, digits, - or _.";
  const state = await read($, incident);
  if (state.isOpen) return `Incident ${state.id} is already open. Close it first.`;
  await update($, incident, () => ({ isOpen: true, profile: "strict", id }));
  await writeLine($, id, "opened", truncate(titleWords.join(" ") || "untitled", 200));
  $.ui.toast(`Incident ${id} open: strict command profile on`);
  return `Incident ${id} opened. Command guard now uses the strict profile.`;
}
async function appendRow($, kind, body) {
  const state = await read($, incident);
  if (!state.isOpen || state.id === null)
    return "No incident is open. Use /incident open <id> <title>.";
  if (body.length === 0) return "Nothing to record.";
  await writeLine($, state.id, kind, truncate(body, 2e3));
  return `Recorded ${kind} for ${state.id}.`;
}
async function closeIncident($) {
  const state = await read($, incident);
  if (!state.isOpen || state.id === null) return "No incident is open.";
  await writeLine($, state.id, "closed", "incident closed");
  await update($, incident, () => IDLE);
  $.ui.toast(`Incident ${state.id} closed: standard command profile restored`);
  return `Incident ${state.id} closed. Run /incident postmortem to write the review.`;
}
async function writePostmortem($) {
  const state = await read($, incident);
  const id = state.id ?? await $.store.get("lastIncident");
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return "No incident to write up.";
  let raw;
  try {
    raw = await $.fs.read(stateRelativePath(`incidents/${id}.jsonl`));
  } catch {
    return `No timeline for ${id}.`;
  }
  const rows = raw.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  const table = rows.map((row) => `| ${row.at} | ${row.kind} | ${row.text.replace(/\|/g, "\\|")} |`);
  const mitigation = rows.filter((row) => row.kind === "mitigation").map((row) => `- ${row.text}`);
  const recovery = rows.filter((row) => row.kind === "recovery").map((row) => `- ${row.text}`);
  const document = [
    `# Postmortem ${id}`,
    "",
    "## Timeline",
    "| time | kind | detail |",
    "| --- | --- | --- |",
    ...table,
    "",
    "## Mitigation",
    ...mitigation.length > 0 ? mitigation : ["- none recorded"],
    "",
    "## Recovery evidence",
    ...recovery.length > 0 ? recovery : ["- none recorded"],
    "",
    "## Follow-ups",
    "- [ ] Owner and due date for each follow-up (add with /incident event)",
    "- [ ] Regression test or monitor that would have caught this",
    ""
  ].join("\n");
  const path = stateRelativePath(`incidents/${id}-postmortem.md`);
  await $.fs.write(path, redact(document));
  return `Postmortem written to ${path}.`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "incident",
      description: "Open, log, mitigate, recover and close an incident, or write its postmortem"
    });
    return next(e);
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const state = await read($, incident);
    if (!state.isOpen) return next(e);
    return band($.ui.resolve(e), "incident", [
      { text: `■ ${state.id ?? "unnamed"} open`, tone: "error", bold: true },
      { text: "strict command profile on", tone: "warning" },
      { text: "/incident close to end", tone: "suggestion" }
    ]);
  });
  on("command.run", { command: "incident" }, async ($, e) => {
    const [subcommand = "", ...rest] = e.args.trim().split(/\s+/);
    const text = rest.join(" ").trim();
    switch (subcommand) {
      case "open":
        return { text: await openIncident($, rest) };
      case "event":
        return { text: await appendRow($, "event", text) };
      case "mitigate":
        return { text: await appendRow($, "mitigation", text) };
      case "recover":
        return { text: await appendRow($, "recovery", text) };
      case "close":
        return { text: await closeIncident($) };
      case "postmortem":
        return { text: await writePostmortem($) };
      default:
        return {
          text: "Usage: /incident open <id> <title> | event <text> | mitigate <text> | recover <text> | close | postmortem"
        };
    }
  });
}
export {
  register
};
