import type { EngineInterface, On } from 'claude-code'

import { type Claim, claimPath, pruneClaims } from '@agentic-mods/core'

const TTL_MS = 30 * 60 * 1000

async function storedClaims($: EngineInterface): Promise<Claim[]> {
  const value = await $.store.get('claims')
  return Array.isArray(value) ? (value as Claim[]) : []
}

async function claimFile($: EngineInterface, path: string): Promise<void> {
  const sessionId = await $.session.id()
  const now = await $.clock.now()
  const result = claimPath(
    await storedClaims($),
    { path, sessionId, owner: sessionId, at: now },
    TTL_MS,
    now,
  )
  await $.store.set('claims', result.claims)
  if (result.conflict !== null && result.conflict.sessionId !== sessionId) {
    $.ui.toast(`switchboard: ${path} was claimed by session ${result.conflict.sessionId} recently`)
  }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'switchboard',
      description: 'List file claims across sessions, or /switchboard send <session> <text>',
    })
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    await claimFile($, e.file_path)
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    await claimFile($, e.file_path)
    return next(e)
  })

  on('command.run', { command: 'switchboard' }, async ($, e) => {
    const [subcommand = '', target = '', ...words] = e.args.trim().split(/\s+/)
    if (subcommand === 'send') {
      const text = words.join(' ').trim()
      if (target === '' || text === '') {
        return { text: 'Usage: /switchboard send <session id> <message>' }
      }
      await $.session.send({ to: { sessionId: target }, text })
      return { text: `Message sent to session ${target}.` }
    }
    const now = await $.clock.now()
    const fresh = pruneClaims(await storedClaims($), TTL_MS, now)
    if (fresh.length === 0) return { text: 'No file claims in the last 30 minutes.' }
    const lines = fresh.map(
      claim => `${claim.path} · session ${claim.sessionId} · ${Math.round((now - claim.at) / 60000)} min ago`,
    )
    return { text: lines.join('\n') }
  })
}
