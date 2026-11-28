// Test-strength evidence: mutation-score verdicts for the evidence chain.
//
// Passing evidence proves a configured command exited 0. It does not prove the suite would
// catch a regression: a suite that asserts almost nothing passes exactly as fast as a rigorous
// one. Strength evidence runs the stack's mutation tool under a hard budget and records a score.
//
// Vocabulary is kept aligned with the kit's StrengthEvidence contract (agentic-sdlc-kit ADR-0022)
// so mods and kit read the same evidence concept: status is `passed`, `failed` or `incomplete`,
// and `incomplete` means the score is UNKNOWN — a timeout or a crash is never silently 0 and
// never silently skipped.
//
// Honest limits (repeated from the kit ADR because a module must not overclaim):
//   - The mutation score is a PROXY, not proof. It measures how many generated mutants the
//     suite killed on THIS run with THIS tool.
//   - `scope: diff` mutates only the files changed in the working tree. A cross-file escape
//     (a mutant in file A caught only by a test of file B) can be missed when B is outside
//     the diff.
//   - Output parsing is best effort: when a tool prints a score we cannot read, the run is
//     `incomplete` with the reason, never a guessed score.

import type { CheckName } from './classify'

/** The mutation tools a stack can use. Recorded so the score is interpretable later. */
export const MUTATION_TOOLS = [
  'stryker', // node-typescript, react (StrykerJS)
  'mutmut', // python
  'mutant', // ruby, ruby-rails
  'go-mutesting', // go
  'gremlins', // go (shares the runner, recorded distinctly)
  'cargo-mutants', // rust
  'stryker-net', // dotnet (Stryker.NET)
] as const
export type MutationTool = (typeof MUTATION_TOOLS)[number]

export function isMutationTool(value: unknown): value is MutationTool {
  return typeof value === 'string' && (MUTATION_TOOLS as readonly string[]).includes(value)
}

/** `diff` = only the changed files (quick sessions stay quick); `suite` = everything. */
export const STRENGTH_SCOPES = ['diff', 'suite'] as const
export type StrengthScope = (typeof STRENGTH_SCOPES)[number]

/**
 * The strength section of `.agentic-mods/config.json`. Disabled by default: until it is
 * configured, the chain behaves exactly as before.
 */
export type StrengthSettings = {
  enabled: boolean
  /** Mutation score percentage required for a pass (0–100). */
  threshold: number
  /** Hard cap on one mutation run. A run over budget is `incomplete`, never skipped. */
  budgetMs: number
  scope: StrengthScope
}

export const DEFAULT_STRENGTH_SETTINGS: StrengthSettings = {
  enabled: false,
  threshold: 60,
  budgetMs: 120_000,
  scope: 'diff',
}

/** Mutant tallies as parsed from tool output. */
export type StrengthCounts = {
  mutantsGenerated: number
  mutantsKilled: number
  mutantsSurvived: number
}

export type StrengthStatus = 'passed' | 'failed' | 'incomplete'

/**
 * The result of one strength run, as recorded on the check record. Field names match the kit's
 * StrengthEvidence contract so both sides read the same evidence.
 */
export type StrengthRun = {
  /** The tool that ran, or null when no run happened (nothing detected, nothing declared). */
  tool: MutationTool | null
  status: StrengthStatus
  /** Mutation score percentage 0–100. Null when the run is `incomplete`. */
  score: number | null
  counts: StrengthCounts | null
  scope: StrengthScope
  threshold: number
  budgetMs: number
  durationMs: number
  /** Bounded human-readable derivation (never full tool output). */
  summary: string
}

/**
 * Deterministic mutation score: round(100 * killed / generated). Null when no mutants were
 * generated — a suite with nothing to kill has no measurable strength, and reporting 0 would
 * claim a measurement that was not made.
 */
export function computeMutationScore(counts: StrengthCounts): number | null {
  if (counts.mutantsGenerated <= 0) return null
  return Math.round((100 * counts.mutantsKilled) / counts.mutantsGenerated)
}

/** A `passed`/`failed` status from a known score. An unknown score stays `incomplete`. */
export function resolveStrengthStatus(
  score: number | null,
  threshold: number,
): 'passed' | 'failed' | 'incomplete' {
  if (score === null) return 'incomplete'
  return score >= threshold ? 'passed' : 'failed'
}

