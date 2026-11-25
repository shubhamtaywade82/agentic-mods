// mods/boss-fight/src/register.tsx
import { atom, read } from "claude-code";
var EVIDENCE_IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var evidence = atom({ plugin: "evidence-gate", key: "status" }, EVIDENCE_IDLE, {
  shape: "status-1"
});
function register(on) {
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const state = await read($, evidence);
    const test = state.checks.find((item) => item.check === "test");
    if (test === void 0 || test.verdict === "UNKNOWN") return next(e);
    const { Box, Text } = $.ui.resolve(e);
    if (test.verdict === "PASS") {
      return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, { dimColor: true }, "boss: defeated · tests are current and passing"));
    }
    return /* @__PURE__ */ h(Box, null, /* @__PURE__ */ h(Text, null, "boss: standing · test check ", test.verdict.toLowerCase(), " · ", test.reason));
  });
}
export {
  register
};
