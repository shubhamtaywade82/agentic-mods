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

// plugins/sdlc-guard/policies/command-parser.ts
function isBlank(c) {
  return c === " " || c === "	";
}
function readQuoted(input, start, quote) {
  let out = "";
  let i = start;
  while (i < input.length && input[i] !== quote) {
    if (quote === '"' && input[i] === "\\" && i + 1 < input.length) {
      out += input[i + 1];
      i += 2;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return [out, i + 1];
}
function separatorAt(input, i) {
  const c = input[i];
  if (c === "|") {
    if (input[i + 1] === "|") return { value: "seq", width: 2 };
    if (input[i + 1] === "&") return { value: "pipe", width: 2 };
    return { value: "pipe", width: 1 };
  }
  if (c === "&") return { value: "seq", width: input[i + 1] === "&" ? 2 : 1 };
  if (c === ";" || c === "(" || c === ")" || c === "`" || c === "\n") {
    return { value: "seq", width: 1 };
  }
  return null;
}
function tokenize(input) {
  const tokens = [];
  let word = "";
  let inWord = false;
  const flush = () => {
    if (inWord) tokens.push({ kind: "word", value: word });
    word = "";
    inWord = false;
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '"' || c === "'") {
      const [text, next] = readQuoted(input, i + 1, c);
      word += text;
      inWord = true;
      i = next;
      continue;
    }
    if (c === "\\" && i + 1 < input.length) {
      word += input[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    const sep = separatorAt(input, i);
    if (sep) {
      flush();
      tokens.push({ kind: "sep", value: sep.value });
      i += sep.width;
      continue;
    }
    if (isBlank(c) || c === "\r") {
      flush();
    } else {
      word += c;
      inWord = true;
    }
    i += 1;
  }
  flush();
  return tokens;
}
function parseCommand(input) {
  const commands = [];
  let argv = [];
  let piped = false;
  const endCommand = () => {
    if (argv.length > 0) commands.push({ argv, piped });
    argv = [];
  };
  for (const token of tokenize(input)) {
    if (token.kind === "word") {
      argv.push(token.value);
      continue;
    }
    endCommand();
    piped = token.value === "pipe";
  }
  endCommand();
  return commands;
}

// plugins/sdlc-guard/policies/classify.ts
var WRAPPERS = /* @__PURE__ */ new Set([
  "sudo",
  "doas",
  "env",
  "time",
  "nohup",
  "nice",
  "command",
  "exec",
  "builtin",
  "timeout"
]);
var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash", "ksh"]);
var MAX_DEPTH = 4;
function classifyCommand(command) {
  return classifyText(command, 0);
}
function classifyText(text, depth) {
  if (depth > MAX_DEPTH) {
    return [{ category: "shell.unparsed", impact: "local", scope: { paths: [] } }];
  }
  return parseCommand(text).flatMap((cmd) => classifySimple(cmd, depth));
}
function baseName(program) {
  return program.split("/").pop() ?? program;
}
function isAssignment(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}
function unwrap(argv) {
  let rest = argv;
  let production = false;
  for (; ; ) {
    while (rest[0] !== void 0 && isAssignment(rest[0])) {
      if (/^(RAILS|NODE)_ENV=production$/.test(rest[0])) production = true;
      rest = rest.slice(1);
    }
    const head = rest[0];
    if (head === void 0 || !WRAPPERS.has(baseName(head))) return { argv: rest, production };
    rest = rest.slice(1);
    while (rest[0] !== void 0 && (rest[0].startsWith("-") || isAssignment(rest[0]) || /^\d+(\.\d+)?$/.test(rest[0]))) {
      if (/^(RAILS|NODE)_ENV=production$/.test(rest[0])) production = true;
      rest = rest.slice(1);
    }
  }
}
function classifySimple(cmd, depth) {
  const { argv, production } = unwrap(cmd.argv);
  const [program, ...args] = argv;
  if (program === void 0) return [];
  const name = baseName(program);
  if (name === "xargs") return classifySimple({ argv: skipXargsOptions(args), piped: false }, depth);
  if (name === "eval") return classifyText(args.join(" "), depth + 1);
  if (SHELLS.has(name)) return classifyShell(args, cmd.piped, depth);
  return classifyProgram(name, args, production);
}
function skipXargsOptions(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    i += ["-I", "-n", "-P", "-L", "-d", "-s", "-E"].includes(args[i]) ? 2 : 1;
  }
  return args.slice(i);
}
function classifyShell(args, piped, depth) {
  const cIndex = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
  if (cIndex !== -1) return classifyText(args[cIndex + 1] ?? "", depth + 1);
  if (piped) return [{ category: "shell.remote-exec", impact: "local", scope: { paths: [] } }];
  return [];
}
function action(category, impact, paths = []) {
  return { category, impact, scope: { paths } };
}
function shortFlagLetters(args) {
  const letters = /* @__PURE__ */ new Set();
  for (const a of args) {
    if (/^-[A-Za-z]+$/.test(a)) for (const ch of a.slice(1)) letters.add(ch);
  }
  return letters;
}
function classifyProgram(name, args, production) {
  switch (name) {
    case "rm":
      return classifyRm(args);
    case "find":
      return args.includes("-delete") ? [action("file.delete", "local")] : [];
    case "git":
      return classifyGit(args);
    case "psql":
    case "mysql":
    case "sqlite3":
    case "mongosh":
      return classifySql(args, production);
    case "rails":
    case "rake":
      return classifyDbTask(args, production);
    case "prisma":
    case "knex":
    case "sequelize":
      return args.includes("migrate") ? [action("db.migrate", "local")] : [];
    case "npm":
    case "pnpm":
    case "yarn":
      return args[0] === "publish" ? [action("release.publish", "production")] : [];
    case "kubectl":
      return ["apply", "delete", "replace", "patch"].includes(args[0] ?? "") ? [action("release.deploy", "production")] : [];
    case "helm":
      return ["install", "upgrade", "uninstall"].includes(args[0] ?? "") ? [action("release.deploy", "production")] : [];
    case "terraform":
      return ["apply", "destroy"].includes(args[0] ?? "") ? [action("release.deploy", "production")] : [];
    default:
      return [];
  }
}
function classifyRm(args) {
  const recursive = args.includes("--recursive") || shortFlagLetters(args).has("r") || shortFlagLetters(args).has("R");
  if (!recursive) return [];
  return [
    action(
      "file.delete",
      "local",
      args.filter((a) => !a.startsWith("-"))
    )
  ];
}
function classifySql(args, production) {
  const text = args.join(" ");
  if (!/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE)\b/i.test(text)) return [];
  const prodTarget = production || /prod/i.test(text);
  return [
    action(
      prodTarget ? "db.mutate-production" : "db.mutate-dev",
      prodTarget ? "production" : "local"
    )
  ];
}
function classifyDbTask(args, production) {
  const task = args.find((a) => a.startsWith("db:"));
  if (task === void 0) return [];
  if (/^db:(migrate|rollback|schema:load)/.test(task)) {
    return production ? [action("db.mutate-production", "production")] : [action("db.migrate", "local")];
  }
  if (/^db:(drop|reset|seed|truncate)/.test(task)) {
    return [
      action(
        production ? "db.mutate-production" : "db.mutate-dev",
        production ? "production" : "local"
      )
    ];
  }
  return [];
}
function gitSubcommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    i += ["-C", "-c"].includes(args[i]) ? 2 : 1;
  }
  const sub = args[i];
  return sub === void 0 ? null : { sub, rest: args.slice(i + 1) };
}
function classifyGit(args) {
  const parsed = gitSubcommand(args);
  if (parsed === null) return [];
  const { sub, rest } = parsed;
  const letters = shortFlagLetters(rest);
  switch (sub) {
    case "push":
      return isForcePush(rest) ? [action("git.force-push", "shared-branch")] : [];
    case "rebase":
      return [action("git.rebase", "shared-branch")];
    case "reset":
      return rest.includes("--hard") ? [action("git.destructive", "local")] : [];
    case "clean":
      return letters.has("f") || rest.includes("--force") ? [action("git.destructive", "local")] : [];
    case "checkout":
      return rest.includes("--") || rest.includes("-f") || rest.includes("--force") ? [action("git.destructive", "local")] : [];
    case "restore":
      return rest.includes("--staged") && !rest.includes("--worktree") ? [] : [action("git.destructive", "local")];
    case "branch":
      return letters.has("D") ? [action("git.destructive", "local")] : [];
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear" ? [action("git.destructive", "local")] : [];
    default:
      return [];
  }
}
function isForcePush(rest) {
  if (rest.some(
    (a) => a === "--force" || a.startsWith("--force-") || a === "--mirror" || a === "--delete"
  ))
    return true;
  if (rest.some((a) => a.startsWith("+") || a.startsWith(":") && a.length > 1)) return true;
  return shortFlagLetters(rest).has("f") || shortFlagLetters(rest).has("d");
}