/** Builds the bounded summary line for a completed run. */
export function strengthSummary(
  score: number | null,
  counts: StrengthCounts | null,
  threshold: number,
): string {
  if (score === null) return 'no measurable mutation score'
  const tally =
    counts === null
      ? ''
      : ` (${counts.mutantsKilled}/${counts.mutantsGenerated} mutants killed)`
  return `mutation score ${score}%${tally} against threshold ${threshold}%`
}

const SCORE_LINE =
  /(?:mutation\s+score|scored|score)\D{0,20}?(\d{1,3}(?:[.,]\d+)?)\s*%/i
const KILLED_LINE = /(\d+)\s+mutants?\s+killed/i
const KILLED_LINE_SHORT = /(\d+)\s+killed/i
const KILLED_AFTER = /killed\s*:?\s*(\d+)/i
const SURVIVED_LINE = /(\d+)\s+(?:mutants?\s+)?(?:survived|lived|missed)/i
const SURVIVED_AFTER = /survived\s*:?\s*(\d+)/i
const GENERATED_LINE = /(\d+)\s+mutants?\s+(?:tested|generated)/i

function firstGroup(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text)
  if (match === null) return null
  const value = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(value) ? value : null
}

/**
 * Parses what a mutation tool printed. Strict per-tool strategies first, a generic fallback
 * second. A null tool (a declared argv that is not a known mutation tool) uses the generic
 * parser. Returns what could be read and nothing more: unparsable output gives nulls and the
 * caller records `incomplete` rather than guessing.
 */
export function parseStrengthOutput(
  tool: MutationTool | null,
  stdout: string,
): {
  score: number | null
  counts: StrengthCounts | null
} {
  const text = stdout.slice(-20_000)
  if (tool === 'mutmut') {
    // mutmut prints counters, e.g. `42/42  🎉 41  ⏰ 0  🤔 0  🙁 1`.
    // 🎉 killed, ⏰ timeout (a caught mutant: the test hung), 🙁 survived, 🤔 suspicious.
    // Timeout mutants count as killed (the suite detected them); suspicious ones count as
    // survived (they were not killed). This is conservative and documented here.
    const counts: Record<string, number> = {}
    const line = /(\d+)\s*\/\s*(\d+)[^(\n]*/.exec(text)?.[0] ?? ''
    for (const [glyph, name] of [
      ['\u{1F389}', 'killed'],
      ['\u23F0', 'timeout'],
      ['\u{1F914}', 'suspicious'],
      ['\u{1F641}', 'survived'],
    ] as const) {
      const match = new RegExp(`${glyph}\\s*(\\d+)`, 'u').exec(line)
      counts[name] = match === null ? 0 : Number.parseInt(match[1] ?? '0', 10)
    }
    const total = /(\d+)\s*\/\s*(\d+)/.exec(text)
    if (total !== null) {
      const mutantsGenerated = Number.parseInt(total[2] ?? '0', 10)
      const mutantsKilled = (counts['killed'] ?? 0) + (counts['timeout'] ?? 0)
      const mutantsSurvived = (counts['survived'] ?? 0) + (counts['suspicious'] ?? 0)
      if (Number.isFinite(mutantsGenerated) && mutantsGenerated > 0) {
        const parsed = { mutantsGenerated, mutantsKilled, mutantsSurvived }
        return { score: computeMutationScore(parsed), counts: parsed }
      }
    }
    return { score: null, counts: null }
  }
  if (tool === 'mutant') {
    // mutant prints JSON with --format json; the parser only accepts strict JSON.
    const json = /(\{[\s\S]*\})\s*$/.exec(text.trim())
    if (json !== null) {
      try {
        const parsed: unknown = JSON.parse(json[1] ?? '')
        if (typeof parsed === 'object' && parsed !== null) {
          const summary = (parsed as { summary?: unknown }).summary
          if (typeof summary === 'object' && summary !== null) {
            const num = (key: string): number | null => {
              const value = (summary as Record<string, unknown>)[key]
              return typeof value === 'number' && Number.isFinite(value) ? value : null
            }
            const generated = num('generated')
            const killed = num('killed')
            const timeout = num('timeout')
            if (generated !== null && killed !== null) {
              // Not-covered and no-test mutants are not killed by any test: count them as
              // survived. Conservative, and it keeps killed + survived = generated.
              const notCovered = num('not_covered') ?? 0
              const noTests = num('no_tests') ?? 0
              const mutantsKilled = killed + (timeout ?? 0)
              const counts = {
                mutantsGenerated: generated,
                mutantsKilled,
                mutantsSurvived: Math.max(0, generated - mutantsKilled - notCovered - noTests),
              }
              return { score: computeMutationScore(counts), counts }
            }
          }
        }
      } catch {
        // Not JSON: fall through to the generic parser.
      }
    }
  }
  if (tool === 'gremlins') {
    // gremlins prints `Killed: 40, Lived: 10, Not covered: 2` and a mutation score line.
    const killed = firstGroup(/killed:\s*(\d+)/i, text)
    const lived = firstGroup(/lived:\s*(\d+)/i, text)
    if (killed !== null && lived !== null) {
      const counts = {
        mutantsGenerated: killed + lived,
        mutantsKilled: killed,
        mutantsSurvived: lived,
      }
      const scoreLine = SCORE_LINE.exec(text)
      const score =
        scoreLine === null
          ? computeMutationScore(counts)
          : Math.round(Number.parseFloat((scoreLine[1] ?? '0').replace(',', '.')))
      return { score: Number.isFinite(score) ? score : null, counts }
    }
    return { score: null, counts: null }
  }

  // Generic parser: the score line first, tallies second. Applies to stryker, stryker-net,
  // go-mutesting and cargo-mutants, whose text reports all carry these lines.
  const scoreMatch = SCORE_LINE.exec(text)
  const score =
    scoreMatch === null
      ? null
      : Math.round(Number.parseFloat((scoreMatch[1] ?? '0').replace(',', '.')))
  const killed =
    firstGroup(KILLED_LINE, text) ??
    firstGroup(KILLED_LINE_SHORT, text) ??
    firstGroup(KILLED_AFTER, text) ??
    null
  const survived =
    firstGroup(SURVIVED_LINE, text) ?? firstGroup(SURVIVED_AFTER, text)
  const generated = firstGroup(GENERATED_LINE, text)
  if (killed === null && score === null) return { score: null, counts: null }
  if (killed !== null && (generated !== null || survived !== null)) {
    const mutantsGenerated = Math.max(
      killed + (survived ?? 0),
      generated !== null && generated >= killed ? generated : killed + (survived ?? 0),
    )
    const counts = {
      mutantsGenerated,
      mutantsKilled: killed,
      mutantsSurvived: mutantsGenerated - killed,
    }
    return { score: score ?? computeMutationScore(counts), counts }
  }
  return { score, counts: null }
}

/**
 * The stack detection result. `manifest` names where the tool was detected so the summary can
 * say how the command was chosen; the tool must be detectable from the project, otherwise the
 * run is `incomplete` — detection never installs anything.
 */
export type StrengthCommand = {
  tool: MutationTool
  argv: readonly string[]
  manifest: string
}

type ProjectFiles = {
  /** package.json contents, or null when absent. */
  packageJson: string | null
  pyproject: string | null
  requirements: string | null
  gemfile: string | null
  goMod: string | null
  cargoToml: string | null
  /** Any .csproj or .sln content marker (the file need not be read fully). */
  dotnet: string | null
}

const SOURCE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|cs|java)$/i

