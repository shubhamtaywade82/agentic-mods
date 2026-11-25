// mods/next-steps/src/register.tsx
import { atom, read, update } from "claude-code";
var IDLE = { texts: [] };
var steps = atom({ plugin: "next-steps", key: "steps" }, IDLE, { shape: "steps-1" });
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "next", description: "Show suggested next prompts" });
    return next(e);
  });
  on("turn.start", async ($, e, next) => {
    await $.store.set("edits", 0);
    await update($, steps, () => IDLE);
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    if (e.tool === "Edit" || e.tool === "Write") {
      await $.store.set("edits", Number(await $.store.get("edits") ?? 0) + 1);
    }
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    if (e.reason !== "answer") return next(e);
    const edits = Number(await $.store.get("edits") ?? 0);
    const texts = edits > 0 ? [
      "Run /evidence run to refresh the required checks.",
      "Run /test-impact to see which tests this change reaches.",
      "Summarise what changed and what is still unverified."
    ] : ["Summarise the open risks in this session."];
    await update($, steps, () => ({ texts }));
    return next(e);
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
