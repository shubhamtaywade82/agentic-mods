import type { EngineInterface, On } from 'claude-code'

import { type GitRunner, parseStatusZ, parseWorktreeList } from '@agentic-mods/core'

function runnerOf($: EngineInterface): GitRunner {
  return async argv => {
    const result = await $.process.run(argv)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

async function report($: EngineInterface): Promise<string> {
  const run = runnerOf($)
  const listed = await run(['git', 'worktree', 'list', '--porcelain'])
  if (listed.exitCode !== 0) return 'Not a git repository, or git could not list worktrees.'
  const worktrees = parseWorktreeList(listed.stdout)
  const owners = new Map<string, string[]>()
  const lines: string[] = []

  for (const worktree of worktrees) {
    const status = await run(['git', '-C', worktree.path, 'status', '--porcelain=v1', '-z'])
    const changes = status.exitCode === 0 ? parseStatusZ(status.stdout) : []
    const label = `${worktree.branch ?? (worktree.isDetached ? 'detached' : 'no branch')}${worktree.isLocked ? ' (locked)' : ''}`
    lines.push(`${worktree.path} · ${label} · ${changes.length} uncommitted`)
    for (const change of changes) {
      const list = owners.get(change.path) ?? []
      list.push(worktree.path)
      owners.set(change.path, list)
    }
  }

  const collisions = [...owners].filter(([, paths]) => paths.length > 1)
  lines.push(
    collisions.length === 0
      ? 'No file is changed in more than one worktree.'
      : `Collisions (${collisions.length}):`,
    ...collisions.map(([path, paths]) => `  ${path}: ${paths.join(', ')}`),
  )
  return lines.join('\n')
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'worktrees', description: 'List git worktrees and file collisions between them' })
    return next(e)
  })

  on('command.run', { command: 'worktrees' }, async $ => ({ text: await report($) }))
}
