import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { appendJsonLine, auditLine, redact, stateRelativePath, truncate } from '@agentic-mods/core'
import type { IncidentState } from '../types'

const PLUGIN = 'incident-timeline'
const TIMELINE_CAP = 2000
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/

const IDLE: IncidentState = { isOpen: false, profile: 'standard', id: null }
const incident = atom({ plugin: 'incident-timeline', key: 'incident' } as const, IDLE, {
  shape: 'incident-1',
})

type Kind = 'opened' | 'event' | 'mitigation' | 'recovery' | 'closed'
type Row = { at: string; plugin: string; kind: Kind; text: string; id: string }

async function writeLine($: EngineInterface, id: string, kind: Kind, text: string): Promise<void> {
  const path = stateRelativePath(`incidents/${id}.jsonl`)
  let existing: string
  try {
    existing = await $.fs.read(path)
  } catch {
    existing = ''
  }
  const line = auditLine({ plugin: PLUGIN, kind, text, id }, Date.now())
  await $.fs.write(path, appendJsonLine(existing, line, TIMELINE_CAP))
  await $.store.set('lastIncident', id)
}

async function openIncident($: EngineInterface, parts: readonly string[]): Promise<string> {
  const [id = '', ...titleWords] = parts
  if (!ID_PATTERN.test(id))
    return 'Usage: /incident open <id> <title>. The id is letters, digits, - or _.'
  const state = await read($, incident)
  if (state.isOpen) return `Incident ${state.id} is already open. Close it first.`
  await update($, incident, () => ({ isOpen: true, profile: 'strict' as const, id }))
  await writeLine($, id, 'opened', truncate(titleWords.join(' ') || 'untitled', 200))
  $.ui.toast(`Incident ${id} open: strict command profile on`)
  return `Incident ${id} opened. Command guard now uses the strict profile.`
}

async function appendRow($: EngineInterface, kind: Kind, body: string): Promise<string> {
  const state = await read($, incident)
  if (!state.isOpen || state.id === null)
    return 'No incident is open. Use /incident open <id> <title>.'
  if (body.length === 0) return 'Nothing to record.'
  await writeLine($, state.id, kind, truncate(body, 2000))
  return `Recorded ${kind} for ${state.id}.`
}

async function closeIncident($: EngineInterface): Promise<string> {
  const state = await read($, incident)
  if (!state.isOpen || state.id === null) return 'No incident is open.'
  await writeLine($, state.id, 'closed', 'incident closed')
  await update($, incident, () => IDLE)
  $.ui.toast(`Incident ${state.id} closed: standard command profile restored`)
  return `Incident ${state.id} closed. Run /incident postmortem to write the review.`
}

async function writePostmortem($: EngineInterface): Promise<string> {
  const state = await read($, incident)
  const id = state.id ?? (await $.store.get('lastIncident'))
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return 'No incident to write up.'
  let raw: string
  try {
    raw = await $.fs.read(stateRelativePath(`incidents/${id}.jsonl`))
  } catch {
    return `No timeline for ${id}.`
  }
  const rows = raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row)
  const table = rows.map((row) => `| ${row.at} | ${row.kind} | ${row.text.replace(/\|/g, '\\|')} |`)
  const mitigation = rows.filter((row) => row.kind === 'mitigation').map((row) => `- ${row.text}`)
  const recovery = rows.filter((row) => row.kind === 'recovery').map((row) => `- ${row.text}`)
  const document = [
    `# Postmortem ${id}`,
    '',
    '## Timeline',
    '| time | kind | detail |',
    '| --- | --- | --- |',
    ...table,
    '',
    '## Mitigation',
    ...(mitigation.length > 0 ? mitigation : ['- none recorded']),
    '',
    '## Recovery evidence',
    ...(recovery.length > 0 ? recovery : ['- none recorded']),
    '',
    '## Follow-ups',
    '- [ ] Owner and due date for each follow-up (add with /incident event)',
    '- [ ] Regression test or monitor that would have caught this',
    '',
  ].join('\n')
  const path = stateRelativePath(`incidents/${id}-postmortem.md`)
  await $.fs.write(path, redact(document))
  return `Postmortem written to ${path}.`
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'incident',
      description: 'Open, log, mitigate, recover and close an incident, or write its postmortem',
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, incident)
    if (!state.isOpen) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>
          INCIDENT {state.id ?? 'unnamed'} · strict command profile on · /incident close to end
        </Text>
      </Box>
    )
  })

  on('command.run', { command: 'incident' }, async ($, e) => {
    const [subcommand = '', ...rest] = e.args.trim().split(/\s+/)
    const text = rest.join(' ').trim()
    switch (subcommand) {
      case 'open':
        return { text: await openIncident($, rest) }
      case 'event':
        return { text: await appendRow($, 'event', text) }
      case 'mitigate':
        return { text: await appendRow($, 'mitigation', text) }
      case 'recover':
        return { text: await appendRow($, 'recovery', text) }
      case 'close':
        return { text: await closeIncident($) }
      case 'postmortem':
        return { text: await writePostmortem($) }
      default:
        return {
          text: 'Usage: /incident open <id> <title> | event <text> | mitigate <text> | recover <text> | close | postmortem',
        }
    }
  })
}
