/**
 * Slash-command names that Claude Code ships itself. `$.command.register` refuses these at run time
 * and the refusal skips the whole hook, so validation fails if a mod registers one.
 *
 * Best-effort list: the engine's own declarations do not enumerate built-ins. Keep it current when a
 * new mod is added, and trust the session's refusal notices over this list.
 */
export const BUILTIN_COMMANDS = new Set([
  'add-dir',
  'agents',
  'batch',
  'bug',
  'branch',
  'clear',
  'commit',
  'compact',
  'config',
  'context',
  'copy',
  'cost',
  'debug',
  'diff',
  'doctor',
  'effort',
  'exit',
  'export',
  'fast',
  'feedback',
  'goal',
  'help',
  'hooks',
  'ide',
  'init',
  'insights',
  'install-github-app',
  'login',
  'logout',
  'loop',
  'mcp',
  'memory',
  'model',
  'next',
  'output-style',
  'permissions',
  'plan',
  'plugin',
  'pr-comments',
  'quit',
  'rename',
  'resume',
  'review',
  'reload-plugins',
  'rewind',
  'sandbox',
  'schedule',
  'security-review',
  'simplify',
  'skills',
  'stats',
  'status',
  'statusline',
  'tasks',
  'team',
  'terminal-setup',
  'theme',
  'todos',
  'undo',
  'upgrade',
  'usage',
  'vim',
])

/** Command names a mod registers or answers, read from its source. */
export function commandNamesIn(source) {
  const names = new Set()
  for (const match of source.matchAll(
    /(?:\$\.command\.register\(|registerCommand\(\$, )\{\s*name: '([a-z0-9-]+)'/g,
  ))
    names.add(match[1])
  for (const match of source.matchAll(/\{ command: '([a-z0-9-]+)' \}/g)) names.add(match[1])
  for (const match of source.matchAll(/for \(const name of \[([^\]]*)\]/g)) {
    for (const item of match[1].matchAll(/'([a-z0-9-]+)'/g)) names.add(item[1])
  }
  // Tables of [name, alias, description] rows, declared as COMMANDS in a mod.
  const table = source.indexOf('const COMMANDS')
  if (table >= 0) {
    const block = source.slice(table, source.indexOf('\n]', table))
    for (const match of block.matchAll(/\['([a-z0-9-]+)',\s*(?:'[a-z]+'|null),/g))
      names.add(match[1])
  }
  return [...names].sort()
}

/** Registered command names that have no `command.run` handler, so they would answer nothing. */
export function unhandledCommandsIn(source) {
  const handled = new Set(
    [...source.matchAll(/\{ command: '([a-z0-9-]+)' \}/g)].map((match) => match[1]),
  )
  return commandNamesIn(source).filter((name) => !handled.has(name))
}
