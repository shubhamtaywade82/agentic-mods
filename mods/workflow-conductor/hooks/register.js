// mods/workflow-conductor/src/register.tsx
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

// packages/core/src/util.ts
function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
function isJsonObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

// packages/core/src/log.ts
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// packages/core/src/workflow.ts
function stringsOf(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : null;
}
function parseWorkflow(input) {
  if (!isJsonObject(input)) return { ok: false, error: "workflow must be an object" };
  const id = input["id"];
  const description = input["description"];
  const start = input["start"];
  if (typeof id !== "string" || typeof description !== "string" || typeof start !== "string") {
    return { ok: false, error: "workflow needs string id, description and start" };
  }
  if (!Array.isArray(input["stages"]) || input["stages"].length === 0) {
    return { ok: false, error: `workflow ${id} has no stages` };
  }
  const stages = [];
  for (const raw of input["stages"]) {
    if (!isJsonObject(raw) || typeof raw["id"] !== "string" || typeof raw["name"] !== "string") {
      return { ok: false, error: `workflow ${id} has a malformed stage` };
    }
    const next = stringsOf(raw["next"]);
    if (next === null) return { ok: false, error: `stage ${raw["id"]} needs a next list` };
    const gate = raw["gate"] === null || raw["gate"] === void 0 ? null : raw["gate"];
    const artifact = raw["artifact"] === null || raw["artifact"] === void 0 ? null : raw["artifact"];
    if (gate !== null && typeof gate !== "string")
      return { ok: false, error: `stage ${raw["id"]} gate must be a string` };
    if (artifact !== null && typeof artifact !== "string") {
      return { ok: false, error: `stage ${raw["id"]} artifact must be a string` };
    }
    stages.push({ id: raw["id"], name: raw["name"], gate, artifact, next });
  }
  const ids = new Set(stages.map((stage) => stage.id));
  if (!ids.has(start)) return { ok: false, error: `start stage ${start} is not defined` };
  for (const stage of stages) {
    for (const target of stage.next) {
      if (!ids.has(target))
        return { ok: false, error: `stage ${stage.id} points at undefined ${target}` };
    }
  }
  return { ok: true, value: { id, description, start, stages } };
}
function parseGates(input) {
  if (!isJsonObject(input)) return { ok: false, error: "gates must be an object keyed by gate id" };
  const out = {};
  for (const [id, raw] of Object.entries(input)) {
    if (!isJsonObject(raw) || typeof raw["description"] !== "string") {
      return { ok: false, error: `gate ${id} needs a description` };
    }
    const facts = stringsOf(raw["facts"]);
    if (facts === null || facts.length === 0)
      return { ok: false, error: `gate ${id} needs a non-empty facts list` };
    out[id] = { id, description: raw["description"], facts };
  }
  return { ok: true, value: out };
}
function stageOf(definition, id) {
  return definition.stages.find((stage) => stage.id === id);
}
function evaluateGate(gate, facts, exceptions) {
  const excepted = exceptions.some((item) => item.gate === gate.id);
  const missing = [];
  const failing = [];
  const deferred = [];
  for (const fact of gate.facts) {
    const value = facts[fact] ?? "UNKNOWN";
    if (value === "PASS") continue;
    if (value === "FAIL") failing.push(fact);
    else if (value === "DEFERRED" && excepted) deferred.push(fact);
    else missing.push(fact);
  }
  return {
    allowed: missing.length === 0 && failing.length === 0,
    missing,
    failing,
    deferred
  };
}
function startRun(definition, runId, taskId, at) {
  return {
    id: runId,
    workflowId: definition.id,
    taskId,
    currentStage: definition.start,
    status: "active",
    history: [{ stage: definition.start, at, action: "started" }],
    exceptions: []
  };
}
function advanceRun(definition, gates, run, target, facts, at) {
  const current = stageOf(definition, run.currentStage);
  if (run.status !== "active" || current === void 0) {
    return { ok: false, reason: `run is ${run.status}`, evaluation: null };
  }
  if (!current.next.includes(target)) {
    return { ok: false, reason: `${current.id} cannot move to ${target}`, evaluation: null };
  }
  const targetStage = stageOf(definition, target);
  if (targetStage === void 0)
    return { ok: false, reason: `${target} is not a stage`, evaluation: null };
  const gateId = current.gate;
  const evaluation = gateId === null ? null : evaluateGate(
    gates[gateId] ?? { id: gateId, description: "", facts: [] },
    facts,
    run.exceptions
  );
  if (evaluation !== null && !evaluation.allowed) {
    return { ok: false, reason: `${current.id} gate is not satisfied`, evaluation };
  }
  const terminal = targetStage.next.length === 0;
  const nextRun = {
    ...run,
    currentStage: target,
    status: terminal ? "completed" : "active",
    history: [...run.history, { stage: target, at, action: `advanced from ${current.id}` }]
  };
  return { ok: true, run: nextRun, evaluation };
}