/** Source files worth mutating for a `diff` scope run; test files are excluded. */
export function mutableFilesOf(changedPaths: readonly string[]): string[] {
  return changedPaths.filter(
    (path) =>
      SOURCE_PATTERN.test(path) &&
      !/(?:[._-](?:test|spec)|__tests__|\/tests?\/)/i.test(path) &&
      !path.startsWith('node_modules/'),
  )
}

/**
 * Detects the stack's mutation tool from the project's own manifests. A tool that is not
 * declared (devDependencies, requirements, Gemfile) is not detected: auto-installing tools
 * would be a side effect, so an undeclared tool is `incomplete`, never a download.
 * go, rust and dotnet tools are not manifest-declared; there the stack marker itself starts
 * the run and a missing binary fails honestly at launch.
 */
export function detectStrengthCommand(project: ProjectFiles): StrengthCommand | null {
  const pkg = project.packageJson
  if (pkg !== null) {
    let declared: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(pkg)
      if (typeof parsed === 'object' && parsed !== null) {
        const dev = (parsed as { devDependencies?: unknown }).devDependencies
        const deps = (parsed as { dependencies?: unknown }).dependencies
        if (typeof dev === 'object' && dev !== null) declared = dev as Record<string, unknown>
        if (typeof deps === 'object' && deps !== null)
          declared = { ...declared, ...(deps as Record<string, unknown>) }
      }
    } catch {
      declared = {}
    }
    if ('@stryker-mutator/core' in declared || 'stryker' in declared) {
      return {
        tool: 'stryker',
        argv: ['npx', 'stryker', 'run'],
        manifest: 'package.json',
      }
    }
    return null
  }
  if (project.pyproject !== null || project.requirements !== null) {
    const text = `${project.pyproject ?? ''}${project.requirements ?? ''}`
    if (/^mutmut\b|\bmutmut\s*[=~><=]/m.test(text)) {
      return { tool: 'mutmut', argv: ['mutmut', 'run'], manifest: 'pyproject or requirements' }
    }
    return null
  }
  if (project.gemfile !== null) {
    if (/^\s*gem\s+['"]mutant['"]/m.test(project.gemfile)) {
      return {
        tool: 'mutant',
        argv: ['bundle', 'exec', 'mutant', 'run'],
        manifest: 'Gemfile',
      }
    }
    return null
  }
  if (project.goMod !== null) {
    if (/go-gremlins|mfridman\/go-mutesting/.test(project.goMod)) {
      return { tool: 'gremlins', argv: ['gremlins', 'launch'], manifest: 'go.mod' }
    }
    return { tool: 'go-mutesting', argv: ['go-mutesting'], manifest: 'go.mod' }
  }
  if (project.cargoToml !== null) {
    return { tool: 'cargo-mutants', argv: ['cargo', 'mutants'], manifest: 'Cargo.toml' }
  }
  if (project.dotnet !== null) {
    return { tool: 'stryker-net', argv: ['dotnet', 'stryker'], manifest: 'csproj or sln' }
  }
  return null
}

