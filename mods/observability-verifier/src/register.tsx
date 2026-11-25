import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { readJsonFile, stateRelativePath, truncate } from '@agentic-mods/core'
import type { GateState } from '../types'

type Check = { name: string; url: string; expectStatus: number }

const IDLE: GateState = { verdict: 'UNKNOWN', phase: 'none', reason: 'no health check run' }
const gate = atom({ plugin: 'observability-verifier', key: 'gate' } as const, IDLE, {
  shape: 'gate-1',
})

/** The configured checks, or why the file could not be used. */
async function checksOf($: EngineInterface): Promise<Check[] | { error: string }> {
  const file = await readJsonFile(
    (path) => $.fs.read(path),
    stateRelativePath('observability.json'),
  )
  if (file.kind === 'invalid') return { error: file.reason }
  if (file.kind === 'missing' || !Array.isArray(file.value)) return []
  return file.value.filter(
    (item): item is Check =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Check).name === 'string' &&
      typeof (item as Check).url === 'string' &&
      typeof (item as Check).expectStatus === 'number',
  )
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'observe',
      description: 'Health checks after a change: /observe check',
    })
    return next(e)
  })

  on('command.run', { command: 'observe' }, async ($, e) => {
    if (e.args.trim() !== 'check') return { text: 'Usage: /observe check' }
    const checks = await checksOf($)
    if (!Array.isArray(checks)) return { text: checks.error }
    if (checks.length === 0) {
      return {
        text: 'No checks configured. Add a list of {name, url, expectStatus} to .agentic-mods/observability.json.',
      }
    }
    const lines: string[] = []
    let failures = 0
    for (const check of checks) {
      try {
        const response = await $.http.fetch(check.url)
        const passed = response.status === check.expectStatus
        if (!passed) failures++
        lines.push(
          `${check.name}: ${passed ? 'PASS' : 'FAIL'} (${response.status}, expected ${check.expectStatus})`,
        )
      } catch (error) {
        failures++
        lines.push(
          `${check.name}: FAIL (${truncate(error instanceof Error ? error.message : 'request failed', 120)})`,
        )
      }
    }
    const verdict: GateState['verdict'] = failures === 0 ? 'PASS' : 'FAIL'
    await update($, gate, () => ({
      verdict,
      phase: 'checked',
      reason: `${checks.length - failures}/${checks.length} health check(s) passed`,
    }))
    return { text: lines.join('\n') }
  })
}
