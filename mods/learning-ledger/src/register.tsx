import type { EngineInterface, On } from 'claude-code'

import {
  sha256Hex,
  stateRelativePath,
  staleLinks,
  transitionLesson,
  type Lesson,
  type LessonAction,
  truncate,
} from '@agentic-mods/core'

const FILE = 'ledger.json'

async function loadLessons($: EngineInterface): Promise<Lesson[]> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(stateRelativePath(FILE)))
    return Array.isArray(parsed) ? (parsed as Lesson[]) : []
  } catch {
    return []
  }
}

async function saveLessons($: EngineInterface, lessons: readonly Lesson[]): Promise<void> {
  await $.fs.write(stateRelativePath(FILE), `${JSON.stringify(lessons, null, 2)}\n`)
}

/** The current content hash of each path, or null when it is missing. */
async function fingerprintsOf($: EngineInterface, paths: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (const path of paths) {
    try {
      out.set(path, await sha256Hex(await $.fs.read(path)))
    } catch {
      out.set(path, null)
    }
  }
  return out
}

function nextId(lessons: readonly Lesson[]): string {
  return `L-${String(lessons.length + 1).padStart(3, '0')}`
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lesson',
      description: 'Repository lessons: /lesson propose <text> | <paths>, approve|reject|retire <id>, check',
    })
    return next(e)
  })

  on('command.run', { command: 'lesson' }, async ($, e) => {
    const [subcommand = 'check', ...rest] = e.args.trim().split(/\s+/).filter(word => word.length > 0)
    const lessons = await loadLessons($)

    if (subcommand === 'propose') {
      const body = rest.join(' ')
      const [textPart = '', pathPart = ''] = body.split('|').map(part => part.trim())
      if (textPart === '') return { text: 'Usage: /lesson propose <text> | <comma-separated repository paths>' }
      const links = pathPart
        .split(',')
        .map(path => path.trim())
        .filter(path => path.length > 0)
      const fingerprints = await fingerprintsOf($, links)
      const lesson: Lesson = {
        id: nextId(lessons),
        text: truncate(textPart, 500),
        scope: links,
        links: links.map(path => ({ path, fingerprint: fingerprints.get(path) ?? null })),
        status: 'proposed',
        createdAt: await $.clock.now(),
      }
      await saveLessons($, [...lessons, lesson])
      return { text: `${lesson.id} proposed. It is not used until approved.` }
    }

    if (subcommand === 'approve' || subcommand === 'reject' || subcommand === 'retire') {
      const id = rest[0] ?? ''
      const target = lessons.find(lesson => lesson.id === id)
      if (target === undefined) return { text: `No lesson ${id}.` }
      const action: LessonAction = subcommand === 'approve' ? 'approve' : subcommand === 'reject' ? 'reject' : 'retire'
      const next = transitionLesson(target.status, action)
      if (next === null) return { text: `${id} is ${target.status}; ${action} does not apply.` }
      // Approval records the current content of every cited file, so later edits are detectable.
      const links =
        action === 'approve'
          ? (await fingerprintsOf($, target.links.map(link => link.path))) ?? new Map()
          : null
      const updated: Lesson = {
        ...target,
        status: next,
        links:
          links === null
            ? target.links
            : target.links.map(link => ({ path: link.path, fingerprint: links.get(link.path) ?? null })),
      }
      await saveLessons($, lessons.map(lesson => (lesson.id === id ? updated : lesson)))
      return { text: `${id} is now ${next}.` }
    }

    // check: report approved lessons whose cited files changed
    const approved = lessons.filter(lesson => lesson.status === 'approved' || lesson.status === 'stale')
    const lines: string[] = []
    for (const lesson of approved) {
      const current = await fingerprintsOf($, lesson.links.map(link => link.path))
      const stale = staleLinks(lesson, current)
      if (stale.length > 0) lines.push(`${lesson.id} stale: ${stale.join(', ')} changed; review it`)
    }
    return { text: lines.length === 0 ? `${approved.length} approved lesson(s), none stale.` : lines.join('\n') }
  })
}
