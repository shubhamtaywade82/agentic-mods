// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

// packages/core/src/config.ts
var CONFIG_PATH = `${STATE_DIR}/config.json`;

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// packages/core/src/verification.ts
var verifyEngine = {
  async run({ initial, classifyFailure, execute, verify, policy }) {
    const attempts = [];
    let route = initial;
    for (let attemptNo = 1; attemptNo <= policy.maxAttempts; attemptNo += 1) {
      let output;
      try {
        output = await execute(route);
      } catch (err) {
        const failure2 = { category: "transient", detail: messageOf(err) };
        attempts.push({ attempt: attemptNo, route, verification: { passed: false, failures: [failure2.detail], evidence: [] }, failure: failure2 });
        const outcome2 = decideEscalation(failure2, route, policy, attempts.length);
        if (outcome2.kind === "abort") return finalize("aborted", attempts);
        if (outcome2.kind === "exhausted") return finalize("exhausted", attempts);
        if (outcome2.kind === "escalate" && outcome2.nextRoute) route = outcome2.nextRoute;
        continue;
      }
      const result = await verify(output);
      if (result.passed) {
        attempts.push({ attempt: attemptNo, route, verification: result });
        return { status: "completed", attempts, finalRoute: route };
      }
      const failure = classifyFailure(result);
      attempts.push({ attempt: attemptNo, route, verification: result, failure });
      const outcome = decideEscalation(failure, route, policy, attempts.length);
      if (outcome.kind === "abort") return finalize("aborted", attempts);
      if (outcome.kind === "exhausted") return finalize("exhausted", attempts);
      if (outcome.kind === "escalate" && outcome.nextRoute) route = outcome.nextRoute;
    }
    return finalize("exhausted", attempts);
  }
};
function decideEscalation(failure, currentRoute, policy, attemptsSoFar) {
  if (!policy.retryableFailures.includes(failure.category)) return { kind: "abort" };
  if (attemptsSoFar >= policy.maxAttempts) return { kind: "exhausted" };
  if (failure.category === "route-mismatch") {
    const idx = policy.fallbackRoutes.findIndex((r) => r.model === currentRoute.model);
    const next = policy.fallbackRoutes[idx + 1];
    if (!next) return { kind: "exhausted" };
    return { kind: "escalate", nextRoute: next };
  }
  return { kind: "retry" };
}
function finalize(status, attempts) {
  return { status, attempts };
}
function messageOf(err) {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "execution failed";
}

