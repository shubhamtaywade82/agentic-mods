// mods/task-orientation/src/register.tsx
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

// mods/task-orientation/src/register.tsx
var PANE = "task-orientation";
var IDLE = { goal: null, task: null, blocker: null, next: null };
var orientation = atom({ plugin: "task-orientation", key: "orientation" }, IDLE, {
  shape: "orientation-1"
});
var COMMANDS = {
  goal: "goal",
  task: "task",
  blocker: "blocker",
  next: "next"
};
function register(on) {
  on("session.start", async ($, e, next) => {
    for (const name of [
      "orient-goal",
      "orient-task",
      "orient-blocker",
      "orient-next",
      "orient-show"
    ]) {
      await $.command.register({
        name,
        description: `task-orientation: ${name === "orient-show" ? "show the pane" : `set the ${name.replace("orient-", "")}`}`
      });
    }
    return next(e);
  });
  on("prompt.submit", async ($, e, next) => {
    if (e.command === void 0) {
      const state = await read($, orientation);
      if (state.goal === null && e.text.trim().length > 0) {
        await update($, orientation, (current) => ({
          ...current,
          goal: truncate(e.text.trim(), 300)
        }));
      }
    }
    return next(e);
  });
  on("command.run", { command: "orient-goal" }, async ($, e) => {
    await update($, orientation, (current) => ({
      ...current,
      goal: truncate(e.args.trim(), 300) || null
    }));
    return { text: "Goal updated." };
  });
  on("command.run", { command: "orient-task" }, async ($, e) => {
    await update($, orientation, (current) => ({
      ...current,
      task: truncate(e.args.trim(), 300) || null
    }));
    return { text: "Current task updated." };
  });
  on("command.run", { command: "orient-blocker" }, async ($, e) => {
    const text = e.args.trim();
    await update($, orientation, (current) => ({
      ...current,
      blocker: text === "clear" || text === "" ? null : truncate(text, 300)
    }));
    return { text: "Blocker updated." };
  });
  on("command.run", { command: "orient-next" }, async ($, e) => {
    await update($, orientation, (current) => ({
      ...current,
      next: truncate(e.args.trim(), 300) || null
    }));
    return { text: "Next step updated." };
  });
  on("command.run", { command: "orient-show" }, async ($) => {
    await $.ui.open({ id: PANE, title: "Where am I" });
    return { text: "Task orientation pane opened." };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const state = await read($, orientation);
    const rows = [
      ["Goal", state.goal],
      ["Current task", state.task],
      ["Blocker", state.blocker],
      ["Next step", state.next]
    ];
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, rows.map(([label, value]) => /* @__PURE__ */ h(Text, { key: label }, label, ": ", value ?? "not set")));
  });
  void COMMANDS;
}
export {
  register
};