// plugins/sdlc-guard/policies/types.ts
var DESTRUCTIVE_CATEGORIES = [
  "file.delete",
  "file.bulk-modify",
  "file.sensitive-modify",
  "db.migrate",
  "db.mutate-dev",
  "db.mutate-production",
  "git.force-push",
  "git.rebase",
  "git.destructive",
  "shell.remote-exec",
  "shell.unparsed",
  "release.publish",
  "release.deploy"
];
function isDestructive(action2) {
  return DESTRUCTIVE_CATEGORIES.includes(action2.category);
}

// plugins/sdlc-guard/policies/evaluator.ts
function evaluateAction(action2, context) {
  if (!isDestructive(action2)) {
    return { verdict: "allow", reason: "non-destructive action" };
  }
  if (!context.interactive) {
    return {
      verdict: "deny",
      reason: `${action2.category}: destructive action denied (non-interactive, fail-closed)`
    };
  }
  return {
    verdict: "require-approval",
    reason: `${action2.category}: destructive action requires approval`
  };
}

// plugins/sdlc-guard/policies/decision.ts
function decideBash(command, context = { interactive: true }) {
  let pending = null;
  for (const action2 of classifyCommand(command)) {
    const evaluation = evaluateAction(action2, context);
    if (evaluation.verdict === "deny")
      return { kind: "deny", reason: `sdlc-guard: ${evaluation.reason}` };
    if (evaluation.verdict === "require-approval") pending ??= `sdlc-guard: ${evaluation.reason}`;
  }
  return pending === null ? { kind: "allow" } : { kind: "ask", reason: pending };
}

