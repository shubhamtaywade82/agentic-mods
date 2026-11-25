// mod-template: starter mod (TypeScript) for the agentic-mods library.
//
// No build step: Claude Code loads .ts files directly. The import below is
// type-only and is empty at run time.
//
// Rules checked statically by `claude plugin validate`:
//   1. Event names in on(...) are string literals.
//   2. Call the mods API in full: $.namespace.method(...). Never destructure
//      or alias `$` (no `const ui = $.ui`).
//   3. ES modules only (import, never require). Relative imports inside this
//      plugin directory only, plus the bare import 'claude-code'. No import().
//   4. Don't shadow `on` inside register.
//
// Hook shape: async ($, e, next) => ...
//   $     the mods API
//   e     the event input (deeply frozen; pass a copy to next to change it)
//   next  pass the event on. Return next(e) to leave behavior unchanged.
//
// Architecture: this file is a thin adapter over hooks/lib/*.ts. The libs are
// pure TypeScript with no Claude Code imports, so they can be type-checked
// with a pinned tsc and unit-tested without a session.

import type { Register } from 'claude-code'
import { AttemptCounter, LABELS } from './lib/counter'
import { formatUsage } from './lib/usage'

// State is shared by the hooks below. It resets whenever the mod reloads.
const counter = new AttemptCounter()

export const register: Register = (on) => {
  // OBSERVE: runs once at session start (and after each reload of this mod).
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mod-template-tally',
      description: 'Show how many tool-call attempts Claude has made',
    })
    await $.command.register({
      name: 'mod-template-usage',
      description: 'Show context and plan-limit usage',
    })
    return next(e)
  })

  // OBSERVE: runs before every tool call. Count the ATTEMPT, redraw, let it
  // run. The count includes calls that later fail or are denied, because it
  // increments before next(e).
  // .catch runs if this hook throws or times out. A pure counter fails open
  // (the tool still runs). A GUARD should fail closed instead:
  //   .catch(async ($, e, next) =>
  //     next.called ? next(e) : { deny: 'mod-template failed; refusing this call' })
  on('tool.call', async ($, e, next) => {
    counter.increment()
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // GUARD example: refuse a call by returning { deny: 'reason' } instead of
  // calling next. The matcher limits it to one tool:
  //   on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
  //     if (/* your condition on e */ false) return { deny: 'Use the file tools.' }
  //     return next(e)
  //   })

  // ANSWER: runs only for /mod-template-tally (the matcher filters it).
  on('command.run', { command: 'mod-template-tally' }, async () => {
    return { text: LABELS.tally(counter.value) }
  })

  // ANSWER: usage readout from the session. Formatting lives in lib/usage.ts
  // and is regression-tested for empty/multiple/missing rate-limit data.
  on('command.run', { command: 'mod-template-usage' }, async ($) => {
    const u = await $.session.usage()
    return { text: formatUsage(u) }
  })

  // REWRITE: add the count after the spinner word. Keep Claude Code's own
  // spinner by passing a changed copy of e to next.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    return next({
      ...e,
      props: { ...e.props, suffix: ` · ${LABELS.counter}: ${counter.value}…` },
    })
  })
}
