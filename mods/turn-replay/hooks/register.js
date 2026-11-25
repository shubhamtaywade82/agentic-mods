// mods/turn-replay/src/register.tsx
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

// packages/core/src/diff.ts
var MAX_LINES = 2e4;
function splitLines(text) {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length + b.length > MAX_LINES) {
    return [
      ...a.map((line) => ({ kind: "delete", line })),
      ...b.map((line) => ({ kind: "insert", line }))
    ];
  }
  return myers(a, b);
}
function myers(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  v[offset + 1] = 0;
  const trace = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x2;
      if (k === -d || k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0)) {
        x2 = v[offset + k + 1] ?? 0;
      } else {
        x2 = (v[offset + k - 1] ?? 0) + 1;
      }
      let y2 = x2 - k;
      while (x2 < n && y2 < m && a[x2] === b[y2]) {
        x2++;
        y2++;
      }
      v[offset + k] = x2;
      if (x2 >= n && y2 >= m) {
        found = true;
        break;
      }
    }
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const prior = trace[d] ?? new Int32Array(0);
    const k = x - y;
    const fromAbove = k === -d || k !== d && (prior[offset + k - 1] ?? 0) < (prior[offset + k + 1] ?? 0);
    const prevK = fromAbove ? k + 1 : k - 1;
    const prevX = prior[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: "equal", line: a[x - 1] ?? "" });
      x--;
      y--;
    }
    if (d > 0) {
      if (fromAbove) {
        ops.push({ kind: "insert", line: b[y - 1] ?? "" });
      } else {
        ops.push({ kind: "delete", line: a[x - 1] ?? "" });
      }
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}
function summarizeDiff(ops) {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "insert") added++;
    else if (op.kind === "delete") removed++;
  }
  return { added, removed };
}
function trimContext(ops, context) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.kind === "equal") return;
    for (let i = Math.max(0, index - context); i <= Math.min(ops.length - 1, index + context); i++) {
      keep[i] = true;
    }
  });
  const out = [];
  let skipped = false;
  ops.forEach((op, index) => {
    if (keep[index]) {
      out.push(op);
      skipped = false;
    } else if (!skipped) {
      out.push({ kind: "equal", line: "…" });
      skipped = true;
    }
  });
  return out;
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// mods/turn-replay/src/register.tsx
var PANE = "turn-replay";
var MAX_CHANGES = 20;
var MAX_LINES2 = 60;
var MAX_LINE_LENGTH = 200;
var IDLE = { turn: 0, changes: [] };
var replay = atom({ plugin: "turn-replay", key: "replay" }, IDLE, { shape: "replay-1" });
var cursor = atom({ plugin: "turn-replay", key: "cursor" }, 0, { shape: "cursor-1" });
async function snapshot($, path) {
  try {
    return await $.fs.read(path);
  } catch {
    return null;
  }
}
async function recordChange($, file, before, after) {
  if (before === after) return;
  const full = diffLines(before ?? "", after ?? "");
  const { added, removed } = summarizeDiff(full);
  const lines = trimContext(full, 2).slice(0, MAX_LINES2).map((op) => ({ kind: op.kind, line: op.line.slice(0, MAX_LINE_LENGTH) }));
  await update($, replay, (current) => {
    const nextId = (current.changes[current.changes.length - 1]?.id ?? 0) + 1;
    const change = { id: nextId, turn: current.turn, file, added, removed, lines };
    return { ...current, changes: appendCapped(current.changes, change, MAX_CHANGES) };
  });
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "replay",
      description: "Step through the file changes of the session: /replay [number]"
    });
    return next(e);
  });
  on("turn.start", async ($, e, next) => {
    await update($, replay, (current) => ({ ...current, turn: current.turn + 1 }));
    return next(e);
  });
  on("tool.call", { tool: "Edit" }, async ($, e, next) => {
    const before = await snapshot($, e.file_path);
    const ran = await next(e);
    if (ran.deny === void 0) {
      await recordChange($, e.file_path, before, await snapshot($, e.file_path));
    }
    return ran;
  });
  on("tool.call", { tool: "Write" }, async ($, e, next) => {
    const before = await snapshot($, e.file_path);
    const ran = await next(e);
    if (ran.deny === void 0) {
      await recordChange($, e.file_path, before, await snapshot($, e.file_path));
    }
    return ran;
  });
  on("command.run", { command: "replay" }, async ($, e) => {
    const state = await read($, replay);
    const requested = Number.parseInt(e.args.trim(), 10);
    const last = Math.max(0, state.changes.length - 1);
    const index = Number.isFinite(requested) && requested >= 1 ? Math.min(requested - 1, last) : last;
    await update($, cursor, () => index);
    await $.ui.open({ id: PANE, title: "Turn replay" });
    return {
      text: state.changes.length === 0 ? "No edits recorded yet." : `Showing change ${index + 1}.`
    };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e);
    const state = await read($, replay);
    if (state.changes.length === 0) {
      return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, { dimColor: true }, "No file changes recorded in this session yet."));
    }
    const index = Math.min(await read($, cursor), state.changes.length - 1);
    const change = state.changes[index];
    if (change === void 0) return /* @__PURE__ */ h(Box, null);
    const last = state.changes.length - 1;
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, null, `Change ${index + 1} of ${state.changes.length} · turn ${change.turn} · ${change.file} · +${change.added} −${change.removed}`), change.lines.map((row, position) => /* @__PURE__ */ h(Text, { key: `row-${position}`, dimColor: row.kind === "equal" }, row.kind === "insert" ? "+ " : row.kind === "delete" ? "- " : "  ", row.line)), /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(
      Button,
      {
        key: "previous",
        label: "Previous",
        onPress: () => update($, cursor, (current) => Math.max(0, current - 1))
      }
    ), /* @__PURE__ */ h(
      Button,
      {
        key: "next",
        label: "Next",
        onPress: () => update($, cursor, (current) => Math.min(last, current + 1))
      }
    )));
  });
}
export {
  register
};
