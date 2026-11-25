// mods/release-conductor/src/register.tsx
import { atom, read, update } from "claude-code";

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

// packages/core/src/git.ts
function parseStatusZ(output) {
  const records = output.split("\0");
  const entries = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? "";
    if (record.length < 4) continue;
    const index = record.charAt(0);
    const worktree = record.charAt(1);
    const path = record.slice(3);
    if (index === "R" || index === "C") i++;
    entries.push({
      path,
      index,
      worktree,
      isUntracked: index === "?" && worktree === "?"
    });
  }
  return entries;
}
function parseNameList(output) {
  return output.split(/[\0\n]/).map((path) => path.trim()).filter((path) => path.length > 0);
}
async function workingTreeChanges(run) {
  const result = await run(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (result.exitCode !== 0) return null;
  return parseStatusZ(result.stdout);
}
async function changedBetween(run, base, head) {
  const result = await run(["git", "diff", "--name-only", "-z", `${base}...${head}`]);
  if (result.exitCode !== 0) return null;
  return parseNameList(result.stdout);
}

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

// mods/release-conductor/src/register.tsx
var IDLE = { verdict: "UNKNOWN", phase: "none", reason: "release not checked" };
var gate = atom({ plugin: "release-conductor", key: "gate" }, IDLE, { shape: "gate-1" });
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
function runnerOf($) {
  return async (argv) => {
    const result = await $.process.run(argv);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}
async function assetsOf($) {
  try {
    const parsed = JSON.parse(await $.fs.read(stateRelativePath("release.json")));
    return {
      assets: Array.isArray(parsed.assets) ? parsed.assets.map(String) : [],
      rollbackFile: typeof parsed.rollbackFile === "string" ? parsed.rollbackFile : "ROLLBACK.md"
    };
  } catch {
    return { assets: [], rollbackFile: "ROLLBACK.md" };
  }
}
async function releaseChanges($) {
  const run = runnerOf($);
  const dirty = (await workingTreeChanges(run) ?? []).map((change) => change.path);
  const tag = await run(["git", "describe", "--tags", "--abbrev=0"]);
  const base = tag.exitCode === 0 && tag.stdout.trim() !== "" ? tag.stdout.trim() : "HEAD~1";
  const committed = await changedBetween(run, base, "HEAD") ?? [];
  return [...dirty, ...committed];
}
async function fileItem($, path, label, detail) {
  if (isAbsolutePath(path) || hasParentSegment(path)) {
    return { label, ok: false, detail: `refused: ${path} is outside the repository` };
  }
  return { label, ok: await exists($, path), detail };
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await registerCommand($, {
      name: "release-gate",
      description: "Release readiness: /release-gate check"
    });
    return next(e);
  });
  on("command.run", { command: "release-gate" }, async ($, e) => {
    if (e.args.trim() !== "check") return { text: "Usage: /release-gate check" };
    const [ev, ct, rv, ar, mg, rd, bd] = await Promise.all([
      read($, evidence),
      read($, contract),
      read($, review),
      read($, architecture),
      read($, migration),
      read($, dependencies),
      read($, performance)
    ]);
    const input = { contract: ct, evidence: ev, review: rv, architecture: ar };
    const readiness = assessReadiness(input);
    const changed = await releaseChanges($);
    const { assets, rollbackFile } = await assetsOf($);
    const items = [
      {
        label: "changelog updated",
        ok: changed.some((path) => /(^|\/)CHANGELOG\.md$/i.test(path)),
        detail: "CHANGELOG.md changed since the last tag"
      },
      await fileItem($, rollbackFile, "rollback documented", `${rollbackFile} exists`),
      ...await Promise.all(
        assets.map((asset) => fileItem($, asset, `asset ${asset}`, "listed in release.json"))
      ),
      {
        label: "migrations reviewed",
        ok: mg.verdict === "PASS",
        detail: `migration-sentinel: ${mg.verdict}`
      },
      {
        label: "dependencies reviewed",
        ok: rd.verdict === "PASS",
        detail: `dependency-radar: ${rd.verdict}`
      },
      {
        label: "performance budgets",
        ok: bd.verdict === "PASS",
        detail: `performance-budget: ${bd.verdict}`
      }
    ];
    const checklistOk = items.every((item) => item.ok);
    const verdict = readiness.verdict === "NOT READY" ? "FAIL" : readiness.verdict === "READY" && checklistOk ? "PASS" : "UNKNOWN";
    const lines = [
      `release: ${verdict} · readiness ${readiness.verdict}`,
      ...items.map((item) => `[${item.ok ? "x" : " "}] ${item.label}: ${item.detail}`)
    ];
    await $.fs.write(stateRelativePath("release/checklist.md"), `${lines.join("\n")}
`);
    await update($, gate, () => ({
      verdict,
      phase: "checked",
      reason: `readiness ${readiness.verdict}`
    }));
    return { text: lines.join("\n") };
  });
}
async function exists($, path) {
  try {
    await $.fs.stat(path);
    return true;
  } catch {
    return false;
  }
}
export {
  register
};
