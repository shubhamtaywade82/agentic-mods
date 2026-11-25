// mods/boss-fight/src/register.tsx
import { atom, read } from "claude-code";

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

// mods/boss-fight/src/register.tsx
var EVIDENCE_IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var evidence = atom({ plugin: "evidence-gate", key: "status" }, EVIDENCE_IDLE, {
  shape: "status-1"
});
function register(on) {
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const state = await read($, evidence);
    const test = state.checks.find((item) => item.check === "test");
    if (test === void 0 || test.verdict === "UNKNOWN") return next(e);
    const kit = $.ui.resolve(e);
    if (test.verdict === "PASS") {
      return band(kit, "boss", [
        { text: "☠ defeated", tone: "success", bold: true },
        { text: "tests are current and passing", tone: "subtle" }
      ]);
    }
    return band(kit, "boss", [
      { text: "👾 standing", tone: "error", bold: true },
      { text: `test check ${test.verdict.toLowerCase()}`, tone: "warning" },
      { text: test.reason, tone: "subtle" }
    ]);
  });
}
export {
  register
};
