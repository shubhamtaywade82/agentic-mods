export type EvidenceCheck = {
  check: 'build' | 'test' | 'lint' | 'typecheck' | 'security'
  verdict: 'PASS' | 'FAIL' | 'STALE' | 'UNKNOWN'
  reason: string
  ranAt: number | null
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
