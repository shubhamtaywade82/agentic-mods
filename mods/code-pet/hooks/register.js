// mods/code-pet/src/register.tsx
import { atom, read, update } from "claude-code";

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

// mods/code-pet/src/register.tsx
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
    return band($.ui.resolve(e), "pet", [
      { text: FACES[current], tone: "claude", bold: true },
      { text: `code-pet is ${current}`, tone: "subtle" }
    ]);
  });
}
export {
  register
};
