import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import {
  advanceRun,
  evaluateGate,
  type Exception,
  type FactValue,
  type GateDefinition,
  parseGates,
  parseWorkflow,
  type RunState,
  startRun,
  stageOf,
  stateRelativePath,
  type WorkflowDefinition,
  truncate,
} from '@agentic-mods/core'
import type { EvidenceStatus } from '../../evidence-gate/types'
import type { ContractStatus } from '../../change-contract/types'
import type { ReviewGate } from '../../review-tracker/types'
import type { ArchitectureStatus } from '../../architecture-guard/types'
import type { MigrationStatus } from '../../migration-sentinel/types'
import type { RadarStatus } from '../../dependency-radar/types'
import type { BudgetStatus } from '../../performance-budget/types'
import type { ConductorState } from '../types'

import featureDevelopment from '../../../workflows/feature-development.json'
import tdd from '../../../workflows/tdd.json'
import bugFix from '../../../workflows/bug-fix.json'
import regression from '../../../workflows/regression.json'
import refactoring from '../../../workflows/refactoring.json'
import pullRequest from '../../../workflows/pull-request.json'
import release from '../../../workflows/release.json'
import hotfix from '../../../workflows/hotfix.json'
import incidentResponse from '../../../workflows/incident-response.json'
import gatesCatalogue from '../../../gates/gates.json'

const PANE = 'workflow-conductor'
const RAW_WORKFLOWS: readonly unknown[] = [
  featureDevelopment,
  tdd,
  bugFix,
  regression,
  refactoring,
  pullRequest,
  release,
  hotfix,
  incidentResponse,
]

const WORKFLOWS = new Map<string, WorkflowDefinition>()
for (const raw of RAW_WORKFLOWS) {
  const parsed = parseWorkflow(raw)
  if (parsed.ok) WORKFLOWS.set(parsed.value.id, parsed.value)
}
const GATES_RESULT = parseGates(gatesCatalogue)
const GATES: Readonly<Record<string, GateDefinition>> = GATES_RESULT.ok ? GATES_RESULT.value : {}

const IDLE: ConductorState = { active: false, workflow: '', task: '', stage: '', status: 'none', blockers: [] }
const conductor = atom({ plugin: 'workflow-conductor', key: 'conductor' } as const, IDLE, { shape: 'conductor-1' })

const EVIDENCE_IDLE: EvidenceStatus = { overall: 'UNKNOWN', checks: [], fingerprint: null }
const CONTRACT_IDLE: ContractStatus = { active: false, objective: '', violations: 0, mode: 'warn' }
const REVIEW_IDLE: ReviewGate = { verdict: 'UNKNOWN', openHigh: 0, open: 0, reason: 'none' }
const ARCH_IDLE: ArchitectureStatus = { verdict: 'UNKNOWN', reason: 'none', fresh: 0, baseline: 0 }
const MIGRATION_IDLE: MigrationStatus = { verdict: 'UNKNOWN', findings: [] }
const RADAR_IDLE: RadarStatus = { verdict: 'UNKNOWN', changes: [], scan: 'none' }
const BUDGET_IDLE: BudgetStatus = { verdict: 'UNKNOWN', rows: [] }

const evidence = atom({ plugin: 'evidence-gate', key: 'status' } as const, EVIDENCE_IDLE, { shape: 'status-1' })
const contract = atom({ plugin: 'change-contract', key: 'status' } as const, CONTRACT_IDLE, { shape: 'status-1' })
const review = atom({ plugin: 'review-tracker', key: 'gate' } as const, REVIEW_IDLE, { shape: 'gate-1' })
const architecture = atom({ plugin: 'architecture-guard', key: 'status' } as const, ARCH_IDLE, { shape: 'status-1' })
const migration = atom({ plugin: 'migration-sentinel', key: 'status' } as const, MIGRATION_IDLE, { shape: 'status-1' })
const dependencies = atom({ plugin: 'dependency-radar', key: 'status' } as const, RADAR_IDLE, { shape: 'status-1' })
const performance = atom({ plugin: 'performance-budget', key: 'status' } as const, BUDGET_IDLE, { shape: 'status-1' })

