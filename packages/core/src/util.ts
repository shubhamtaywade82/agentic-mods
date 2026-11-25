/** Exhaustiveness helper for discriminated unions. */
export function assertNever(value: never, message = 'unexpected variant'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`)
}

/** Readable text for anything thrown. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Appends to a list and keeps only the newest `cap` entries. */
export function appendCapped<T>(list: readonly T[], item: T, cap: number): T[] {
  const next = [...list, item]
  return next.length > cap ? next.slice(next.length - cap) : next
}

type CommandSpec = { name: string; description: string }
type CommandHost = {
  command: { register(spec: CommandSpec): Promise<unknown> }
  ui: { toast(text: string): unknown }
}

/**
 * Registers a slash command and reports a refused name instead of throwing. The engine refuses a
 * name another plugin or skill owns, and a throw would skip the rest of the session.start hook,
 * losing the mod's other commands with it.
 */
export async function registerCommand(host: CommandHost, spec: CommandSpec): Promise<boolean> {
  try {
    await host.command.register(spec)
    return true
  } catch (error) {
    host.ui.toast(`/${spec.name} is unavailable: ${errorMessage(error)}`)
    return false
  }
}
