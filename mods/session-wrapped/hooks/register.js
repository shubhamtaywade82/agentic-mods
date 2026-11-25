// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/session.ts
function formatDuration(ms) {
  if (ms < 0) return "0s";
  const seconds = Math.round(ms / 1e3);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// mods/session-wrapped/src/register.tsx
var COUNTERS = ["turns", "tools", "edits"];
async function counter($, key) {
  return Number(await $.store.get(key) ?? 0);
}
function register(on) {
  on("session.start", async ($, e, next) => {
    const sessionId = await $.session.id();
    if (await $.store.get("sessionId") !== sessionId) {
      await $.store.set("sessionId", sessionId);
      await $.store.set("startedAt", await $.clock.now());
      for (const key of COUNTERS) await $.store.set(key, 0);
    }
    await $.command.register({
      name: "wrapped",
      description: "Summarise this session: turns, tool calls, edits"
    });
    return next(e);
  });
  on("turn.start", async ($, e, next) => {
    await $.store.set("turns", await counter($, "turns") + 1);
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    await $.store.set("tools", await counter($, "tools") + 1);
    if (e.tool === "Edit" || e.tool === "Write") {
      await $.store.set("edits", await counter($, "edits") + 1);
    }
    return next(e);
  });
  on("command.run", { command: "wrapped" }, async ($) => {
    const startedAt = Number(await $.store.get("startedAt") ?? await $.clock.now());
    const elapsed = formatDuration(await $.clock.now() - startedAt);
    const values = await Promise.all(COUNTERS.map((key) => counter($, key)));
    const [turns = 0, tools = 0, edits = 0] = values;
    return {
      text: `This session: ${elapsed} · ${turns} turn(s) · ${tools} tool call(s) · ${edits} file edit(s).`
    };
  });
}
export {
  register
};
