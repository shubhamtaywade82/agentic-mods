// mods/next-steps/src/register.tsx
import { atom, read, update } from "claude-code";
var IDLE = { texts: [] };
var steps = atom({ plugin: "next-steps", key: "steps" }, IDLE, { shape: "steps-1" });
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "next-steps", description: "Show suggested next prompts" });
    return next(e);
  });
  on("turn.start", async ($, e, next) => {
    await $.store.set("edits", 0);
    await update($, steps, () => IDLE);
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    const ran = await next(e);
    const changedFile = (e.tool === "Edit" || e.tool === "Write") && !ran.deny && !ran.isError;
    if (changedFile) await $.store.set("edits", Number(await $.store.get("edits") ?? 0) + 1);
    return ran;
  });
  on("turn.complete", async ($, e, next) => {
    if (e.reason !== "answer") return next(e);
    const edits = Number(await $.store.get("edits") ?? 0);
    const texts = edits > 0 ? [
      "Run /evidence run to refresh the required checks.",
      "Run /impact to see which tests this change reaches.",
      "Summarise what changed and what is still unverified."
    ] : ["Summarise the open risks in this session."];
    await update($, steps, () => ({ texts }));
    return next(e);
  });
  on("command.run", { command: "next-steps" }, async ($) => {
    const current = await read($, steps);
    if (current.texts.length === 0)
      return { text: "No suggestions yet: they appear after a turn that changes files." };
    return { text: current.texts.map((text, index) => `${index + 1}. ${text}`).join("\n") };
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, steps);
    if (current.texts.length === 0) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, { dimColor: true }, "Next: "), current.texts.map((text, index) => /* @__PURE__ */ h(
      Button,
      {
        key: `step-${index}`,
        label: text.length > 48 ? `${text.slice(0, 47)}…` : text,
        onPress: () => $.prompt.suggest({ text })
      }
    )));
  });
}
export {
  register
};
