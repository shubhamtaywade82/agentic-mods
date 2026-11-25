// mods/code-pet/src/register.tsx
import { atom, read, update } from "claude-code";
var EVIDENCE_IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var evidence = atom({ plugin: "evidence-gate", key: "status" }, EVIDENCE_IDLE, {
  shape: "status-1"
});
var mood = atom({ plugin: "code-pet", key: "mood" }, "idle", { shape: "mood-1" });
var FACES = {
  idle: "(-_-)",
  content: "(^_^)",
  busy: "(>_<)",
  worried: "(;_;)"
};
function register(on) {
  on("turn.start", async ($, e, next) => {
    await $.store.set("calls", 0);
    return next(e);
  });
  on("tool.call", async ($, e, next) => {
    await $.store.set("calls", Number(await $.store.get("calls") ?? 0) + 1);
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    const calls = Number(await $.store.get("calls") ?? 0);
    const state = await read($, evidence);
    const nextMood = state.overall === "FAIL" ? "worried" : state.overall === "PASS" ? "content" : calls > 20 ? "busy" : "idle";
    await update($, mood, () => nextMood);
    return next(e);
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, _next) => {
    const current = await read($, mood);
    const { Box, Text } = $.ui.resolve(e);
    return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, { dimColor: true }, FACES[current], " code-pet is ", current));
  });
}
export {
  register
};