// Gate-publishing mods share one shape: { verdict, phase, reason }.
const SPEC_IDLE = { verdict: 'UNKNOWN' as const, phase: 'none', reason: 'not run' }
const specification = atom({ plugin: 'specification-guard', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const plan = atom({ plugin: 'change-planner', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const regressionGate = atom({ plugin: 'regression-orchestrator', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const tddGate = atom({ plugin: 'tdd-conductor', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const defectGate = atom({ plugin: 'defect-protocol', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const behaviorGate = atom({ plugin: 'behavior-lock', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const compatGate = atom({ plugin: 'contract-compatibility-guard', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const observabilityGate = atom({ plugin: 'observability-verifier', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })
const releaseGate = atom({ plugin: 'release-conductor', key: 'gate' } as const, SPEC_IDLE, { shape: 'gate-1' })

type Gate = { verdict: string; phase: string; reason: string }

/** Every fact a gate can name, derived from the states the mods publish. */
async function factsOf($: EngineInterface): Promise<Record<string, FactValue>> {
  const [ev, ct, rv, ar, mg, rd, bd, sp, pl, rg, td, df, bh, cp, ob, rl] = await Promise.all([
    read($, evidence),
    read($, contract),
    read($, review),
    read($, architecture),
    read($, migration),
    read($, dependencies),
    read($, performance),
    read($, specification),
    read($, plan),
    read($, regressionGate),
    read($, tddGate),
    read($, defectGate),
    read($, behaviorGate),
    read($, compatGate),
    read($, observabilityGate),
    read($, releaseGate),
  ])
  const pass = (value: string | undefined): FactValue => (value === 'PASS' ? 'PASS' : value === 'FAIL' ? 'FAIL' : 'UNKNOWN')
  const phased = (gate: Gate, phase: string): FactValue => (gate.phase === phase && gate.verdict === 'PASS' ? 'PASS' : 'UNKNOWN')
  const behaviorBaseline: FactValue =
    (bh.phase === 'baseline' || bh.phase === 'compared') && bh.verdict === 'PASS' ? 'PASS' : 'UNKNOWN'
  return {
    evidence: pass(ev.overall),
    contract: !ct.active ? 'UNKNOWN' : ct.violations === 0 ? 'PASS' : 'FAIL',
    review: pass(rv.verdict),
    architecture: pass(ar.verdict),
    migration: pass(mg.verdict),
    dependencies: pass(rd.verdict),
    performance: pass(bd.verdict),
    specification: pass(sp.verdict),
    plan: pass(pl.verdict),
    regression: pass(rg.verdict),
    'tdd-red': phased(td, 'red'),
    'tdd-green': phased(td, 'green'),
    'tdd-refactor': phased(td, 'refactor'),
    defects: pass(df.verdict),
    'defect-fix': df.phase === 'fixed' && df.verdict === 'PASS' ? 'PASS' : 'UNKNOWN',
    'behavior-baseline': behaviorBaseline,
    behavior: phased(bh, 'compared'),
    compat: pass(cp.verdict),
    observability: pass(ob.verdict),
    release: pass(rl.verdict),
  }
}

/** Facts that an approved deferral covers become DEFERRED. A FAIL is never deferred. */
function withDeferrals(
  facts: Record<string, FactValue>,
  exceptions: readonly Exception[],
): Record<string, FactValue> {
  const out = { ...facts }
  for (const item of exceptions) {
    const gate = GATES[item.gate]
    if (gate === undefined) continue
    for (const fact of gate.facts) {
      const value = out[fact]
      if (value !== undefined && value !== 'PASS' && value !== 'FAIL') out[fact] = 'DEFERRED'
    }
  }
  return out
}

function definitionOf(run: RunState): WorkflowDefinition | undefined {
  return WORKFLOWS.get(run.workflowId)
}

async function loadRun($: EngineInterface): Promise<RunState | null> {
  const value = await $.store.get('run')
  return value === null || value === undefined ? null : (value as RunState)
}

async function saveRun($: EngineInterface, run: RunState | null): Promise<void> {
  await $.store.set('run', run)
  const definition = run === null ? undefined : definitionOf(run)
  const blockers = await blockersOf($, run, definition)
  await update($, conductor, () =>
    run === null || definition === undefined
      ? IDLE
      : {
          active: run.status === 'active',
          workflow: run.workflowId,
          task: run.taskId,
          stage: run.currentStage,
          status: run.status,
          blockers,
        },
  )
}

async function blockersOf(
  $: EngineInterface,
  run: RunState | null,
  definition: WorkflowDefinition | undefined,
): Promise<string[]> {
  if (run === null || definition === undefined || run.status !== 'active') return []
  const stage = stageOf(definition, run.currentStage)
  if (stage === undefined || stage.gate === null) return []
  const gate = GATES[stage.gate]
  if (gate === undefined) return []
  const facts = withDeferrals(await factsOf($), run.exceptions)
  const evaluation = evaluateGate(gate, facts, run.exceptions)
  return [...evaluation.missing, ...evaluation.failing].map(fact => `${stage.gate}: ${fact}`)
}

async function ensureArtifact($: EngineInterface, task: string, file: string, title: string): Promise<void> {
  const path = stateRelativePath(`tasks/${task}/${file}`)
  try {
    await $.fs.read(path)
  } catch {
    await $.fs.write(path, `# ${title}\n\nTask: ${task}\n`)
  }
}

async function appendArtifact($: EngineInterface, task: string, file: string, text: string): Promise<void> {
  const path = stateRelativePath(`tasks/${task}/${file}`)
  let existing = ''
  try {
    existing = await $.fs.read(path)
  } catch {
    existing = `# ${file}\n\nTask: ${task}\n`
  }
  await $.fs.write(path, `${existing}\n${text}\n`)
}

function statusText(definition: WorkflowDefinition, run: RunState, blockers: readonly string[]): string {
  const lines = [`${definition.id} · task ${run.taskId} · ${run.status}`]
  for (const stage of definition.stages) {
    const marker = stage.id === run.currentStage ? '>' : run.history.some(item => item.stage === stage.id) ? 'x' : ' '
    const gate = stage.gate === null ? '' : ` [gate ${stage.gate}]`
    lines.push(`${marker} ${stage.name}${gate}`)
  }
  if (blockers.length > 0) lines.push('', 'Blocked:', ...blockers.map(item => `  ${item}`))
  if (run.exceptions.length > 0) {
    lines.push('', 'Approved deferrals:', ...run.exceptions.map(item => `  ${item.gate}: ${item.reason} (approved by ${item.approvedBy})`))
  }
  return lines.join('\n')
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workflow',
      description: 'Delivery workflow: /workflow start|status|advance|defer|cancel',
    })
    await $.command.register({ name: 'record', description: 'Append to a task artifact: /record <file.md> <text>' })
    await $.command.register({ name: 'decision', description: 'Record a decision: /decision <title> | <decision> | <consequences>' })
    return next(e)
  })

  on('command.run', { command: 'workflow' }, async ($, e) => {
    const [subcommand = 'status', ...rest] = e.args.trim().split(/\s+/).filter(word => word.length > 0)
    const run = await loadRun($)

    if (subcommand === 'start') {
      const [workflowId = '', ...taskParts] = rest
      const task = taskParts.join('-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)
      const definition = WORKFLOWS.get(workflowId)
      if (definition === undefined) {
        return { text: `Unknown workflow. Available: ${[...WORKFLOWS.keys()].join(', ')}` }
      }
      if (run !== null && run.status === 'active') {
        return { text: `Task ${run.taskId} is active. Cancel it or complete it first.` }
      }
      if (task === '') return { text: 'Usage: /workflow start <workflow> <task-id>' }
      const at = await $.clock.now()
      const started = startRun(definition, `${workflowId}-${task}-${at}`, task, at)
      const stage = stageOf(definition, started.currentStage)
      if (stage?.artifact) await ensureArtifact($, task, stage.artifact, stage.name)
      await saveRun($, started)
      return { text: statusText(definition, started, await blockersOf($, started, definition)) }
    }

    if (run === null) return { text: 'No workflow is running. Use /workflow start <workflow> <task-id>.' }
    const definition = definitionOf(run)
    if (definition === undefined) return { text: `Workflow ${run.workflowId} is not available.` }

    if (subcommand === 'status') {
      await $.ui.open({ id: PANE, title: 'Workflow' })
      return { text: statusText(definition, run, await blockersOf($, run, definition)) }
    }

    if (subcommand === 'advance') {
      const current = stageOf(definition, run.currentStage)
      const target = rest[0] ?? (current !== undefined && current.next.length === 1 ? current.next[0] : undefined)
      if (target === undefined) return { text: `Name the next stage: one of ${current?.next.join(', ') ?? 'none'}` }
      const facts = withDeferrals(await factsOf($), run.exceptions)
      const result = advanceRun(definition, GATES, run, target, facts, await $.clock.now())
      if (!result.ok) {
        const evaluation = result.evaluation
        const lines = [result.reason]
        if (evaluation !== null) {
          if (evaluation.missing.length > 0) lines.push(`missing evidence: ${evaluation.missing.join(', ')}`)
          if (evaluation.failing.length > 0) lines.push(`failing: ${evaluation.failing.join(', ')}`)
        }
        return { text: lines.join('\n') }
      }
      const stage = stageOf(definition, target)
      if (stage?.artifact) await ensureArtifact($, run.taskId, stage.artifact, stage.name)
      await saveRun($, result.run)
      return { text: statusText(definition, result.run, await blockersOf($, result.run, definition)) }
    }

    if (subcommand === 'defer') {
      const [gateId = '', ...reasonWords] = rest
      const reason = truncate(reasonWords.join(' ').trim(), 300)
      if (GATES[gateId] === undefined || reason === '') {
        return { text: 'Usage: /workflow defer <gate-id> <reason>. The reason is recorded with its approver.' }
      }
      const approver = (await $.ui.ask(`Who approves deferring ${gateId}? Enter a name or role.`)).trim()
      if (approver === '') return { text: 'No approver given; nothing was deferred.' }
      const exception: Exception = { gate: gateId, reason, approvedBy: truncate(approver, 120), at: await $.clock.now() }
      const updated: RunState = { ...run, exceptions: [...run.exceptions, exception] }
      await saveRun($, updated)
      await appendArtifact($, run.taskId, 'decision-log.md', `## Deferred ${gateId}\n\n${reason}\n\nApproved by: ${exception.approvedBy}`)
      return { text: `${gateId} deferred with approval. Missing evidence stays visible in status.` }
    }

    if (subcommand === 'cancel') {
      await saveRun($, { ...run, status: 'cancelled' })
      return { text: `Task ${run.taskId} cancelled.` }
    }

    return { text: 'Usage: /workflow start|status|advance|defer|cancel' }
  })

  on('command.run', { command: 'record' }, async ($, e) => {
    const run = await loadRun($)
    const [file = '', ...rest] = e.args.trim().split(/\s+/)
    const text = rest.join(' ').trim()
    if (run === null) return { text: 'No task is running.' }
    if (!/^[a-z0-9-]+\.md$/.test(file) || text === '') return { text: 'Usage: /record <name.md> <text>' }
    await appendArtifact($, run.taskId, file, truncate(text, 4000))
    return { text: `Recorded in ${file}.` }
  })

  on('command.run', { command: 'decision' }, async ($, e) => {
    const run = await loadRun($)
    if (run === null) return { text: 'No task is running.' }
    const [title = '', decision = '', consequences = ''] = e.args.split('|').map(part => part.trim())
    if (title === '' || decision === '') return { text: 'Usage: /decision <title> | <decision> | <consequences>' }
    const at = new Date(await $.clock.now()).toISOString()
    await appendArtifact(
      $,
      run.taskId,
      'decision-log.md',
      `## ${truncate(title, 200)}\n\n- Recorded: ${at}\n- Decision: ${truncate(decision, 1000)}\n- Consequences: ${truncate(consequences, 1000)}`,
    )
    return { text: 'Decision recorded in decision-log.md.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, conductor)
    if (!current.active) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const blocked = current.blockers.length > 0 ? ` · blocked: ${current.blockers[0]}` : ' · ready to advance'
    return (
      <Box>
        <Text>
          workflow {current.workflow} · {current.task} · stage {current.stage}
          {blocked}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, conductor)
    return (
      <Box flexDirection="column">
        <Text>
          {current.workflow || 'no workflow'} · {current.task || '-'} · stage {current.stage || '-'} · {current.status}
        </Text>
        {current.blockers.map(item => (
          <Text key={item}>blocked: {item}</Text>
        ))}
      </Box>
    )
  })

}
