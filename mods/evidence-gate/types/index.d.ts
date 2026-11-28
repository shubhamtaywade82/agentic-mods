export type EvidenceCheck = {
  check: 'build' | 'test' | 'strength' | 'lint' | 'typecheck' | 'security'
  verdict: 'PASS' | 'FAIL' | 'STALE' | 'UNKNOWN'
  reason: string
  ranAt: number | null
  /** Mutation score percentage for the strength check, null for every other check. */
  score?: number | null
  /** The mutation tool that produced the score, null when none ran. */
  tool?: string | null
}

export type EvidenceStatus = {
  overall: 'PASS' | 'FAIL' | 'STALE' | 'UNKNOWN'
  checks: EvidenceCheck[]
  fingerprint: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'evidence-gate': {
      status: Shaped<EvidenceStatus>
    }
  }
}
