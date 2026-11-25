import { globToRegExp, matchesAnyGlob, normalizePath } from './paths'
import { type Decision, type Mode, violation } from './policy'
import type { Layer } from './config'

/** The layer a path belongs to. The first layer whose globs match wins. */
export function layerOf(path: string, layers: readonly Layer[]): Layer | null {
  const normalized = normalizePath(path)
  for (const layer of layers) {
    if (layer.paths.some((glob) => globToRegExp(glob).test(normalized))) return layer
  }
  return null
}

export type LayerViolation = {
  fromPath: string
  fromLayer: string
  toPath: string
  toLayer: string
  key: string
}

/** The stable key of a violation, used by the baseline file. */
export function violationKey(fromPath: string, toPath: string): string {
  return `${normalizePath(fromPath)} -> ${normalizePath(toPath)}`
}

/**
 * Imports that cross a layer boundary the rules do not allow. An import within the same layer
 * is always allowed. A file outside every layer is not checked.
 */
export function findLayerViolations(
  layers: readonly Layer[],
  fromPath: string,
  importedPaths: readonly string[],
): LayerViolation[] {
  const from = layerOf(fromPath, layers)
  if (from === null) return []
  const violations: LayerViolation[] = []
  for (const toPath of importedPaths) {
    const to = layerOf(toPath, layers)
    if (to === null || to.name === from.name) continue
    if (from.mayDependOn.includes(to.name)) continue
    violations.push({
      fromPath: normalizePath(fromPath),
      fromLayer: from.name,
      toPath: normalizePath(toPath),
      toLayer: to.name,
      key: violationKey(fromPath, toPath),
    })
  }
  return violations
}

/** Violations that are not already grandfathered by the baseline. */
export function newViolations(
  found: readonly LayerViolation[],
  baseline: ReadonlySet<string>,
): LayerViolation[] {
  return found.filter((item) => !baseline.has(item.key))
}

export function architectureDecision(mode: Mode, fresh: readonly LayerViolation[]): Decision {
  if (fresh.length === 0) {
    return { decision: 'allow', policyId: 'architecture-guard', message: 'no new violations' }
  }
  const first = fresh[0]
  const summary = fresh
    .slice(0, 3)
    .map((item) => `${item.fromPath} (${item.fromLayer}) imports ${item.toPath} (${item.toLayer})`)
    .join('; ')
  return violation(
    mode,
    'architecture-guard',
    `new layer violation${fresh.length === 1 ? '' : 's'}: ${summary}`,
    first === undefined
      ? undefined
      : `Move the dependency behind an interface owned by ${first.fromLayer}, or record it in the baseline with a reason.`,
  )
}

export type ContractSpec = {
  objective: string
  allowed: string[]
  forbidden: string[]
  mode: Mode
}

/**
 * Parses `.agentic-mods/contract.json`. Returns null when the file is not a valid contract, so
 * a broken file never silently widens scope: the caller falls back to configuration.
 */
export function parseContractJson(text: string): ContractSpec | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const isStrings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  const mode = record['mode']
  if (typeof record['objective'] !== 'string') return null
  if (!isStrings(record['allowed']) || !isStrings(record['forbidden'])) return null
  if (mode !== 'observe' && mode !== 'warn' && mode !== 'enforce') return null
  return {
    objective: record['objective'],
    allowed: [...record['allowed']],
    forbidden: [...record['forbidden']],
    mode,
  }
}

/** Decides whether a write to `path` is inside the contract. */
export function contractDecision(contract: ContractSpec, path: string): Decision {
  const normalized = normalizePath(path)
  if (matchesAnyGlob(normalized, contract.forbidden)) {
    return violation(
      contract.mode,
      'change-contract',
      `${normalized} is forbidden by the contract`,
      'Amend the contract with /contract amend if this change is intended.',
    )
  }
  if (contract.allowed.length > 0 && !matchesAnyGlob(normalized, contract.allowed)) {
    return violation(
      contract.mode,
      'change-contract',
      `${normalized} is outside the allowed scope`,
      'Amend the contract with /contract amend if this change is intended.',
    )
  }
  return { decision: 'allow', policyId: 'change-contract', message: 'within scope' }
}
