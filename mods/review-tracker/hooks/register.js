// mods/review-tracker/src/register.tsx
import { atom, read, update } from "claude-code";

// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";
var PathGuardError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PathGuardError";
  }
};
function normalizePath(input) {
  let path = input.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}
function isAbsolutePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}
function hasParentSegment(path) {
  return normalizePath(path).split("/").includes("..");
}
function stateRelativePath(relative) {
  const path = normalizePath(relative);
  if (path === "" || isAbsolutePath(path) || hasParentSegment(path)) {
    throw new PathGuardError(`refusing a state path outside ${STATE_DIR}: ${relative}`);
  }
  return `${STATE_DIR}/${path}`;
}

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// packages/core/src/records.ts
var FINDING_TRANSITIONS = {
  open: { start: "in-progress", fix: "fixed", reject: "rejected", defer: "deferred" },
  "in-progress": { fix: "fixed", reject: "rejected", defer: "deferred" },
  fixed: { verify: "verified", reopen: "open" },
  verified: { reopen: "open" },
  rejected: { reopen: "open" },
  deferred: { reopen: "open", start: "in-progress" }
};
function transitionFinding(current, action, details) {
  const next = FINDING_TRANSITIONS[current][action];
  if (next === void 0) {
    return { ok: false, reason: `cannot ${action} a finding that is ${current}` };
  }
  if (action === "verify" && !(details.evidence && details.evidence.trim().length > 0)) {
    return { ok: false, reason: "verifying a finding needs evidence" };
  }
  if ((action === "reject" || action === "defer") && !(details.reason && details.reason.trim().length > 0)) {
    return {
      ok: false,
      reason: `${action === "reject" ? "rejecting" : "deferring"} needs a reason`
    };
  }
  return { ok: true, status: next };
}
function gateFindings(findings) {
  if (findings.length === 0) {
    return { verdict: "UNKNOWN", openHigh: 0, open: 0, reason: "no review findings recorded" };
  }
  const unresolved = findings.filter(
    (finding) => finding.status === "open" || finding.status === "in-progress"
  );
  const openHigh = unresolved.filter((finding) => finding.severity === "high").length;
  if (openHigh > 0) {
    return {
      verdict: "FAIL",
      openHigh,
      open: unresolved.length,
      reason: `${openHigh} high-severity finding${openHigh === 1 ? "" : "s"} unresolved`
    };
  }
  return {
    verdict: "PASS",
    openHigh: 0,
    open: unresolved.length,
    reason: unresolved.length === 0 ? "all findings resolved" : `${unresolved.length} lower-severity open`
  };
}

// mods/review-tracker/src/register.tsx
var PANE = "review-tracker";
var FILE = "findings.json";
var ACTIONS = ["start", "fix", "verify", "reject", "defer", "reopen"];
var SEVERITIES = ["high", "medium", "low"];
var IDLE = {
  verdict: "UNKNOWN",
  openHigh: 0,
  open: 0,
  reason: "no review findings recorded"
};
var gate = atom({ plugin: "review-tracker", key: "gate" }, IDLE, { shape: "gate-1" });
async function loadFindings($) {
  const path = stateRelativePath(FILE);
  try {
    await $.fs.stat(path);
  } catch {
    return { ok: true, findings: [] };
  }
  try {
    const parsed = JSON.parse(await $.fs.read(path));
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return { ok: true, findings: parsed };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: `${path} cannot be read (${cause}). Repair or remove it; no finding was changed.`
    };
  }
}
async function publishGate($, findings) {
  const result = gateFindings(findings);
  await update($, gate, () => ({
    verdict: result.verdict,
    openHigh: result.openHigh,
    open: result.open,
    reason: result.reason
  }));
}
async function saveFindings($, findings) {
  await $.fs.write(stateRelativePath(FILE), `${JSON.stringify(findings, null, 2)}
`);
  await publishGate($, findings);
}
function nextId(findings) {
  const highest = findings.reduce((max, finding) => {
    const number = Number(finding.id.replace(/^R-/, ""));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 0);
  return `R-${String(highest + 1).padStart(3, "0")}`;
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "finding",
      description: "Track review findings: /finding add|set|list"
    });
    const loaded = await loadFindings($);
    if (loaded.ok) await publishGate($, loaded.findings);
    return next(e);
  });
  on("command.run", { command: "finding" }, async ($, e) => {
    const [subcommand = "list", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    const loaded = await loadFindings($);
    if (!loaded.ok) return { text: loaded.reason };
    const findings = loaded.findings;
    if (subcommand === "list") {
      await $.ui.open({ id: PANE, title: "Review findings" });
      if (findings.length === 0) return { text: "No findings recorded." };
      return {
        text: findings.map((finding) => `${finding.id} ${finding.severity} ${finding.status} ${finding.title}`).join("\n")
      };
    }
    if (subcommand === "add") {
      const severity = rest[0];
      const title = rest.slice(1).join(" ").trim();
      if (!SEVERITIES.some((value) => value === severity) || title === "") {
        return { text: "Usage: /finding add high|medium|low <title>" };
      }
      const finding = {
        id: nextId(findings),
        title: truncate(title, 300),
        severity,
        status: "open",
        file: null,
        reason: null,
        evidence: null,
        updatedAt: await $.clock.now()
      };
      await saveFindings($, [...findings, finding]);
      return { text: `${finding.id} recorded as ${finding.severity}.` };
    }
    if (subcommand === "set") {
      const [id = "", action = "", ...detail] = rest;
      const target = findings.find((finding) => finding.id === id);
      const transition = ACTIONS.find((value) => value === action);
      if (target === void 0 || transition === void 0) {
        return { text: `Usage: /finding set <id> ${ACTIONS.join("|")} [text]` };
      }
      const text = truncate(detail.join(" ").trim(), 1e3);
      const result = transitionFinding(target.status, transition, {
        evidence: transition === "verify" ? text : null,
        reason: transition === "reject" || transition === "defer" ? text : null
      });
      if (!result.ok) return { text: result.reason };
      const updated = {
        ...target,
        status: result.status,
        evidence: transition === "verify" ? text : target.evidence,
        reason: transition === "reject" || transition === "defer" ? text : target.reason,
        updatedAt: await $.clock.now()
      };
      await saveFindings(
        $,
        findings.map((finding) => finding.id === id ? updated : finding)
      );
      return { text: `${id} is now ${result.status}.` };
    }
    return { text: "Usage: /finding add|set|list" };
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    const current = await read($, gate);
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, null, "Review gate: ", current.verdict, " · ", current.reason), /* @__PURE__ */ h(Text, { dimColor: true }, "Use /finding add, /finding set and /finding list."));
  });
}
export {
  register
};
