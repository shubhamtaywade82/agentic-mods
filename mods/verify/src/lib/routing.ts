// Routing contracts for the agentic-mods SDK.
//
// A routing decision has two orthogonal axes the reference (Switchboard) did
// not separate cleanly: the MODEL (which model runs) and the EFFORT (how hard
// it tries — reasoning depth, tool budget, verification strictness). Keeping
// them as distinct fields means an effort router can change depth without
// re-selecting the model, and a model router can stay out of effort entirely.

/** How hard the model should try on a given task. */
export type Effort = 'low' | 'medium' | 'high'

/** A complete routing decision: which model, at what effort. */
export interface RoutingPolicy {
  /** Model identifier, e.g. "claude-sonnet-4.5", "gpt-4o", "local-qwen". */
  model: string
  /** Reasoning/tool budget for the run. */
  effort: Effort
}

/**
 * A model ladder: ordered fallback from strongest to cheapest. The router
 * walks it until it finds a model the runtime can actually spawn, or reaches
 * the baseline (last entry). The last entry is the guaranteed-available
 * baseline the host already chose.
 */
export interface ModelLadder {
  readonly steps: readonly string[]
  /** Index of the baseline model inside `steps` (the host's original choice). */
  readonly baselineIndex: number
}

/**
 * An external decision provider's answer for "which model + effort should run
 * this subagent". `confidence` is on [0, 1]; below the threshold the router
 * keeps the baseline instead of applying the recommendation.
 */
export interface PickerResult {
  model?: string
  effort?: Effort
  confidence: number
}

/** Input shape handed to an external picker. Deliberately data-minimized. */
export interface PickerInput {
  /** The subagent role, e.g. "researcher", "developer", "reviewer". */
  readonly agentType: string
  /** One-line description of the task, NOT the full prompt. */
  readonly description: string
}

/**
 * Contract for an external decision provider. Implementations may call a
 * remote API, read a local policy file, or return a static recommendation.
 * The router treats any thrown error or low-confidence result as "keep
 * baseline" — never as a hard failure.
 */
export interface ModelPicker {
  decide(input: PickerInput): Promise<PickerResult>
}

/** Per-model cost: USD per 1M input tokens and per 1M output tokens. */
export interface ModelPricing {
  readonly model: string
  readonly inputPerMillion: number
  readonly outputPerMillion: number
}

/** A cost estimate produced after a routed run completes. */
export interface CostEstimate {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly usd: number
}

/** USD cost for a token pair against a pricing table; 0 if the model is unknown. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  pricing: ReadonlyMap<string, ModelPricing>,
): number {
  const p = pricing.get(model)
  if (!p) return 0
  return (
    (inputTokens / 1_000_000) * p.inputPerMillion + (outputTokens / 1_000_000) * p.outputPerMillion
  )
}

/**
 * Apply a picker result to a baseline policy. Returns the decision the router
 * should hand to the spawn call, plus whether the picker's recommendation was
 * actually applied (vs. discarded for low confidence or a missing field).
 *
 * Rules (deliberately conservative — the baseline is always safe):
 *   - confidence below threshold -> keep baseline
 *   - confidence OK but no model returned -> keep baseline model, apply effort
 *   - confidence OK and model returned -> apply model + effort
 *   - caller-explicit model (baselineModel forces a specific one) -> always kept
 */
export function applyPicker(
  baseline: RoutingPolicy,
  result: PickerResult,
  threshold: number,
): { policy: RoutingPolicy; applied: boolean } {
  if (result.confidence < threshold) return { policy: baseline, applied: false }
  const model = result.model && result.model.length > 0 ? result.model : baseline.model
  const effort = result.effort ?? baseline.effort
  const policy: RoutingPolicy = { model, effort }
  const applied = policy.model !== baseline.model || policy.effort !== baseline.effort
  return { policy, applied }
}

/** True when a ladder's baseline index is in range and the baseline exists. */
export function ladderIsValid(ladder: ModelLadder): boolean {
  return (
    ladder.steps.length > 0 &&
    ladder.baselineIndex >= 0 &&
    ladder.baselineIndex < ladder.steps.length
  )
}
