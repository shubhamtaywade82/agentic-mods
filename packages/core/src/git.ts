/**
 * Git is read through an injected runner (argv in, exit code and output out), so this module
 * holds no engine types and can be reused. Every call is an argv: no shell is involved.
 */
export type GitRunResult = { exitCode: number; stdout: string; stderr: string }
export type GitRunner = (argv: readonly string[]) => Promise<GitRunResult>

export type StatusEntry = {
  path: string
  index: string
  worktree: string
  isUntracked: boolean
}

/** Parses `git status --porcelain=v1 -z`. Renames consume the original path record. */
export function parseStatusZ(output: string): StatusEntry[] {
  const records = output.split('\u0000')
  const entries: StatusEntry[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ''
    if (record.length < 4) continue
    const index = record.charAt(0)
    const worktree = record.charAt(1)
    const path = record.slice(3)
    if (index === 'R' || index === 'C') i++
    entries.push({
      path,
      index,
      worktree,
      isUntracked: index === '?' && worktree === '?',
    })
  }
  return entries
}

/** Lines of `git diff --name-only -z` or similar, as paths. */
export function parseNameList(output: string): string[] {
  return output
    .split(/[\0\n]/)
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
}

export type Worktree = {
  path: string
  head: string | null
  branch: string | null
  isBare: boolean
  isDetached: boolean
  isLocked: boolean
}

/** Parses `git worktree list --porcelain`. Blocks are separated by blank lines. */
export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = []
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((line) => line.length > 0)
    if (lines.length === 0) continue
    let path: string | null = null
    let head: string | null = null
    let branch: string | null = null
    let isBare = false
    let isDetached = false
    let isLocked = false
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length)
      else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
      } else if (line === 'bare') isBare = true
      else if (line === 'detached') isDetached = true
      else if (line.startsWith('locked')) isLocked = true
    }
    if (path === null) continue
    worktrees.push({ path, head, branch, isBare, isDetached, isLocked })
  }
  return worktrees
}

/** The current commit, or null when the repository is not a git repository or has no commits. */
export async function currentHead(run: GitRunner): Promise<string | null> {
  const result = await run(['git', 'rev-parse', 'HEAD'])
  if (result.exitCode !== 0) return null
  const head = result.stdout.trim()
  return head.length > 0 ? head : null
}

/** Files with uncommitted changes, or null when git cannot answer. */
export async function workingTreeChanges(run: GitRunner): Promise<StatusEntry[] | null> {
  const result = await run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (result.exitCode !== 0) return null
  return parseStatusZ(result.stdout)
}

/** Paths that changed between two refs. */
export async function changedBetween(
  run: GitRunner,
  base: string,
  head: string,
): Promise<string[] | null> {
  const result = await run(['git', 'diff', '--name-only', '-z', `${base}...${head}`])
  if (result.exitCode !== 0) return null
  return parseNameList(result.stdout)
}
