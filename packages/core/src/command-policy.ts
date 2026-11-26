// Process-launch policy: the Bash policy applied to argv.
//
// Any mod that launches a process reaches the engine's `process.run` API, which bypasses the Bash
// tool hooks. This module judges an argv with the same classifier that judges a Bash command, so a
// destructive operation is refused whether a person typed it into the shell or a mod asked the
// engine to run it.
//
// The classifier is the sdlc-guard policy vendored from agentic-sdlc-kit at the commit recorded in
// plugins/PROVENANCE.json. It is not a sandbox: an interpreter invoked with inline code (python -c,
// node -e) is not inspected. Callers that run arbitrary argv must not rely on this alone; verify
// runs only operator-declared commands for that reason.

import { decideBash, type HookDecision } from '../../../plugins/sdlc-guard/policies/decision'

/**
 * POSIX single-quote each argument, so that the Bash tokenizer reads back exactly these words. The
 * classifier then sees the argv that the process will receive, not a re-split version of it.
 */
export function quoteArgv(argv: readonly string[]): string {
  return argv.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(' ')
}

/**
 * Decides whether a process may start. Non-interactive: a destructive action is denied outright,
 * because there is no person in the loop to approve it. An empty argv, or one containing a NUL byte,
 * is denied rather than passed on.
 */
export function decideProcess(argv: readonly string[]): HookDecision {
  if (argv.length === 0 || (argv[0] ?? '') === '') {
    return { kind: 'deny', reason: 'process policy: empty command, nothing was run' }
  }
  if (argv.some((arg) => arg.includes('\u0000'))) {
    return { kind: 'deny', reason: 'process policy: argument contains a NUL byte, nothing was run' }
  }
  return decideBash(quoteArgv(argv), { interactive: false })
}