// workflows/feature-development.json
var feature_development_default = {
  id: "feature-development",
  description: "Default workflow for a feature: discover, specify, plan, develop, verify, review, release.",
  start: "discover",
  stages: [
    {
      id: "discover",
      name: "Discover",
      gate: null,
      artifact: "problem.md",
      next: ["specify"]
    },
    {
      id: "specify",
      name: "Specify",
      gate: "specification-gate",
      artifact: "specify.md",
      next: ["plan"]
    },
    {
      id: "plan",
      name: "Plan",
      gate: "plan-gate",
      artifact: "plan.md",
      next: ["develop"]
    },
    {
      id: "develop",
      name: "Develop",
      gate: "implementation-gate",
      artifact: "decisions.md",
      next: ["verify"]
    },
    {
      id: "verify",
      name: "Verify",
      gate: "verification-gate",
      artifact: null,
      next: ["review"]
    },
    {
      id: "review",
      name: "Review",
      gate: "review-gate",
      artifact: "review.md",
      next: ["release"]
    },
    {
      id: "release",
      name: "Release",
      gate: "release-gate",
      artifact: "release.md",
      next: ["done"]
    },
    { id: "done", name: "Done", gate: null, artifact: null, next: [] }
  ]
};

// workflows/tdd.json
var tdd_default = {
  id: "tdd",
  description: "Red, green, refactor cycles with behavioral RED evidence.",
  start: "specify",
  stages: [
    {
      id: "specify",
      name: "Specify behavior",
      gate: "specification-gate",
      artifact: "specify.md",
      next: ["red"]
    },
    { id: "red", name: "RED", gate: "tdd-red-gate", artifact: null, next: ["green"] },
    {
      id: "green",
      name: "GREEN",
      gate: "tdd-green-gate",
      artifact: null,
      next: ["refactor", "complete"]
    },
    {
      id: "refactor",
      name: "REFACTOR",
      gate: "tdd-refactor-gate",
      artifact: null,
      next: ["red", "complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/bug-fix.json
var bug_fix_default = {
  id: "bug-fix",
  description: "Reproduce, fix with a regression test, verify, review.",
  start: "reproduce",
  stages: [
    {
      id: "reproduce",
      name: "Reproduce",
      gate: "defect-reproduction-gate",
      artifact: "defect.md",
      next: ["fix"]
    },
    {
      id: "fix",
      name: "Fix",
      gate: "defect-fix-gate",
      artifact: "root-cause.md",
      next: ["verify"]
    },
    {
      id: "verify",
      name: "Verify",
      gate: "verification-gate",
      artifact: null,
      next: ["review"]
    },
    {
      id: "review",
      name: "Review",
      gate: "review-gate",
      artifact: null,
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/regression.json
var regression_default = {
  id: "regression",
  description: "Assess risk, run the selected regression scope, record evidence.",
  start: "assess",
  stages: [
    { id: "assess", name: "Assess risk", gate: null, artifact: null, next: ["run"] },
    {
      id: "run",
      name: "Run scope",
      gate: "verification-gate",
      artifact: null,
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/refactoring.json
var refactoring_default = {
  id: "refactoring",
  description: "Capture a behavioral baseline, refactor in increments, compare, verify.",
  start: "baseline",
  stages: [
    {
      id: "baseline",
      name: "Baseline",
      gate: "behavior-capture-gate",
      artifact: null,
      next: ["refactor"]
    },
    { id: "refactor", name: "Refactor", gate: null, artifact: null, next: ["compare"] },
    {
      id: "compare",
      name: "Compare",
      gate: "behavior-lock-gate",
      artifact: null,
      next: ["verify"]
    },
    {
      id: "verify",
      name: "Verify",
      gate: "verification-gate",
      artifact: null,
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/pull-request.json
var pull_request_default = {
  id: "pull-request",
  description: "Verify the change, then review it against the readiness gates.",
  start: "verify",
  stages: [
    {
      id: "verify",
      name: "Verify",
      gate: "verification-gate",
      artifact: null,
      next: ["review"]
    },
    {
      id: "review",
      name: "Review",
      gate: "review-gate",
      artifact: "review.md",
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/release.json
var release_default = {
  id: "release",
  description: "Release readiness: every release condition and the observability check.",
  start: "readiness",
  stages: [
    {
      id: "readiness",
      name: "Readiness",
      gate: "release-gate",
      artifact: "release.md",
      next: ["observe"]
    },
    {
      id: "observe",
      name: "Observe",
      gate: "observability-gate",
      artifact: null,
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/hotfix.json
var hotfix_default = {
  id: "hotfix",
  description: "Speed without skipping evidence. Gates may be deferred only with a recorded, approved exception.",
  start: "triage",
  stages: [
    { id: "triage", name: "Triage", gate: null, artifact: "incident.md", next: ["fix"] },
    {
      id: "fix",
      name: "Minimal fix",
      gate: "defect-fix-gate",
      artifact: "root-cause.md",
      next: ["verify"]
    },
    {
      id: "verify",
      name: "Targeted checks",
      gate: "verification-gate",
      artifact: null,
      next: ["release"]
    },
    {
      id: "release",
      name: "Release",
      gate: "release-gate",
      artifact: "release.md",
      next: ["observe"]
    },
    {
      id: "observe",
      name: "Smoke checks",
      gate: "observability-gate",
      artifact: null,
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// workflows/incident-response.json
var incident_response_default = {
  id: "incident-response",
  description: "Detect, mitigate, diagnose, repair, verify recovery, write the postmortem.",
  start: "detect",
  stages: [
    {
      id: "detect",
      name: "Detect",
      gate: null,
      artifact: "incident.md",
      next: ["mitigate"]
    },
    { id: "mitigate", name: "Mitigate", gate: null, artifact: null, next: ["diagnose"] },
    { id: "diagnose", name: "Diagnose", gate: null, artifact: null, next: ["repair"] },
    {
      id: "repair",
      name: "Repair",
      gate: "defect-fix-gate",
      artifact: "root-cause.md",
      next: ["recover"]
    },
    {
      id: "recover",
      name: "Verify recovery",
      gate: "observability-gate",
      artifact: null,
      next: ["postmortem"]
    },
    {
      id: "postmortem",
      name: "Postmortem",
      gate: null,
      artifact: "postmortem.md",
      next: ["complete"]
    },
    { id: "complete", name: "Complete", gate: null, artifact: null, next: [] }
  ]
};

// gates/gates.json
var gates_default = {
  "specification-gate": {
    description: "Acceptance criteria are written in Given/When/Then with the non-functional sections.",
    facts: ["specification"]
  },
  "plan-gate": {
    description: "A change plan names the files, the tests and the risks.",
    facts: ["plan"]
  },
  "implementation-gate": {
    description: "Implementation may start only with a plan and an active, clean change contract.",
    facts: ["plan", "contract"]
  },
  "tdd-red-gate": {
    description: "A behavioral RED failure was observed for the current behavior.",
    facts: ["tdd-red"]
  },
  "tdd-green-gate": {
    description: "The targeted test passes after the minimum implementation.",
    facts: ["tdd-green"]
  },
  "tdd-refactor-gate": {
    description: "Refactoring kept the affected tests green.",
    facts: ["tdd-refactor", "regression"]
  },
  "defect-reproduction-gate": {
    description: "The defect is reproduced, or its reproduction is documented as impossible.",
    facts: ["defects"]
  },
  "defect-fix-gate": {
    description: "The regression test exists and the defect no longer reproduces.",
    facts: ["defect-fix", "regression"]
  },
  "behavior-capture-gate": {
    description: "A behavioral baseline was captured before refactoring.",
    facts: ["behavior-baseline"]
  },
  "behavior-lock-gate": {
    description: "The public surface matches the baseline or changes are approved.",
    facts: ["behavior"]
  },
  "verification-gate": {
    description: "Evidence is current and the regression scope has run.",
    facts: ["evidence", "regression"]
  },
  "review-gate": {
    description: "Review findings, architecture and compatibility are resolved.",
    facts: ["review", "architecture", "compat"]
  },
  "release-gate": {
    description: "Every release condition is satisfied.",
    facts: [
      "evidence",
      "review",
      "architecture",
      "migration",
      "dependencies",
      "performance",
      "compat",
      "release",
      "observability"
    ]
  },
  "observability-gate": {
    description: "Health checks pass after the change.",
    facts: ["observability"]
  }
};

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
var STATUSES = {
  running: { tone: "claude", glyph: "●" },
  completed: { tone: "success", glyph: "✓" },
  failed: { tone: "error", glyph: "✗" },
  cancelled: { tone: "inactive", glyph: "⊘" },
  stopped: { tone: "inactive", glyph: "⊘" }
};
var NEUTRAL = { tone: "inactive", glyph: "○" };
function verdictLook(verdict) {
  return VERDICTS[verdict.toUpperCase()] ?? NEUTRAL;
}
function statusLook(status) {
  return STATUSES[status] ?? NEUTRAL;
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
function empty(kit, text, hint) {
  const { Box, Text } = kit;
  return /* @__PURE__ */ h(Box, { flexDirection: "column" }, /* @__PURE__ */ h(Text, { dimColor: true, italic: true }, text), hint === void 0 ? null : /* @__PURE__ */ h(Text, { color: "suggestion" }, "→ ", hint));
}

// mods/workflow-conductor/src/register.tsx
var PANE = "workflow-conductor";
var RAW_WORKFLOWS = [
  feature_development_default,
  tdd_default,
  bug_fix_default,
  regression_default,
  refactoring_default,
  pull_request_default,
  release_default,
  hotfix_default,
  incident_response_default
];
var WORKFLOWS = /* @__PURE__ */ new Map();
for (const raw of RAW_WORKFLOWS) {
  const parsed = parseWorkflow(raw);
  if (parsed.ok) WORKFLOWS.set(parsed.value.id, parsed.value);
}
var GATES_RESULT = parseGates(gates_default);
var GATES = GATES_RESULT.ok ? GATES_RESULT.value : {};
var IDLE = {
  active: false,
  workflow: "",
  task: "",
  stage: "",
  status: "none",
  blockers: []
};
var conductor = atom({ plugin: "workflow-conductor", key: "conductor" }, IDLE, {
  shape: "conductor-1"
});
var EVIDENCE_IDLE = { overall: "UNKNOWN", checks: [], fingerprint: null };
var CONTRACT_IDLE = { active: false, objective: "", violations: 0, mode: "warn" };
var REVIEW_IDLE = { verdict: "UNKNOWN", openHigh: 0, open: 0, reason: "none" };
var ARCH_IDLE = { verdict: "UNKNOWN", reason: "none", fresh: 0, baseline: 0 };
var MIGRATION_IDLE = { verdict: "UNKNOWN", findings: [] };
var RADAR_IDLE = { verdict: "UNKNOWN", changes: [], scan: "none" };
var BUDGET_IDLE = { verdict: "UNKNOWN", rows: [] };
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
var migration = atom({ plugin: "migration-sentinel", key: "status" }, MIGRATION_IDLE, {
  shape: "status-1"
});
var dependencies = atom({ plugin: "dependency-radar", key: "status" }, RADAR_IDLE, {
  shape: "status-1"
});
var performance = atom({ plugin: "performance-budget", key: "status" }, BUDGET_IDLE, {
  shape: "status-1"
});
var SPEC_IDLE = { verdict: "UNKNOWN", phase: "none", reason: "not run" };
var specification = atom({ plugin: "specification-guard", key: "gate" }, SPEC_IDLE, {
  shape: "gate-1"
});
var plan = atom({ plugin: "change-planner", key: "gate" }, SPEC_IDLE, {
  shape: "gate-1"
});
var regressionGate = atom(
  { plugin: "regression-orchestrator", key: "gate" },
  SPEC_IDLE,
  { shape: "gate-1" }
);
var tddGate = atom({ plugin: "tdd-conductor", key: "gate" }, SPEC_IDLE, {
  shape: "gate-1"
});
var defectGate = atom({ plugin: "defect-protocol", key: "gate" }, SPEC_IDLE, {
  shape: "gate-1"
});
var behaviorGate = atom({ plugin: "behavior-lock", key: "gate" }, SPEC_IDLE, {
  shape: "gate-1"
});
var compatGate = atom(
  { plugin: "contract-compatibility-guard", key: "gate" },
  SPEC_IDLE,
  { shape: "gate-1" }
);
var observabilityGate = atom(
  { plugin: "observability-verifier", key: "gate" },
  SPEC_IDLE,
  { shape: "gate-1" }
);
var releaseGate = atom({ plugin: "release-conductor", key: "gate" }, SPEC_IDLE, {
  shape: "gate-1"
});
async function factsOf($) {
  const [ev, ct, rv, ar, mg, rd, bd, sp, pl, rg, td, df, bh, cp, ob, rl] = await Promise.all([
    read($, evidence),
    read($, contract),
    read($, review),
    read($, architecture),
    read($, migration),
    read($, dependencies),
    read($, performance),
    read($, specification),
    read($, plan),
    read($, regressionGate),
    read($, tddGate),
    read($, defectGate),
    read($, behaviorGate),
    read($, compatGate),
    read($, observabilityGate),
    read($, releaseGate)
  ]);
  const pass = (value) => value === "PASS" ? "PASS" : value === "FAIL" ? "FAIL" : "UNKNOWN";
  const phased = (gate, phase) => gate.phase === phase && gate.verdict === "PASS" ? "PASS" : "UNKNOWN";
  const behaviorBaseline = (bh.phase === "baseline" || bh.phase === "compared") && bh.verdict === "PASS" ? "PASS" : "UNKNOWN";
  return {
    evidence: pass(ev.overall),
    contract: !ct.active ? "UNKNOWN" : ct.violations === 0 ? "PASS" : "FAIL",
    review: pass(rv.verdict),
    architecture: pass(ar.verdict),
    migration: pass(mg.verdict),
    dependencies: pass(rd.verdict),
    performance: pass(bd.verdict),
    specification: pass(sp.verdict),
    plan: pass(pl.verdict),
    regression: pass(rg.verdict),
    "tdd-red": phased(td, "red"),
    "tdd-green": phased(td, "green"),
    "tdd-refactor": phased(td, "refactor"),
    defects: pass(df.verdict),
    "defect-fix": df.phase === "fixed" && df.verdict === "PASS" ? "PASS" : "UNKNOWN",
    "behavior-baseline": behaviorBaseline,
    behavior: phased(bh, "compared"),
    compat: pass(cp.verdict),
    observability: pass(ob.verdict),
    release: pass(rl.verdict)
  };
}
function withDeferrals(facts, exceptions) {
  const out = { ...facts };
  for (const item of exceptions) {
    const gate = GATES[item.gate];
    if (gate === void 0) continue;
    for (const fact of gate.facts) {
      const value = out[fact];
      if (value !== void 0 && value !== "PASS" && value !== "FAIL") out[fact] = "DEFERRED";
    }
  }
  return out;
}
function definitionOf(run) {
  return WORKFLOWS.get(run.workflowId);
}
async function loadRun($) {
  const value = await $.store.get("run");
  return value === null || value === void 0 ? null : value;
}
async function saveRun($, run) {
  await $.store.set("run", run);
  const definition = run === null ? void 0 : definitionOf(run);
  const blockers = await blockersOf($, run, definition);
  await update(
    $,
    conductor,
    () => run === null || definition === void 0 ? IDLE : {
      active: run.status === "active",
      workflow: run.workflowId,
      task: run.taskId,
      stage: run.currentStage,
      status: run.status,
      blockers
    }
  );
}
async function blockersOf($, run, definition) {
  if (run === null || definition === void 0 || run.status !== "active") return [];
  const stage = stageOf(definition, run.currentStage);
  if (stage === void 0 || stage.gate === null) return [];
  const gate = GATES[stage.gate];
  if (gate === void 0) return [];
  const facts = withDeferrals(await factsOf($), run.exceptions);
  const evaluation = evaluateGate(gate, facts, run.exceptions);
  return [...evaluation.missing, ...evaluation.failing].map((fact) => `${stage.gate}: ${fact}`);
}
async function ensureArtifact($, task, file, title) {
  const path = stateRelativePath(`tasks/${task}/${file}`);
  try {
    await $.fs.read(path);
  } catch {
    await $.fs.write(path, `# ${title}

Task: ${task}
`);
  }
}
async function appendArtifact($, task, file, text) {
  const path = stateRelativePath(`tasks/${task}/${file}`);
  let existing;
  try {
    existing = await $.fs.read(path);
  } catch {
    existing = `# ${file}

Task: ${task}
`;
  }
  await $.fs.write(path, `${existing}
${text}
`);
}
function statusText(definition, run, blockers) {
  const lines = [`${definition.id} · task ${run.taskId} · ${run.status}`];
  for (const stage of definition.stages) {
    const marker = stage.id === run.currentStage ? ">" : run.history.some((item) => item.stage === stage.id) ? "x" : " ";
    const gate = stage.gate === null ? "" : ` [gate ${stage.gate}]`;
    lines.push(`${marker} ${stage.name}${gate}`);
  }
  if (blockers.length > 0) lines.push("", "Blocked:", ...blockers.map((item) => `  ${item}`));
  if (run.exceptions.length > 0) {
    lines.push(
      "",
      "Approved deferrals:",
      ...run.exceptions.map(
        (item) => `  ${item.gate}: ${item.reason} (approved by ${item.approvedBy})`
      )
    );
  }
  return lines.join("\n");
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "workflow",
      description: "Delivery workflow: /workflow start|status|advance|defer|cancel"
    });
    await registerCommand($, {
      name: "record",
      description: "Append to a task artifact: /record <file.md> <text>"
    });
    await registerCommand($, {
      name: "decision",
      description: "Record a decision: /decision <title> | <decision> | <consequences>"
    });
    return next(e);
  });
  on("command.run", { command: "workflow" }, async ($, e) => {
    const [subcommand = "status", ...rest] = e.args.trim().split(/\s+/).filter((word) => word.length > 0);
    const run = await loadRun($);
    if (subcommand === "start") {
      const [workflowId = "", ...taskParts] = rest;
      const task = taskParts.join("-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
      const definition2 = WORKFLOWS.get(workflowId);
      if (definition2 === void 0) {
        return { text: `Unknown workflow. Available: ${[...WORKFLOWS.keys()].join(", ")}` };
      }
      if (run !== null && run.status === "active") {
        return { text: `Task ${run.taskId} is active. Cancel it or complete it first.` };
      }
      if (task === "") return { text: "Usage: /workflow start <workflow> <task-id>" };
      const at = await $.clock.now();
      const started = startRun(definition2, `${workflowId}-${task}-${at}`, task, at);
      const stage = stageOf(definition2, started.currentStage);
      if (stage?.artifact) await ensureArtifact($, task, stage.artifact, stage.name);
      await saveRun($, started);
      return { text: statusText(definition2, started, await blockersOf($, started, definition2)) };
    }
    if (run === null)
      return { text: "No workflow is running. Use /workflow start <workflow> <task-id>." };
    const definition = definitionOf(run);
    if (definition === void 0) return { text: `Workflow ${run.workflowId} is not available.` };
    if (subcommand === "status") {
      await $.ui.open({ id: PANE, title: "Workflow" });
      return { text: statusText(definition, run, await blockersOf($, run, definition)) };
    }
    if (subcommand === "advance") {
      const current = stageOf(definition, run.currentStage);
      const target = rest[0] ?? (current !== void 0 && current.next.length === 1 ? current.next[0] : void 0);
      if (target === void 0)
        return { text: `Name the next stage: one of ${current?.next.join(", ") ?? "none"}` };
      const facts = withDeferrals(await factsOf($), run.exceptions);
      const result = advanceRun(definition, GATES, run, target, facts, await $.clock.now());
      if (!result.ok) {
        const evaluation = result.evaluation;
        const lines = [result.reason];
        if (evaluation !== null) {
          if (evaluation.missing.length > 0)
            lines.push(`missing evidence: ${evaluation.missing.join(", ")}`);
          if (evaluation.failing.length > 0) lines.push(`failing: ${evaluation.failing.join(", ")}`);
        }
        return { text: lines.join("\n") };
      }
      const stage = stageOf(definition, target);
      if (stage?.artifact) await ensureArtifact($, run.taskId, stage.artifact, stage.name);
      await saveRun($, result.run);
      return {
        text: statusText(definition, result.run, await blockersOf($, result.run, definition))
      };
    }
    if (subcommand === "defer") {
      const [gateId = "", ...reasonWords] = rest;
      const reason = truncate(reasonWords.join(" ").trim(), 300);
      if (GATES[gateId] === void 0 || reason === "") {
        return {
          text: "Usage: /workflow defer <gate-id> <reason>. The reason is recorded with its approver."
        };
      }
      const approver = (await $.ui.ask(`Who approves deferring ${gateId}? Enter a name or role.`)).trim();
      if (approver === "") return { text: "No approver given; nothing was deferred." };
      const exception = {
        gate: gateId,
        reason,
        approvedBy: truncate(approver, 120),
        at: await $.clock.now()
      };
      const updated = { ...run, exceptions: [...run.exceptions, exception] };
      await saveRun($, updated);
      await appendArtifact(
        $,
        run.taskId,
        "decision-log.md",
        `## Deferred ${gateId}

${reason}

Approved by: ${exception.approvedBy}`
      );
      return { text: `${gateId} deferred with approval. Missing evidence stays visible in status.` };
    }
    if (subcommand === "cancel") {
      await saveRun($, { ...run, status: "cancelled" });
      return { text: `Task ${run.taskId} cancelled.` };
    }
    return { text: "Usage: /workflow start|status|advance|defer|cancel" };
  });
  on("command.run", { command: "record" }, async ($, e) => {
    const run = await loadRun($);
    const [file = "", ...rest] = e.args.trim().split(/\s+/);
    const text = rest.join(" ").trim();
    if (run === null) return { text: "No task is running." };
    if (!/^[a-z0-9-]+\.md$/.test(file) || text === "")
      return { text: "Usage: /record <name.md> <text>" };
    await appendArtifact($, run.taskId, file, truncate(text, 4e3));
    return { text: `Recorded in ${file}.` };
  });
  on("command.run", { command: "decision" }, async ($, e) => {
    const run = await loadRun($);
    if (run === null) return { text: "No task is running." };
    const [title = "", decision = "", consequences = ""] = e.args.split("|").map((part) => part.trim());
    if (title === "" || decision === "")
      return { text: "Usage: /decision <title> | <decision> | <consequences>" };
    const at = new Date(await $.clock.now()).toISOString();
    await appendArtifact(
      $,
      run.taskId,
      "decision-log.md",
      `## ${truncate(title, 200)}

- Recorded: ${at}
- Decision: ${truncate(decision, 1e3)}
- Consequences: ${truncate(consequences, 1e3)}`
    );
    return { text: "Decision recorded in decision-log.md." };
  });
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const current = await read($, conductor);
    if (!current.active) return next(e);
    const isBlocked = current.blockers.length > 0;
    return band($.ui.resolve(e), "workflow", [
      { text: `${current.workflow} · ${current.task}`, tone: "claude", bold: true },
      { text: `stage ${current.stage}` },
      isBlocked ? { text: `✗ blocked: ${current.blockers[0]}`, tone: "error" } : { text: "✓ ready to advance", tone: "success" }
    ]);
  });
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e);
    const { Box, Text } = kit;
    const current = await read($, conductor);
    if (current.workflow === "")
      return empty(kit, "No workflow is running.", "/workflow start <workflow> <task>");
    const stages = WORKFLOWS.get(current.workflow)?.stages ?? [];
    const at = stages.findIndex((stage) => stage.id === current.stage);
    const isDone = current.status === "completed";
    return /* @__PURE__ */ h(Box, { flexDirection: "column" }, header(kit, {
      title: `Workflow ${current.workflow}`,
      meta: current.task,
      badge: chip(
        kit,
        current.status,
        current.blockers.length > 0 ? verdictLook("BLOCKED") : statusLook(
          isDone ? "completed" : current.status === "cancelled" ? "cancelled" : "running"
        )
      )
    }), stages.map((stage, index) => {
      const look = isDone || index < at ? statusLook("completed") : index === at ? statusLook("running") : { tone: "inactive", glyph: "○" };
      return /* @__PURE__ */ h(Box, { key: stage.id, flexDirection: "row", gap: 1 }, /* @__PURE__ */ h(Text, { color: look.tone }, look.glyph), /* @__PURE__ */ h(Text, { weight: index === at ? "bold" : "regular", dimColor: index > at && !isDone }, stage.name), stage.gate === null ? null : /* @__PURE__ */ h(Text, { dimColor: true }, "· ", stage.gate));
    }), current.blockers.length === 0 ? null : /* @__PURE__ */ h(Box, { flexDirection: "column", marginTop: 1 }, current.blockers.map(
      (item) => card(kit, { key: item, title: "Blocked", look: verdictLook("FAIL"), lines: [item] })
    )));
  });
}
export {
  register
};
