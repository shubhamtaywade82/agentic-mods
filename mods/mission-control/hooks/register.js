// mods/mission-control/src/register.tsx
import { atom, read, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/coordination.ts
function spawnAgent(nodes2, input) {
  const next = new Map(nodes2);
  next.set(input.id, {
    id: input.id,
    parentId: input.parentId,
    subagentType: input.subagentType,
    description: input.description,
    status: "running",
    startedAt: input.at,
    endedAt: null,
    toolCalls: 0,
    files: [],
    report: ""
  });
  return next;
}
function recordToolCall(nodes2, id, file) {
  const node = nodes2.get(id);
  if (node === void 0) return new Map(nodes2);
  const files = file !== null && !node.files.includes(file) ? [...node.files, file].slice(-50) : node.files;
  const next = new Map(nodes2);
  next.set(id, { ...node, toolCalls: node.toolCalls + 1, files });
  return next;
}
function finishAgent(nodes2, input) {
  const node = nodes2.get(input.id);
  const next = new Map(nodes2);
  if (node === void 0) return next;
  next.set(input.id, {
    ...node,
    status: input.status,
    endedAt: input.at,
    report: input.report.slice(0, 500)
  });
  return next;
}
function narrateAgent(node, now) {
  const seconds = Math.round(((node.endedAt ?? now) - node.startedAt) / 1e3);
  const files = node.files.length === 0 ? "no files touched" : `touched ${node.files.length} file(s)`;
  const verb = node.status === "running" ? "is working on" : node.status === "completed" ? "finished" : node.status === "failed" ? "failed on" : "was stopped during";
  return `${node.subagentType} ${verb} "${node.description}" for ${seconds}s, ${node.toolCalls} tool call(s), ${files}.`;
}
function agentTree(nodes2) {
  const children = /* @__PURE__ */ new Map();
  for (const node of nodes2.values()) {
    const key = nodes2.has(node.parentId ?? "") ? node.parentId : null;
    const list = children.get(key) ?? [];
    list.push(node);
    children.set(key, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.startedAt - b.startedAt);
  const out = [];
  const visit = (parent, depth) => {
    for (const node of children.get(parent) ?? []) {
      out.push({ node, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
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

// packages/core/src/ui.tsx
var STATUSES = {
  running: { tone: "claude", glyph: "●" },
  completed: { tone: "success", glyph: "✓" },
  failed: { tone: "error", glyph: "✗" },
  cancelled: { tone: "inactive", glyph: "⊘" },
  stopped: { tone: "inactive", glyph: "⊘" }
};
var NEUTRAL = { tone: "inactive", glyph: "○" };
function statusLook(status) {
  return STATUSES[status] ?? NEUTRAL;
}
function chip(kit, label, look) {
  const { Text } = kit;
  return /* @__PURE__ */ h(Text, { inverse: true, weight: "bold", color: look.tone }, ` ${look.glyph} ${label} `);
}
function mark(kit, label, look) {
  const { Text } = kit;
  return /* @__PURE__ */ h(Text, { color: look.tone }, look.glyph, " ", label);
}
function header(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }, /* @__PURE__ */ h(Text, { weight: "bold", color: "claude" }, "◆ ", input.title), /* @__PURE__ */ h(Box, { flexDirection: "row", gap: 1 }, input.meta === void 0 ? null : /* @__PURE__ */ h(Text, { dimColor: true }, input.meta), input.badge ?? null));
}
function card(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(
    Box,
    {
      key: input.key,
      flexDirection: "column",
      borderStyle: "round",
      borderColor: input.look.tone,
      paddingX: 1
    },
    /* @__PURE__ */ h(Text, { weight: "bold", color: input.look.tone }, input.look.glyph, " ", input.title),
    (input.lines ?? []).map((line) => /* @__PURE__ */ h(Text, { dimColor: true, wrap: "truncate-end" }, line))
  );
}
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
function empty(kit, text, hint) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, { dimColor: true, italic: true }, text), hint === void 0 ? null : /* @__PURE__ */ h(Text, { color: "suggestion" }, "→ ", hint));
}

// mods/mission-control/src/register.tsx
var PANE = "mission-control";
var REVIEW_PATTERN = /review/i;
var MAX_ROWS = 60;
var agents = atom({ plugin: "mission-control", key: "agents" }, [], {
  shape: "agents-1"
});
var nodes = /* @__PURE__ */ new Map();
function rowsOf(now) {
  return agentTree(nodes).slice(-MAX_ROWS).map(({ node, depth }) => ({
    id: node.id,
    parentId: node.parentId,
    subagentType: node.subagentType,
    description: node.description,
    status: node.status,
    toolCalls: node.toolCalls,
    files: node.files,
    line: narrateAgent(node, now),
    isReview: REVIEW_PATTERN.test(node.subagentType) || REVIEW_PATTERN.test(node.description),
    depth
  }));
}
function totalToolCalls() {
  let total = 0;
  for (const node of nodes.values()) total += node.toolCalls;
  return total;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "subagents",
      description: "Show subagent activity in a pane (/subagents)"
    });
    return next(e);
  });
  on("command.run", { command: "subagents" }, async ($) => {
    await $.ui.open({ id: PANE, title: "Agents" });
    return { text: "Agent activity pane opened." };
  });
  on("agent.spawn", async ($, e, next) => {
    const result = await next(e);
    if (result.agentId !== void 0) {
      const now = await $.clock.now();
      nodes = spawnAgent(nodes, {
        id: result.agentId,
        parentId: e.parentAgentId ?? null,
        subagentType: e.subagentType,
        description: e.description,
        at: now
      });
      await update($, agents, () => rowsOf(now));
    }
    return result;
  });
  on("agent.report", async ($, e, next) => {
    const ran = await next(e);
    const now = await $.clock.now();
    nodes = finishAgent(nodes, { id: e.agentId, status: e.status, report: e.text, at: now });
    await update($, agents, () => rowsOf(now));
    return ran;
  });
  on("tool.call", async ($, e, next) => {
    if (e.agentId !== void 0) {
      nodes = recordToolCall(
        nodes,
        e.agentId,
        "file_path" in e && typeof e.file_path === "string" ? e.file_path : null
      );
      const now = await $.clock.now();
      await update($, agents, () => rowsOf(now));
    }
    return next(e);
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e);
    const { Box, Text } = kit;
    const rows = await read($, agents);
    if (rows.length === 0) {
      return empty(kit, "No subagents have run in this session.", "ask Claude to use a subagent");
    }
    const running = rows.filter((row) => row.status === "running").length;
    const files = filesByAgentCount(rows);
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, header(kit, {
      title: "Mission control",
      meta: `${rows.length} agent(s) · ${totalToolCalls()} tools`,
      badge: chip(kit, `${running} running`, statusLook(running > 0 ? "running" : "completed"))
    }), rows.map((row) => /* @__PURE__ */ h(Box, { key: row.id, marginLeft: row.depth * 2 }, card(kit, {
      key: `card-${row.id}`,
      title: `${row.isReview ? "[review] " : ""}${row.subagentType}: ${row.description}`,
      look: statusLook(row.status),
      lines: [
        `${row.toolCalls} tool call(s) · ${row.files.length} file(s) · ${row.status}`,
        row.line
      ]
    }))), files.length === 0 ? null : /* @__PURE__ */ h(Box, { flexDirection: "column", marginTop: 1 }, /* @__PURE__ */ h(Text, { weight: "bold" }, "Code touched"), files.map(
      ([file, count]) => mark(kit, `${file}  (${count} agent(s))`, statusLook("completed"))
    )));
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const rows = await read($, agents);
    const running = rows.filter((row) => row.status === "running");
    const current = running[running.length - 1];
    if (current === void 0) return next(e);
    return band($.ui.resolve(e), "mission", [
      { text: `${running.length}/${rows.length} agents`, tone: "claude", bold: true },
      { text: `${totalToolCalls()} tools` },
      { text: `${current.subagentType}: ${current.description}`, tone: "subtle" }
    ]);
  });
}
function filesByAgentCount(rows) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of rows)
    for (const file of new Set(row.files)) counts.set(file, (counts.get(file) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
}
export {
  register
};