/** File-selection flags per tool for a `diff` scope run. Tools without one get `null`. */
export function strengthFileArgs(
  tool: MutationTool,
  files: readonly string[],
): readonly string[] | null {
  if (files.length === 0) return null
  switch (tool) {
    case 'stryker':
      return ['--mutate', files.join(',')]
    case 'mutmut':
      return ['--paths-to-mutate', files.join(',')]
    case 'go-mutesting':
      return [...files]
    case 'cargo-mutants':
      return files.flatMap((file) => ['--file', file])
    default:
      // mutant selects by subject; Stryker.NET has no stable file flag. A diff scope run
      // goes unscoped and the summary says so: the score stays interpretable.
      return null
  }
}

/** The mutation tool a declared argv launches, or null when the argv is not a known tool. */
export function mutationToolOfArgv(argv: readonly string[]): MutationTool | null {
  const base = (argv[0] ?? '').replace(/^.*\//, '')
  const second = (argv[1] ?? '').replace(/^.*\//, '')
  if (base === 'npx' || base === 'pnpx' || base === 'bunx' || base === 'pnpm' || base === 'yarn') {
    if (second === 'stryker') return 'stryker'
    if (second === 'mutmut') return 'mutmut'
    return null
  }
  if (base === 'stryker') return 'stryker'
  if (base === 'mutmut') return 'mutmut'
  if (base === 'mutant') return 'mutant'
  if (base === 'go-mutesting') return 'go-mutesting'
  if (base === 'gremlins') return 'gremlins'
  if (base === 'cargo' && second === 'mutants') return 'cargo-mutants'
  if (base === 'dotnet' && second === 'stryker') return 'stryker-net'
  return null
}

/** The verdict line /evidence shows for a strength record, or null for any other check. */
export function strengthVerdictReason(run: StrengthRun | undefined): string | null {
  if (run === undefined) return null
  if (run.status === 'incomplete') return `incomplete: ${run.summary}`
  const tally =
    run.counts === null
      ? ''
      : ` (${run.counts.mutantsKilled}/${run.counts.mutantsGenerated} mutants killed)`
  if (run.status === 'failed') {
    return `mutation score ${run.score}%${tally} below threshold ${run.threshold}%`
  }
  return `mutation score ${run.score}%${tally}`
}

/**
 * The score trend across recent strength runs, oldest to newest, as display text. Only runs
 * with a known score appear; `incomplete` runs break the trend honestly by leaving a gap.
 */
export function strengthTrend(
  runs: readonly { check: CheckName; strength?: StrengthRun }[],
  limit = 8,
): string {
  const scores = runs
    .filter((record) => record.check === 'strength' && record.strength?.score !== null)
    .map((record) => record.strength?.score ?? null)
    .filter((score): score is number => score !== null)
    .slice(-limit)
  if (scores.length < 2) return ''
  return scores.join(' \u2192 ')
}