// mods/verify/src/lib/policy.ts
function heuristicClassify(input) {
  const t = (input.task + " " + input.agentType + " " + JSON.stringify(input.signals ?? {})).toLowerCase();
  const complexSignals = ["refactor", "architecture", "migration", "security", "concurrency", "distributed", "schema", "irreversible"];
  const riskSignals = ["prod", "production", "delete", "drop", "force", "release", "deploy", "migration", "irreversible"];
  const complexity = complexSignals.some((s) => t.includes(s)) ? 0.8 : 0.3;
  const risk = riskSignals.some((s) => t.includes(s)) ? 0.8 : 0.2;
  const effort = complexity > 0.6 ? "high" : complexity > 0.3 ? "medium" : "low";
  const rationale = `heuristic: complexity ${complexity.toFixed(1)}, risk ${risk.toFixed(1)}`;
  return { complexity, risk, effort, rationale };
}
function heuristicClassifyFailure(f) {
  const detail = f.failures[0] ?? "unspecified";
  const text = detail.toLowerCase();
  if (text.includes("timeout") || text.includes("temporarily") || text.includes("retry")) {
    return { category: "transient", detail };
  }
  if (text.includes("wrong model") || text.includes("too weak") || text.includes("route")) {
    return { category: "route-mismatch", detail };
  }
  if (text.includes("fatal") || text.includes("unrecoverable")) {
    return { category: "fatal", detail };
  }
  return { category: "deterministic", detail };
}
var DEFAULT_POLICY = {
  maxAttempts: 3,
  retryableFailures: ["transient", "route-mismatch"],
  fallbackRoutes: [
    { model: "claude-haiku-4.5", effort: "low" },
    { model: "claude-sonnet-4.5", effort: "medium" },
    { model: "claude-opus-4.1", effort: "high" }
  ]
};
var nonEmptyCheck = {
  name: "non-empty-output",
  run(output) {
    if (typeof output === "string" && output.trim().length > 0) return { passed: true, reason: "" };
    if (typeof output === "object" && output !== null) {
      const obj = output;
      const field = obj.result ?? obj.text ?? obj.output;
      if (typeof field === "string" && field.trim().length > 0) return { passed: true, reason: "" };
    }
    return { passed: false, reason: "output was empty", evidence: [] };
  }
};
function containsCheck(substring) {
  return {
    name: `contains:${substring}`,
    run(output) {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      return text.includes(substring) ? { passed: true, reason: "" } : { passed: false, reason: `output did not contain "${substring}"`, evidence: [text.slice(0, 200)] };
    }
  };
}
async function runChecks(output, checks) {
  const failures = [];
  const evidence = [];
  for (const c of checks) {
    const r = await c.run(output);
    if (!r.passed) {
      failures.push(`${c.name}: ${r.reason}`);
      if (r.evidence) evidence.push(...r.evidence);
    }
  }
  return { passed: failures.length === 0, failures, evidence };
}
function renderOutcome(outcome) {
  const lines = ["verify run:"];
  lines.push(`  status: ${outcome.status}`);
  if (outcome.finalRoute) {
    lines.push(`  final route: ${outcome.finalRoute.model}/${outcome.finalRoute.effort}`);
  }
  lines.push(`  attempts: ${outcome.attempts.length}`);
  for (const a of outcome.attempts) {
    const icon = a.verification.passed ? "✓" : "✗";
    const route = `${a.route.model}/${a.route.effort}`;
    const fail = a.failure ? ` [${a.failure.category}: ${a.failure.detail}]` : "";
    lines.push(`    ${icon} attempt ${a.attempt}: ${route}${fail}`);
  }
  return lines.join("\n");
}
function renderStatus(runs2) {
  if (runs2.length === 0) return "verify: no runs this session.";
  const completed = runs2.filter((r) => r.status === "completed").length;
  const escalated = runs2.filter((r) => r.status === "escalated").length;
  const exhausted = runs2.filter((r) => r.status === "exhausted").length;
  const aborted = runs2.filter((r) => r.status === "aborted").length;
  const totalAttempts = runs2.reduce((n, r) => n + r.attempts.length, 0);
  return [
    "verify session status:",
    `  runs: ${runs2.length} (completed ${completed}, escalated ${escalated}, exhausted ${exhausted}, aborted ${aborted})`,
    `  total attempts: ${totalAttempts} (avg ${(totalAttempts / runs2.length).toFixed(1)} per run)`
  ].join("\n");
}

// mods/verify/src/register.tsx
var runs = [];
function strField(e, key) {
  if (typeof e !== "object" || e === null) return void 0;
  const v = e[key];
  return typeof v === "string" ? v : void 0;
}
function pickInitialRoute(effort, policy) {
  const match = policy.ladder.find((r) => r.effort === effort);
  return match ?? policy.ladder[0] ?? { model: "claude-3-7-sonnet", effort: "medium" };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "verify-run",
      description: "Run a task through the verify-escalate engine: classify, route, execute, verify, escalate"
    });
    await $.command.register({
      name: "verify-status",
      description: "Show the outcomes of every verify-run this session"
    });
    runs.length = 0;
    return next(e);
  });
  on("command.run", { command: "verify-run" }, async ($, e) => {
    const task = strField(e, "args") ?? "";
    if (task.length === 0) return { text: "usage: /verify-run <task description>" };
    const classifyInput = { task, agentType: "main" };
    const classification = heuristicClassify(classifyInput);
    const initial = pickInitialRoute(classification.effort, DEFAULT_POLICY);
    const outcome = await verifyEngine.run({
      initial,
      policy: DEFAULT_POLICY,
      classifyFailure: (f) => heuristicClassifyFailure(f),
      execute: async (_route) => {
        try {
          const res = await $.process.run(["bash", "-c", task]);
          return res.stdout || res.stderr;
        } catch (err) {
          throw err;
        }
      },
      verify: async (output) => {
        const keyword = task.split(" ")[0] ?? "task";
        return runChecks(output, [nonEmptyCheck, containsCheck(keyword)]);
      }
    });
    runs.push(outcome);
    return { text: renderOutcome(outcome) };
  });
  on("command.run", { command: "verify-status" }, async () => {
    return { text: renderStatus(runs) };
  });
}
export {
  register
};
