import { CHECKS, type CheckName, isCheckName } from './classify'
import { DEFAULT_PROTECTED_EXCEPTIONS, DEFAULT_PROTECTED_GLOBS, STATE_DIR } from './paths'
import type { Mode } from './policy'
import { isJsonObject, type JsonObject } from './util'

/** How a confirm-level dangerous command is held. Always-block commands are never run. */
export type GuardTier = 'preview-only' | 'button' | 'typed-code' | 'always-block'
export const GUARD_TIERS: readonly GuardTier[] = [
  'preview-only',
  'button',
  'typed-code',
  'always-block',
]

export type Layer = {
  name: string
  paths: string[]
  mayDependOn: string[]
}

export type AgenticConfig = {
  guard: {
    confirmTier: GuardTier
    protectedPaths: string[]
    protectedExceptions: string[]
  }
  evidence: {
    required: CheckName[]
    /** One argv per check. Each entry runs with no shell. */
    commands: Partial<Record<CheckName, string[][]>>
    maxAgeMinutes: number
    gateMode: Mode
    runTimeoutMs: number
  }
  contract: {
    objective: string
    allowed: string[]
    forbidden: string[]
    mode: Mode
  }
  architecture: {
    mode: Mode
    layers: Layer[]
    baselineFile: string
  }
  meter: {
    contextWarnPercent: number
    contextCriticalPercent: number
    costWarnUsd: number
    rateWarnPercent: number
  }
  cache: {
    ttlSeconds: number
  }
  firewall: {
    mode: Mode
    allowHosts: string[]
    allowProcesses: string[]
  }
}

export function defaultConfig(): AgenticConfig {
  return {
    guard: {
      confirmTier: 'button',
      protectedPaths: [...DEFAULT_PROTECTED_GLOBS],
      protectedExceptions: [...DEFAULT_PROTECTED_EXCEPTIONS],
    },
    evidence: {
      required: ['build', 'test', 'lint', 'typecheck'],
      commands: {},
      maxAgeMinutes: 30,
      gateMode: 'enforce',
      runTimeoutMs: 300_000,
    },
    contract: {
      objective: '',
      allowed: [],
      forbidden: [],
      mode: 'warn',
    },
    architecture: {
      mode: 'warn',
      layers: [],
      baselineFile: 'architecture-baseline.json',
    },
    meter: {
      contextWarnPercent: 70,
      contextCriticalPercent: 90,
      costWarnUsd: 5,
      rateWarnPercent: 80,
    },
    cache: {
      ttlSeconds: 300,
    },
    firewall: {
      mode: 'warn',
      allowHosts: [],
      allowProcesses: [],
    },
  }
}

export type ConfigParse = {
  value: AgenticConfig
  errors: string[]
}

/**
 * Reads `.agentic-mods/config.json`. Unknown or invalid fields are reported and replaced by
 * their defaults. Nothing is silently accepted in the wrong shape.
 */