// packages/core/src/command-policy.ts
function quoteArgv(argv) {
  return argv.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ");
}
function decideProcess(argv) {
  if (argv.length === 0 || (argv[0] ?? "") === "") {
    return { kind: "deny", reason: "process policy: empty command, nothing was run" };
  }
  if (argv.some((arg) => arg.includes("\0"))) {
    return { kind: "deny", reason: "process policy: argument contains a NUL byte, nothing was run" };
  }
  return decideBash(quoteArgv(argv), { interactive: false });
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

// packages/core/src/kit-bridge.ts
var KIT_SCHEMA_VERSION = 1;
var KIT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var STATUSES = ["pending", "in_progress", "blocked", "completed", "failed"];
var REQUIRED_ACTIONS = [
  "feature.start",
  "task.red",
  "task.green",
  "task.refactor",
  "feature.verify",
  "run.completed"
];
var PHASES = ["red", "green", "refactor"];
var KIT_BACKED_WORKFLOWS = {
  "feature-development": "feature",
  "bug-fix": "fix"
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : null;
}
function parseKitNextAction(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "kit next did not print JSON" };
  }
  if (!isRecord(raw)) return { ok: false, error: "kit next payload is not an object" };
  if (raw["schemaVersion"] !== KIT_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported kit schemaVersion ${String(raw["schemaVersion"])}` };
  }
  const featureId = raw["featureId"];
  if (typeof featureId !== "string" || !KIT_ID_PATTERN.test(featureId)) {
    return { ok: false, error: "kit featureId is missing or not a plain identifier" };
  }
  const status = raw["status"];
  if (!STATUSES.includes(status)) {
    return { ok: false, error: `kit status ${String(status)} is not recognised` };
  }
  const requiredAction = raw["requiredAction"];
  if (!REQUIRED_ACTIONS.includes(requiredAction)) {
    return { ok: false, error: `kit requiredAction ${String(requiredAction)} is not recognised` };
  }
  const taskId = raw["taskId"];
  const phase = raw["phase"];
  const isTaskAction = String(requiredAction).startsWith("task.");
  if (isTaskAction) {
    if (typeof taskId !== "string" || !KIT_ID_PATTERN.test(taskId)) {
      return { ok: false, error: `${String(requiredAction)} needs a plain taskId` };
    }
    if (!PHASES.includes(phase)) {
      return { ok: false, error: `${String(requiredAction)} needs a red, green or refactor phase` };
    }
    if (requiredAction !== `task.${String(phase)}`) {
      return { ok: false, error: `${String(requiredAction)} does not match phase ${String(phase)}` };
    }
  } else if (taskId !== void 0 || phase !== void 0) {
    return { ok: false, error: `${String(requiredAction)} is run-level and must not name a task` };
  }
  const verificationCommand = stringArray(raw["verificationCommand"]);
  if (verificationCommand === null)
    return { ok: false, error: "kit verificationCommand is not a string array" };
  const nextInvocation = raw["nextInvocation"];
  if (typeof nextInvocation !== "string" || nextInvocation.length === 0) {
    return { ok: false, error: "kit nextInvocation is missing" };
  }
  const blockingQuestions = stringArray(raw["blockingQuestions"]);
  if (blockingQuestions === null)
    return { ok: false, error: "kit blockingQuestions is not a string array" };
  const lessons = raw["advisoryLessons"];
  if (!Array.isArray(lessons)) return { ok: false, error: "kit advisoryLessons is not an array" };
  const advisoryLessons = [];
  for (const item of lessons) {
    if (!isRecord(item) || item["advisory"] !== true || typeof item["summary"] !== "string") {
      return { ok: false, error: "kit advisoryLessons entry is not an advisory lesson" };
    }
    advisoryLessons.push({ summary: item["summary"] });
  }
  const constraints = raw["constraints"];
  if (!isRecord(constraints) || !Number.isInteger(constraints["timeoutMs"]) || constraints["timeoutMs"] <= 0 || !Number.isInteger(constraints["maxOutputBytes"]) || constraints["maxOutputBytes"] <= 0) {
    return { ok: false, error: "kit constraints are missing or not positive integers" };
  }
  const value = {
    schemaVersion: KIT_SCHEMA_VERSION,
    featureId,
    status,
    ...isTaskAction ? { taskId, phase } : {},
    requiredAction,
    verificationCommand,
    nextInvocation,
    blockingQuestions,
    advisoryLessons,
    constraints: {
      timeoutMs: constraints["timeoutMs"],
      maxOutputBytes: constraints["maxOutputBytes"]
    }
  };
  return { ok: true, value };
}
function kitPhaseArgv(mode, featureId, action2) {
  if (!KIT_ID_PATTERN.test(featureId)) return null;
  if (action2.featureId !== featureId) return null;
  switch (action2.requiredAction) {
    case "run.completed":
      return null;
    case "feature.start":
      return ["kit", mode, featureId, "start"];
    case "feature.verify":
      return ["kit", mode, featureId, "verify"];
    case "task.red":
    case "task.green":
    case "task.refactor": {
      const { taskId, phase } = action2;
      if (taskId === void 0 || phase === void 0 || !KIT_ID_PATTERN.test(taskId)) return null;
      return ["kit", mode, featureId, phase, taskId];
    }
  }
}
function kitOrchestrationArgv(mode, featureId) {
  if (!KIT_ID_PATTERN.test(featureId)) return null;
  return ["kit", mode, featureId, "run"];
}
function executesVerification(action2) {
  return action2.requiredAction !== "feature.start" && action2.requiredAction !== "run.completed";
}
function deniedPlanCommands(planText) {
  let plan2;
  try {
    plan2 = JSON.parse(planText);
  } catch {
    return {
      ok: false,
      error: "plan.json is not valid JSON, so its verification commands cannot be checked"
    };
  }
  if (!isRecord(plan2) || !Array.isArray(plan2["tasks"])) {
    return {
      ok: false,
      error: "plan.json has no tasks list, so its verification commands cannot be checked"
    };
  }
  const problems = [];
  for (const task of plan2["tasks"]) {
    if (!isRecord(task) || typeof task["id"] !== "string") {
      return { ok: false, error: "plan.json has a task without an id" };
    }
    const verification = task["verification"];
    const command = isRecord(verification) ? stringArray(verification["command"]) : null;
    if (command === null) {
      problems.push(`${task["id"]}: no verification command`);
      continue;
    }
    const decision = decideProcess(command);
    if (decision.kind !== "allow") problems.push(`${task["id"]}: ${decision.reason}`);
  }
  return { ok: true, value: problems };
}
function parseKitVersion(output) {
  const match = /(\d+\.\d+\.\d+)/.exec(output);
  return match?.[1] ?? null;
}
function renderKitAction(action2, mode) {
  const where = action2.taskId !== void 0 && action2.phase !== void 0 ? `${action2.taskId} ${action2.phase}` : action2.requiredAction;
  const lines = [`${mode} run ${action2.featureId} (${action2.status}): ${where}`];
  if (action2.requiredAction !== "run.completed") lines.push(`Next: ${action2.nextInvocation}`);
  if (action2.verificationCommand.length > 0) {
    lines.push(`Checks with: ${action2.verificationCommand.join(" ")}`);
  }
  for (const question of action2.blockingQuestions) lines.push(`Waiting on a human: ${question}`);
  return lines.join("\n");
}

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
function gateOf(gates, id) {
  return Object.hasOwn(gates, id) ? gates[id] : void 0;
}
function evaluateGate(gate, facts, exceptions) {
  if (gate.facts.length === 0) {
    return {
      allowed: false,
      missing: [],
      failing: [],
      deferred: [],
      invalid: `gate ${gate.id} declares no facts and cannot be satisfied`
    };
  }
  const excepted = exceptions.some((item) => item.gate === gate.id);
  const missing = [];
  const failing = [];
  const deferred = [];
  for (const fact of gate.facts) {
    const value = Object.hasOwn(facts, fact) ? facts[fact] ?? "UNKNOWN" : "UNKNOWN";
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
function validateCatalogue(workflows, gates) {
  const problems = [];
  const workflowIds = /* @__PURE__ */ new Set();
  for (const workflow of workflows) {
    if (workflowIds.has(workflow.id)) problems.push(`duplicate workflow id ${workflow.id}`);
    workflowIds.add(workflow.id);
    const stageIds = /* @__PURE__ */ new Set();
    for (const stage of workflow.stages) {
      if (stageIds.has(stage.id)) {
        problems.push(`workflow ${workflow.id} defines stage ${stage.id} more than once`);
      }
      stageIds.add(stage.id);
      if (stage.gate !== null && gateOf(gates, stage.gate) === void 0) {
        problems.push(
          `workflow ${workflow.id} stage ${stage.id} references gate ${stage.gate}, which is not in the gate catalogue`
        );
      }
    }
  }
  for (const [id, gate] of Object.entries(gates)) {
    if (gate.facts.length === 0) problems.push(`gate ${id} declares no facts`);
  }
  return problems;
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
  let evaluation = null;
  if (current.gate !== null) {
    const gate = gateOf(gates, current.gate);
    if (gate === void 0) {
      return {
        ok: false,
        reason: `${current.id} references gate ${current.gate}, which is not in the gate catalogue`,
        evaluation: null
      };
    }
    evaluation = evaluateGate(gate, facts, run.exceptions);
  }
  if (evaluation !== null && !evaluation.allowed) {
    const reason = evaluation.invalid ?? `${current.id} gate is not satisfied`;
    return { ok: false, reason, evaluation };
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

// mods/workflow-conductor/src/kit-run.ts
function kitModeOf(workflow) {
  return Object.hasOwn(KIT_BACKED_WORKFLOWS, workflow) ? KIT_BACKED_WORKFLOWS[workflow] : void 0;
}
var KIT_INSTALL_HINT = "the Agentic SDLC Kit is not installed or not on PATH. Install it with `npm install -g @agentic-sdlc-kit/cli`, then try again.";
var TAIL_CHARS = 600;
function tail(text) {
  const trimmed = text.trim();
  return trimmed.length > TAIL_CHARS ? `…${trimmed.slice(-TAIL_CHARS)}` : trimmed;
}
async function safeLaunch(launch, argv) {
  try {
    return await launch(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `launch failed: ${message}` };
  }
}
async function kitAvailable(launch) {
  const result = await safeLaunch(launch, ["kit", "--version"]);
  return result.exitCode === 0 && parseKitVersion(result.stdout) !== null;
}
async function kitNext(launch, featureId) {
  if (!KIT_ID_PATTERN.test(featureId))
    return { ok: false, message: `not a valid run id: ${featureId}` };
  const result = await safeLaunch(launch, ["kit", "next", featureId, "--json"]);
  if (result.exitCode === 3) return { ok: false, message: tail(result.stderr) || "kit is blocked" };
  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: `kit next failed (exit ${result.exitCode}): ${tail(result.stderr || result.stdout)}`
    };
  }
  const parsed = parseKitNextAction(result.stdout);
  if (!parsed.ok) return { ok: false, message: `kit output refused: ${parsed.error}` };
  return { ok: true, action: parsed.value };
}
async function planRefusal(readFile, featureId) {
  let text;
  try {
    text = await readFile(`docs/plans/${featureId}/plan.json`);
  } catch {
    return `workflow-conductor refused: docs/plans/${featureId}/plan.json cannot be read, so its verification commands cannot be checked. Plans written as PLAN.md alone are not checked yet.`;
  }
  const checked = deniedPlanCommands(text);
  if (!checked.ok) return `workflow-conductor refused: ${checked.error}.`;
  if (checked.value.length > 0) {
    return `workflow-conductor refused: the plan's verification commands are not allowed:
${checked.value.map((line) => `  ${line}`).join("\n")}`;
  }
  return null;
}
async function startKitRun(launch, workflow, featureId) {
  const mode = kitModeOf(workflow);
  if (mode === void 0)
    return { text: `${workflow} is not a kit-backed workflow.`, started: null };
  if (!KIT_ID_PATTERN.test(featureId)) {
    return {
      text: `Usage: /workflow start <workflow> <id>. ${featureId} is not a valid id.`,
      started: null
    };
  }
  const result = await safeLaunch(launch, ["kit", mode, featureId, "start"]);
  if (result.exitCode !== 0) {
    return {
      text: `kit ${mode} start failed (exit ${result.exitCode}): ${tail(result.stderr || result.stdout)}`,
      started: null
    };
  }
  return {
    text: tail(result.stdout) || `Started ${mode} run ${featureId}.`,
    started: { workflow, featureId }
  };
}
async function runKitPhase(launch, readFile, mode, action2) {
  const argv = kitPhaseArgv(mode, action2.featureId, action2);
  if (argv === null) return { ok: false, text: `${action2.requiredAction} has no command to run.` };
  if (executesVerification(action2)) {
    const refusal = await planRefusal(readFile, action2.featureId);
    if (refusal !== null) return { ok: false, text: refusal };
  }
  const result = await safeLaunch(launch, argv);
  const header2 = `${argv.join(" ")} -> exit ${result.exitCode}`;
  const body = tail(result.stdout || result.stderr);
  return { ok: result.exitCode === 0, text: body === "" ? header2 : `${header2}
${body}` };
}
async function runKitOrchestration(launch, readFile, mode, featureId) {
  const argv = kitOrchestrationArgv(mode, featureId);
  if (argv === null) return { ok: false, text: `${featureId} is not a valid run id.` };
  const refusal = await planRefusal(readFile, featureId);
  if (refusal !== null) return { ok: false, text: refusal };
  const result = await safeLaunch(launch, argv);
  const header2 = result.exitCode === 3 ? `${argv.join(" ")} -> blocked (exit 3)` : `${argv.join(" ")} -> exit ${result.exitCode}`;
  const body = tail(result.stdout || result.stderr);
  return { ok: result.exitCode === 0, text: body === "" ? header2 : `${header2}
${body}` };
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
var STATUSES2 = {
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
  return STATUSES2[status] ?? NEUTRAL;
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
var CATALOGUE_PROBLEMS = [];
for (const raw of RAW_WORKFLOWS) {
  const parsed = parseWorkflow(raw);
  if (!parsed.ok) {
    CATALOGUE_PROBLEMS.push(parsed.error);
    continue;
  }
  if (WORKFLOWS.has(parsed.value.id)) {
    CATALOGUE_PROBLEMS.push(`duplicate workflow id ${parsed.value.id}`);
  }
  WORKFLOWS.set(parsed.value.id, parsed.value);
}
var GATES_RESULT = parseGates(gates_default);
if (!GATES_RESULT.ok) CATALOGUE_PROBLEMS.push(GATES_RESULT.error);
var GATES = GATES_RESULT.ok ? GATES_RESULT.value : {};
CATALOGUE_PROBLEMS.push(...validateCatalogue([...WORKFLOWS.values()], GATES));
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
    const gate = gateOf(GATES, item.gate);
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
  const gate = gateOf(GATES, stage.gate);
  if (gate === void 0) return [`${stage.gate}: gate is not in the catalogue`];
  const facts = withDeferrals(await factsOf($), run.exceptions);
  const evaluation = evaluateGate(gate, facts, run.exceptions);
  if (evaluation.invalid !== void 0) return [evaluation.invalid];
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
var KIT_KEY = "kitRun";
async function loadKitRun($) {
  const value = await $.store.get(KIT_KEY);
  if (typeof value !== "object" || value === null) return null;
  const { workflow, featureId } = value;
  if (typeof workflow !== "string" || kitModeOf(workflow) === void 0) return null;
  if (typeof featureId !== "string" || !KIT_ID_PATTERN.test(featureId)) return null;
  return { workflow, featureId };
}
function kitLaunch($) {
  return async (argv) => {
    const res = await $.process.run([...argv]);
    return { exitCode: res.exitCode ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
}
function kitReadFile($) {
  return (path) => $.fs.read(path);
}
async function currentKit($, featureId) {
  const state = await kitNext(kitLaunch($), featureId);
  if (state.ok) return state;
  if (await kitAvailable(kitLaunch($))) return state;
  return { ok: false, message: `workflow-conductor refused: ${KIT_INSTALL_HINT}` };
}
async function publishKit($, workflow, featureId, state) {
  await update($, conductor, () => {
    if (!state.ok) {
      return {
        active: true,
        workflow,
        task: featureId,
        stage: "",
        status: "active",
        blockers: [state.message]
      };
    }
    const action2 = state.action;
    const completed = action2.requiredAction === "run.completed";
    return {
      active: !completed,
      workflow,
      task: featureId,
      stage: action2.taskId !== void 0 ? `${action2.taskId} ${action2.phase ?? ""}`.trim() : action2.requiredAction,
      status: completed ? "completed" : "active",
      blockers: [...action2.blockingQuestions]
    };
  });
}
async function startKitWorkflow($, rest, stored, legacy) {
  const [workflow = "", ...idParts] = rest;
  const featureId = idParts.join("-");
  if (legacy !== null && legacy.status === "active") {
    return `Task ${legacy.taskId} is active. Cancel it or complete it first.`;
  }
  if (stored !== null) {
    const current = await currentKit($, stored.featureId);
    if (current.ok && current.action.requiredAction !== "run.completed") {
      return `Kit run ${stored.featureId} is active. Advance it, or let it complete, before starting another.`;
    }
  }
  if (!await kitAvailable(kitLaunch($))) return `workflow-conductor refused: ${KIT_INSTALL_HINT}`;
  const started = await startKitRun(kitLaunch($), workflow, featureId);
  if (started.started === null) return started.text;
  await $.store.set(KIT_KEY, started.started);
  const state = await currentKit($, featureId);
  await publishKit($, workflow, featureId, state);
  return state.ok ? `${started.text}
${renderKitAction(state.action, kitModeOf(workflow) ?? "feature")}` : `${started.text}
${state.message}`;
}
async function kitSubcommand($, subcommand, rest, stored) {
  const { workflow, featureId } = stored;
  const mode = kitModeOf(workflow) ?? "feature";
  if (subcommand === "status") {
    const state = await currentKit($, featureId);
    await publishKit($, workflow, featureId, state);
    return state.ok ? renderKitAction(state.action, mode) : state.message;
  }
  if (subcommand === "advance") {
    if (rest.length > 0)
      return "A kit run advances by itself. Run /workflow advance with no target.";
    const state = await currentKit($, featureId);
    if (!state.ok) return state.message;
    if (state.action.requiredAction === "run.completed") return `Kit run ${featureId} is complete.`;
    const outcome = await runKitPhase(kitLaunch($), kitReadFile($), mode, state.action);
    const after = await currentKit($, featureId);
    await publishKit($, workflow, featureId, after);
    const verdict = outcome.ok ? "" : "\nThe phase did not pass. Fix the work and advance again.";
    return `${outcome.text}${verdict}
${after.ok ? renderKitAction(after.action, mode) : after.message}`;
  }
  if (subcommand === "run") {
    const state = await currentKit($, featureId);
    if (!state.ok) return state.message;
    if (state.action.requiredAction === "run.completed") return `Kit run ${featureId} is complete.`;
    const outcome = await runKitOrchestration(kitLaunch($), kitReadFile($), mode, featureId);
    const after = await currentKit($, featureId);
    await publishKit($, workflow, featureId, after);
    return `${outcome.text}
${after.ok ? renderKitAction(after.action, mode) : after.message}`;
  }
  if (subcommand === "defer") {
    return "A kit run has no deferrals: the kit's evidence gate decides when a phase passes.";
  }
  if (subcommand === "cancel") {
    return "A kit run cannot be cancelled from here. This mod keeps only a pointer to the run; the kit owns its state.";
  }
  if (subcommand === "start") {
    return `Kit run ${featureId} is active. Advance it, or let it complete, before starting another.`;
  }
  return "Usage: /workflow status|advance|run for a kit run, or start|status|advance|defer|cancel for the other workflows.";
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
    const stored = await loadKitRun($);
    if (subcommand === "start" && kitModeOf(rest[0] ?? "") !== void 0) {
      return { text: await startKitWorkflow($, rest, stored, run) };
    }
    if (stored !== null) return { text: await kitSubcommand($, subcommand, rest, stored) };
    if (CATALOGUE_PROBLEMS.length > 0 && subcommand !== "status") {
      return {
        text: `workflow-conductor refused: the workflow catalogue is invalid.
${CATALOGUE_PROBLEMS.map((p) => `  ${p}`).join("\n")}`
      };
    }
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
      const status = statusText(definition, run, await blockersOf($, run, definition));
      if (CATALOGUE_PROBLEMS.length === 0) return { text: status };
      return {
        text: `${status}
Catalogue invalid, so start, advance and defer are refused:
${CATALOGUE_PROBLEMS.map((p) => `  ${p}`).join("\n")}`
      };
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
      if (gateOf(GATES, gateId) === void 0 || reason === "") {
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
