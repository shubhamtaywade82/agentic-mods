// mods/trace/src/lib/trace.ts
var DEFAULT_MAX_NODES = 500;
var InMemoryTrace = class {
  nodes = /* @__PURE__ */ new Map();
  order = [];
  maxNodes;
  seq = 0;
  constructor(maxNodes = DEFAULT_MAX_NODES) {
    this.maxNodes = maxNodes;
  }
  open(input) {
    const id = input.kind === "main" ? "main" : `n${this.seq += 1}`;
    const node = {
      id,
      kind: input.kind,
      parentId: input.parentId ?? null,
      label: input.label,
      status: "running",
      durationMs: 0,
      files: [],
      note: "",
      startedAt: Date.now()
    };
    this.nodes.set(id, node);
    this.order.push(id);
    this.evict();
    return id;
  }
  close(id, close) {
    const n = this.nodes.get(id);
    if (!n || n.status !== "running") return;
    n.status = close.status;
    if (close.note !== void 0) n.note = close.note;
    n.durationMs = close.durationMs ?? Date.now() - n.startedAt;
  }
  touchFile(id, touch) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.files = [...n.files, touch];
    let parentId = n.parentId;
    while (parentId) {
      const p = this.nodes.get(parentId);
      if (!p) break;
      p.files = [...p.files, touch];
      parentId = p.parentId;
    }
  }
  snapshot() {
    const nodes = this.order.map((id) => this.nodes.get(id)).filter((n) => !!n);
    const edges = nodes.filter((n) => n.parentId !== null).map((n) => ({ from: n.parentId, to: n.id }));
    return { nodes, edges };
  }
  get(id) {
    return this.nodes.get(id);
  }
  reset() {
    this.nodes.clear();
    this.order = [];
    this.seq = 0;
  }
  /** Drop oldest leaf-first once we exceed the cap. Never evicts the main node. */
  evict() {
    while (this.order.length > this.maxNodes) {
      const victimId = this.order.find((id) => id !== "main" && !this.hasChildren(id));
      if (!victimId) break;
      const idx = this.order.indexOf(victimId);
      this.order.splice(idx, 1);
      this.nodes.delete(victimId);
    }
  }
  hasChildren(id) {
    for (const n of this.nodes.values()) if (n.parentId === id) return true;
    return false;
  }
};
function renderTree(snap) {
  if (snap.nodes.length === 0) return "trace: (empty)";
  const byParent = /* @__PURE__ */ new Map();
  for (const n of snap.nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  const lines = ["trace:"];
  const render = (parentId, depth) => {
    const children = byParent.get(parentId) ?? [];
    for (const c of children) {
      const indent = "  ".repeat(depth);
      const icon = iconFor(c.status);
      const files = c.files.length > 0 ? ` · ${c.files.length} file(s)` : "";
      const note = c.note ? ` — ${c.note}` : "";
      lines.push(
        `${indent}${icon} ${c.label} [${c.status}${c.durationMs ? ` ${c.durationMs}ms` : ""}]${files}${note}`
      );
      render(c.id, depth + 1);
    }
  };
  render(null, 0);
  return lines.join("\n");
}
function iconFor(status) {
  switch (status) {
    case "running":
      return "▸";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
    case "cancelled":
      return "·";
  }
}

// mods/trace/src/lib/summary.ts
function toolLabel(tool, command) {
  const t = typeof tool === "string" && tool.length > 0 ? tool : "unknown";
  if (typeof command === "string" && command.length > 0) {
    const head = command.split("\n")[0] ?? "";
    return `${t}: ${head.slice(0, 60)}`;
  }
  return t;
}
function fileTouchFromTool(tool, path) {
  if (typeof path !== "string" || path.length === 0) return null;
  const op = tool === "Edit" || tool === "Write" ? "write" : "read";
  return { path, op };
}
function summarize(trace2) {
  const snap = trace2.snapshot();
  let running = 0;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let agents = 0;
  let tools = 0;
  const files = /* @__PURE__ */ new Set();
  for (const n of snap.nodes) {
    if (n.status === "running") running += 1;
    else if (n.status === "completed") completed += 1;
    else if (n.status === "failed") failed += 1;
    else if (n.status === "cancelled") cancelled += 1;
    if (n.kind === "agent") agents += 1;
    if (n.kind === "tool") tools += 1;
    for (const f of n.files) files.add(f.path);
  }
  return {
    total: snap.nodes.length,
    running,
    completed,
    failed,
    cancelled,
    agents,
    tools,
    filesTouched: files.size
  };
}
function traceSpinnerSuffix(s) {
  return ` · trace: ${s.running} running / ${s.total} nodes (${s.agents} agents, ${s.tools} tools)`;
}
function openTool(trace2, parentId, tool, command) {
  return trace2.open({ kind: "tool", label: toolLabel(tool, command), parentId });
}
function openAgent(trace2, parentId, subagentType, description) {
  const role = typeof subagentType === "string" && subagentType.length > 0 ? subagentType : "agent";
  const label = typeof description === "string" && description.length > 0 ? `${role}: ${description.slice(0, 50)}` : role;
  return trace2.open({ kind: "agent", label, parentId });
}

// mods/trace/src/register.tsx
var trace = new InMemoryTrace();
var openTools = /* @__PURE__ */ new Set();
var agentNodes = /* @__PURE__ */ new Map();
var mainId = trace.open({ kind: "main", label: "main", parentId: null });
function strField(e, key) {
  if (typeof e !== "object" || e === null) return void 0;
  const v = e[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "trace",
      description: "Show the hierarchical execution tree for this session"
    });
    await $.command.register({
      name: "trace-summary",
      description: "One-line summary of the execution tree (counts, running nodes)"
    });
    trace.reset();
    openTools.clear();
    agentNodes.clear();
    mainId = trace.open({ kind: "main", label: "main", parentId: null });
    return next(e);
  });
  on("agent.spawn", async (_$, e, next) => {
    const parentId = agentNodes.get(strField(e, "parentAgentId") ?? "") ?? mainId;
    const id = openAgent(trace, parentId, strField(e, "subagentType"), strField(e, "description"));
    const res = await next(e);
    const agentId = strField(res, "agentId");
    if (agentId) agentNodes.set(agentId, id);
    else trace.close(id, { status: "failed", note: strField(res, "deny") ?? "not started" });
    return res;
  });
  on("tool.call", async (_$, e, next) => {
    const parentId = agentNodes.get(strField(e, "agentId") ?? "") ?? mainId;
    const id = openTool(trace, parentId, strField(e, "tool"), strField(e, "command"));
    openTools.add(id);
    const touch = fileTouchFromTool(strField(e, "tool"), strField(e, "file_path"));
    if (touch) trace.touchFile(id, touch);
    try {
      const res = await next(e);
      const failed = typeof res === "object" && res !== null && ("error" in res || "deny" in res);
      trace.close(id, { status: failed ? "failed" : "completed" });
      return res;
    } catch (err) {
      trace.close(id, { status: "failed", note: String(err) });
      throw err;
    } finally {
      openTools.delete(id);
    }
  });
  on("turn.complete", async ($, e, next) => {
    const agentId = strField(e, "agentId");
    const agentNode = agentNodes.get(agentId ?? "");
    if (agentNode) {
      trace.close(agentNode, { status: "completed" });
      agentNodes.delete(agentId);
    } else {
      for (const id of openTools)
        trace.close(id, { status: "cancelled", note: "open at turn.complete" });
      openTools.clear();
    }
    $.ui.invalidate("ui.render");
    return next(e);
  });
  on("ui.render", { component: "Spinner" }, async (_$, e, next) => {
    return next({ ...e, props: { ...e.props, suffix: traceSpinnerSuffix(summarize(trace)) } });
  });
  on("command.run", { command: "trace" }, async () => {
    if (!trace.get("main")) {
      mainId = trace.open({ kind: "main", label: "main", parentId: null });
    }
    return { text: renderTree(trace.snapshot()) };
  });
  on("command.run", { command: "trace-summary" }, async () => {
    const s = summarize(trace);
    return {
      text: `trace summary: ${s.total} nodes (${s.agents} agents, ${s.tools} tools; ${s.running} running, ${s.failed} failed, ${s.completed} completed)`
    };
  });
}
export {
  register
};