export function parseConfig(input: unknown): ConfigParse {
  const errors: string[] = []
  const value = defaultConfig()
  if (input === undefined) return { value, errors }
  if (!isJsonObject(input)) {
    errors.push('config must be a JSON object; defaults are in use')
    return { value, errors }
  }

  const section = (root: JsonObject, key: string): JsonObject => {
    const found = root[key]
    if (found === undefined) return {}
    if (isJsonObject(found)) return found
    errors.push(`${key} must be an object; defaults are in use`)
    return {}
  }

  const read = <T>(
    source: JsonObject,
    scope: string,
    key: string,
    check: (candidate: unknown) => T | undefined,
    fallback: T,
  ): T => {
    const candidate = source[key]
    if (candidate === undefined) return fallback
    const checked = check(candidate)
    if (checked === undefined) {
      errors.push(`${scope}.${key} is invalid; default used`)
      return fallback
    }
    return checked
  }

  const asString = (candidate: unknown): string | undefined =>
    typeof candidate === 'string' ? candidate : undefined
  const asPositive = (candidate: unknown): number | undefined =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : undefined
  const asStrings = (candidate: unknown): string[] | undefined =>
    Array.isArray(candidate) && candidate.every(item => typeof item === 'string')
      ? [...candidate]
      : undefined
  const asMode = (candidate: unknown): Mode | undefined =>
    candidate === 'observe' || candidate === 'warn' || candidate === 'enforce'
      ? candidate
      : undefined
  const asTier = (candidate: unknown): GuardTier | undefined =>
    GUARD_TIERS.find(tier => tier === candidate)

  const guard = section(input, 'guard')
  value.guard.confirmTier = read(guard, 'guard', 'confirmTier', asTier, value.guard.confirmTier)
  value.guard.protectedPaths = read(
    guard,
    'guard',
    'protectedPaths',
    asStrings,
    value.guard.protectedPaths,
  )
  value.guard.protectedExceptions = read(
    guard,
    'guard',
    'protectedExceptions',
    asStrings,
    value.guard.protectedExceptions,
  )

  const evidence = section(input, 'evidence')
  value.evidence.required = read(
    evidence,
    'evidence',
    'required',
    candidate => {
      if (!Array.isArray(candidate) || !candidate.every(isCheckName)) return undefined
      return candidate.filter(isCheckName)
    },
    value.evidence.required,
  )
  value.evidence.maxAgeMinutes = read(
    evidence,
    'evidence',
    'maxAgeMinutes',
    asPositive,
    value.evidence.maxAgeMinutes,
  )
  value.evidence.gateMode = read(evidence, 'evidence', 'gateMode', asMode, value.evidence.gateMode)
  value.evidence.runTimeoutMs = read(
    evidence,
    'evidence',
    'runTimeoutMs',
    asPositive,
    value.evidence.runTimeoutMs,
  )
  const commands = section(evidence, 'commands')
  value.evidence.commands = parseCommands(commands, errors)

  const contract = section(input, 'contract')
  value.contract.objective = read(contract, 'contract', 'objective', asString, '')
  value.contract.allowed = read(contract, 'contract', 'allowed', asStrings, [])
  value.contract.forbidden = read(contract, 'contract', 'forbidden', asStrings, [])
  value.contract.mode = read(contract, 'contract', 'mode', asMode, value.contract.mode)

  const architecture = section(input, 'architecture')
  value.architecture.mode = read(
    architecture,
    'architecture',
    'mode',
    asMode,
    value.architecture.mode,
  )
  value.architecture.layers = parseLayers(architecture, errors)
  value.architecture.baselineFile = read(
    architecture,
    'architecture',
    'baselineFile',
    asString,
    value.architecture.baselineFile,
  )

  const meter = section(input, 'meter')
  value.meter.contextWarnPercent = read(
    meter,
    'meter',
    'contextWarnPercent',
    asPositive,
    value.meter.contextWarnPercent,
  )
  value.meter.contextCriticalPercent = read(
    meter,
    'meter',
    'contextCriticalPercent',
    asPositive,
    value.meter.contextCriticalPercent,
  )
  value.meter.costWarnUsd = read(meter, 'meter', 'costWarnUsd', asPositive, value.meter.costWarnUsd)
  value.meter.rateWarnPercent = read(
    meter,
    'meter',
    'rateWarnPercent',
    asPositive,
    value.meter.rateWarnPercent,
  )

  const cache = section(input, 'cache')
  value.cache.ttlSeconds = read(cache, 'cache', 'ttlSeconds', asPositive, value.cache.ttlSeconds)

  const firewall = section(input, 'firewall')
  value.firewall.mode = read(firewall, 'firewall', 'mode', asMode, value.firewall.mode)
  value.firewall.allowHosts = read(firewall, 'firewall', 'allowHosts', asStrings, [])
  value.firewall.allowProcesses = read(firewall, 'firewall', 'allowProcesses', asStrings, [])

  return { value, errors }
}

function parseCommands(
  commands: JsonObject,
  errors: string[],
): Partial<Record<CheckName, string[][]>> {
  const out: Partial<Record<CheckName, string[][]>> = {}
  for (const key of Object.keys(commands)) {
    if (!isCheckName(key)) {
      errors.push(`evidence.commands.${key} is not a check (${CHECKS.join(', ')})`)
      continue
    }
    const list = commands[key]
    const valid =
      Array.isArray(list) &&
      list.every(
        argv =>
          Array.isArray(argv) &&
          argv.length > 0 &&
          argv.every(item => typeof item === 'string' && item.length > 0),
      )
    if (!valid) {
      errors.push(`evidence.commands.${key} must be a list of argv arrays; check skipped`)
      continue
    }
    out[key] = (list as string[][]).map(argv => [...argv])
  }
  return out
}

function parseLayers(architecture: JsonObject, errors: string[]): Layer[] {
  const raw = architecture['layers']
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    errors.push('architecture.layers must be a list; no layers in use')
    return []
  }
  const layers: Layer[] = []
  for (const item of raw) {
    if (
      !isJsonObject(item) ||
      typeof item['name'] !== 'string' ||
      !Array.isArray(item['paths']) ||
      !item['paths'].every(path => typeof path === 'string') ||
      !Array.isArray(item['mayDependOn']) ||
      !item['mayDependOn'].every(name => typeof name === 'string')
    ) {
      errors.push('architecture.layers entry is invalid; entry skipped')
      continue
    }
    layers.push({
      name: item['name'],
      paths: [...(item['paths'] as string[])],
      mayDependOn: [...(item['mayDependOn'] as string[])],
    })
  }
  return layers
}

/** The configuration file every mod reads. */
export const CONFIG_PATH = `${STATE_DIR}/config.json`

/**
 * Loads `.agentic-mods/config.json` through an injected reader. A missing file is not an
 * error: defaults apply silently. Malformed JSON and invalid fields are reported in `errors`.
 */
export async function loadConfig(
  read: (path: string) => Promise<string>,
): Promise<ConfigParse> {
  let text: string
  try {
    text = await read(CONFIG_PATH)
  } catch {
    return parseConfig(undefined)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      value: defaultConfig(),
      errors: [`${CONFIG_PATH} is not valid JSON; defaults are in use`],
    }
  }
  return parseConfig(parsed)
}
