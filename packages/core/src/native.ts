/**
 * Every mod this repository builds. Native mods are reviewed here, so the firewall trusts them
 * and polices the rest. `pnpm validate` fails if a mod folder is missing from this list.
 */
export const NATIVE_MODS: readonly string[] = [
  // safety and boundary
  'command-guard',
  'mod-firewall',
  // visibility and orientation
  'session-meter',
  'cache-clock',
  'task-orientation',
  'mission-control',
  'turn-replay',
  'markdown-preview',
  'switchboard',
  'response-modes',
  'next-steps',
  // verification and governance
  'evidence-gate',
  'change-contract',
  'test-impact',
  'review-tracker',
  'pr-readiness',
  'architecture-guard',
  'migration-sentinel',
  'dependency-radar',
  'performance-budget',
  'debug-timeline',
  'learning-ledger',
  'worktree-orchestrator',
  'engineering-cockpit',
  // presentation
  'boss-fight',
  'code-pet',
  'session-wrapped',
  'commentary',
  // incident
  'incident-timeline',
  // workflow layer
  'workflow-conductor',
  'tdd-conductor',
  'regression-orchestrator',
  'defect-protocol',
  'behavior-lock',
  'contract-compatibility-guard',
  'specification-guard',
  'change-planner',
  'observability-verifier',
  'release-conductor',
  'ci-triage',
]

export function isNativeMod(name: string): boolean {
  return NATIVE_MODS.includes(name)
}

/**
 * Runtime plugins vendored from agentic-sdlc-kit at a pinned commit (see plugins/PROVENANCE.json).
 * They are trusted like native mods: they are reviewed upstream and in this repository.
 */
export const VENDORED_PLUGINS: readonly string[] = [
  'sdlc-guard',
  'secret-guard',
  'model-router',
  'run-observer',
]

export function isTrustedMod(name: string): boolean {
  return isNativeMod(name) || VENDORED_PLUGINS.includes(name)
}
