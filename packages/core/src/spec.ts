/**
 * Acceptance criteria in Given / When / Then form. The validator checks structure only: that each
 * scenario has all three steps and that the non-functional sections are present. It does not
 * judge whether the criteria are the right ones.
 */
export type SpecIssue = {
  line: number
  message: string
}

export type SpecReport = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  scenarios: number
  issues: SpecIssue[]
  missingSections: string[]
}

export const REQUIRED_SECTIONS = ['performance', 'security', 'compatibility', 'observability', 'rollback'] as const

export function validateSpec(text: string): SpecReport {
  const issues: SpecIssue[] = []
  const lines = text.split('\n')
  let scenarios = 0
  let current: { line: number; steps: Set<string> } | null = null

  const closeScenario = (): void => {
    if (current === null) return
    for (const step of ['Given', 'When', 'Then']) {
      if (!current.steps.has(step)) {
        issues.push({ line: current.line, message: `scenario has no ${step} step` })
      }
    }
    current = null
  }

  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (/^Scenario(\s+Outline)?:/.test(line)) {
      closeScenario()
      scenarios++
      current = { line: index + 1, steps: new Set() }
      return
    }
    const step = /^(Given|When|Then|And|But)\b/.exec(line)
    if (step !== null && current !== null) {
      const kind = step[1] ?? ''
      if (kind === 'And' || kind === 'But') return
      ;(current as { line: number; steps: Set<string> }).steps.add(kind)
    }
  })
  closeScenario()
  if (scenarios === 0) issues.push({ line: 0, message: 'no Scenario found' })

  const lower = text.toLowerCase()
  const missingSections = REQUIRED_SECTIONS.filter(section => !lower.includes(section))
  const verdict: SpecReport['verdict'] =
    issues.length > 0 ? 'FAIL' : missingSections.length > 0 ? 'UNKNOWN' : 'PASS'
  return { verdict, scenarios, issues, missingSections: [...missingSections] }
}
