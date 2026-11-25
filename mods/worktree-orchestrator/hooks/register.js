// packages/core/src/paths.ts
var STATE_DIR = ".agentic-mods";

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
function parseWorktreeList(output) {
  const worktrees = [];
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    let path = null;
    let head = null;
    let branch = null;
    let isBare = false;
    let isDetached = false;
    let isLocked = false;
    for (const line of lines) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      } else if (line === "bare") isBare = true;
      else if (line === "detached") isDetached = true;
      else if (line.startsWith("locked")) isLocked = true;
    }
    if (path === null) continue;
    worktrees.push({ path, head, branch, isBare, isDetached, isLocked });
  }
  return worktrees;
}

// packages/core/src/hash.ts
var encoder = new TextEncoder();

// mods/worktree-orchestrator/src/register.tsx
function runnerOf($) {
  return async (argv) => {
    const result = await $.process.run(argv);
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  };
}
async function report($) {
  const run = runnerOf($);
  const listed = await run(["git", "worktree", "list", "--porcelain"]);
  if (listed.exitCode !== 0) return "Not a git repository, or git could not list worktrees.";
  const worktrees = parseWorktreeList(listed.stdout);
  const owners = /* @__PURE__ */ new Map();
  const lines = [];
  for (const worktree of worktrees) {
    const status = await run(["git", "-C", worktree.path, "status", "--porcelain=v1", "-z"]);
    const changes = status.exitCode === 0 ? parseStatusZ(status.stdout) : [];
    const label = `${worktree.branch ?? (worktree.isDetached ? "detached" : "no branch")}${worktree.isLocked ? " (locked)" : ""}`;
    lines.push(`${worktree.path} · ${label} · ${changes.length} uncommitted`);
    for (const change of changes) {
      const list = owners.get(change.path) ?? [];
      list.push(worktree.path);
      owners.set(change.path, list);
    }
  }
  const collisions = [...owners].filter(([, paths]) => paths.length > 1);
  lines.push(
    collisions.length === 0 ? "No file is changed in more than one worktree." : `Collisions (${collisions.length}):`,
    ...collisions.map(([path, paths]) => `  ${path}: ${paths.join(", ")}`)
  );
  return lines.join("\n");
}
function register(on) {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "worktrees",
      description: "List git worktrees and file collisions between them"
    });
    return next(e);
  });
  on("command.run", { command: "worktrees" }, async ($) => ({ text: await report($) }));
}
export {
  register
};
