// mods/pr-readiness/src/register.tsx
import { atom, read } from "claude-code";

// packages/core/src/policy.ts
var RANK = { PASS: 0, STALE: 1, UNKNOWN: 2, FAIL: 3 };
function worstVerdict(verdicts) {
  if (verdicts.length === 0) return "UNKNOWN";
  let worst = "PASS";
  for (const verdict of verdicts) {
    if (RANK[verdict] > RANK[worst]) worst = verdict;
  }
  return worst;
}

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/util.ts
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
async function registerCommand(host, spec) {
  try {
    await host.command.register(spec);
    return true;
  } catch (error) {
    host.ui.toast(`/${spec.name} is unavailable: ${errorMessage(error)}`);
    return false;
  }
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/readiness.ts
function assessReadiness(input) {
  const scope = !input.contract.active ? { label: "Scope", verdict: "UNKNOWN", detail: "no change contract recorded" } : input.contract.violations === 0 ? { label: "Scope", verdict: "PASS", detail: `within contract (${input.contract.mode})` } : {
    label: "Scope",
    verdict: "FAIL",
    detail: `${input.contract.violations} write(s) outside the contract`
  };
  const failing = input.evidence.checks.filter((item) => item.verdict !== "PASS");
  const evidence2 = {
    label: "Evidence",
    verdict: input.evidence.overall,
    detail: input.evidence.checks.length === 0 ? "no checks configured or run" : failing.length === 0 ? "all required checks current" : failing.map((item) => `${item.check} ${item.verdict} (${item.reason})`).join("; ")
  };
  const review2 = {
    label: "Review",
    verdict: input.review.verdict,
    detail: input.review.reason
  };
  const architecture2 = {
    label: "Architecture",
    verdict: input.architecture.verdict,
    detail: input.architecture.reason
  };
  const items = [scope, evidence2, review2, architecture2];
  const overall = worstVerdict(items.map((item) => item.verdict));
  const verdict = overall === "PASS" ? "READY" : overall === "FAIL" ? "NOT READY" : "UNKNOWN";
  return { verdict, items };
}
function describeEvidence(input) {
  const lines = ["## Verification", ""];
  if (input.evidence.checks.length === 0) {
    lines.push("- No checks were configured or run for this change.");
  }
  for (const item of input.evidence.checks) {
    const mark = item.verdict === "PASS" ? "passed" : item.verdict === "FAIL" ? "FAILED" : "not verified";
    lines.push(`- ${item.check}: ${mark} (${item.reason})`);
  }
  lines.push("", "## Scope", "");
  lines.push(
    input.contract.active ? `- Contract mode ${input.contract.mode}; ${input.contract.violations} write(s) outside scope.` : "- No change contract recorded."
  );
  lines.push("", "## Review", "", `- ${input.review.reason}`);
  return lines.join("\n");
}

// packages/core/src/ui.tsx
var VERDICTS = {
  PASS: { tone: "success", glyph: "✓" },
  READY: { tone: "success", glyph: "✓" },
  FAIL: { tone: "error", glyph: "✗" },
  "NOT READY": { tone: "error", glyph: "✗" },
  BLOCKED: { tone: "error", glyph: "✗" },
  WARN: { tone: "warning", glyph: "!" },
  DEFERRED: { tone: "warning", glyph: "»" },
  STALE: { tone: "warning", glyph: "↻" },
  UNKNOWN: { tone: "inactive", glyph: "○" }
};
var NEUTRAL = { tone: "inactive", glyph: "○" };
function verdictLook(verdict) {
  return VERDICTS[verdict.toUpperCase()] ?? NEUTRAL;
}
function chip(kit, label, look) {
  const { Text } = kit;
  return /* @__PURE__ */ h(Text, { inverse: true, weight: "bold", color: look.tone }, ` ${look.glyph} ${label} `);
}
function header(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }, /* @__PURE__ */ h(Text, { weight: "bold", color: "claude" }, "◆ ", input.title), /* @__PURE__ */ h(Box, { flexDirection: "row", gap: 1 }, input.meta === void 0 ? null : /* @__PURE__ */ h(Text, { dimColor: true }, input.meta), input.badge ?? null));
}
function card(kit, input) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(
    Box,
    {
      key: input.key,
      flexDirection: "column",
      borderStyle: "round",
      borderColor: input.look.tone,
      paddingX: 1
    },
    /* @__PURE__ */ h(Text, { weight: "bold", color: input.look.tone }, input.look.glyph, " ", input.title),
    (input.lines ?? []).map((line) => /* @__PURE__ */ h(Text, { dimColor: true, wrap: "truncate-end" }, line))
  );
}

// mods/pr-readiness/src/register.tsx
var PANE = "pr-readiness";
var EVIDENCE_IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var CONTRACT_IDLE = { active: false, objective: "", violations: 0, mode: "warn" };
var REVIEW_IDLE = {
  verdict: "UNKNOWN",
  openHigh: 0,
  open: 0,
  reason: "no review findings recorded"
};
var ARCH_IDLE = {
  verdict: "UNKNOWN",
  reason: "not scanned yet",
  fresh: 0,
  baseline: 0
};
var evidence = atom({ plugin: "evidence-gate", key: "status" }, EVIDENCE_IDLE, {
  shape: "status-1"
});
var contract = atom({ plugin: "change-contract", key: "status" }, CONTRACT_IDLE, {
  shape: "status-1"
});
var review = atom({ plugin: "review-tracker", key: "gate" }, REVIEW_IDLE, {
  shape: "gate-1"
});
var architecture = atom({ plugin: "architecture-guard", key: "status" }, ARCH_IDLE, {
  shape: "status-1"
});
async function inputOf($) {
  const [ev, ct, rv, ar] = await Promise.all([
    read($, evidence),
    read($, contract),
    read($, review),
    read($, architecture)
  ]);
  return { contract: ct, evidence: ev, review: rv, architecture: ar };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "pr-ready",
      description: "Readiness verdict for the change; /pr-ready description drafts the PR verification section"
    });
    return next(e);
  });
  on("command.run", { command: "pr-ready" }, async ($, e) => {
    const input = await inputOf($);
    if (e.args.trim() === "description") {
      return { text: describeEvidence(input) };
    }
    const result = assessReadiness(input);
    await $.ui.open({ id: PANE, title: "PR readiness" });
    const lines = [
      `PR readiness: ${result.verdict}`,
      ...result.items.map(
        (item) => `${item.label.padEnd(13)} ${item.verdict.padEnd(8)} ${item.detail}`
      )
    ];
    return { text: lines.join("\n") };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e);
    const { Box, Text } = kit;
    const result = assessReadiness(await inputOf($));
    const passing = result.items.filter((item) => item.verdict === "PASS").length;
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, header(kit, {
      title: "PR readiness",
      meta: `${passing}/${result.items.length} checks pass`,
      badge: chip(kit, result.verdict, verdictLook(result.verdict))
    }), result.items.map(
      (item) => card(kit, {
        key: item.label,
        title: `${item.label}  ${item.verdict}`,
        look: verdictLook(item.verdict),
        lines: [item.detail]
      })
    ), /* @__PURE__ */ h(Text, { dimColor: true }, "/pr-ready [description] drafts the verification section"));
  });
}
export {
  register
};
