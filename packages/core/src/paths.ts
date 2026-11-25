/** Per-repository state lives under this folder, relative to the working directory. */
export const STATE_DIR = '.agentic-mods'

/** Files that commonly hold secrets. Mods refuse to read them into prompts or logs. */
export const DEFAULT_PROTECTED_GLOBS: readonly string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.keystore',
  '**/id_rsa',
  '**/id_rsa.*',
  '**/id_ed25519',
  '**/id_ed25519.*',
  '**/.npmrc',
  '**/.netrc',
  '**/credentials',
  '**/credentials.*',
]

export const DEFAULT_PROTECTED_EXCEPTIONS: readonly string[] = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
]

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathGuardError'
  }
}

/** POSIX separators, no leading `./`, no duplicate slashes. */
export function normalizePath(input: string): string {
  let path = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (path.startsWith('./')) path = path.slice(2)
  return path
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

export function hasParentSegment(path: string): boolean {
  return normalizePath(path).split('/').includes('..')
}

/**
 * The only write target a mod may use: a path inside `.agentic-mods/`.
 * The engine does not restrict `$.fs.write`, so the restriction lives here.
 */
export function stateRelativePath(relative: string): string {
  const path = normalizePath(relative)
  if (path === '' || isAbsolutePath(path) || hasParentSegment(path)) {
    throw new PathGuardError(`refusing a state path outside ${STATE_DIR}: ${relative}`)
  }
  return `${STATE_DIR}/${path}`
}

export function isInsideState(path: string): boolean {
  const normalized = normalizePath(path)
  return normalized.startsWith(`${STATE_DIR}/`) && !hasParentSegment(normalized)
}

/**
 * `**` matches across folders (`**\/x` also matches a bare `x`), `*` matches within one
 * folder name, `?` matches one character inside a folder name.
 */
export function globToRegExp(glob: string): RegExp {
  const source = normalizePath(glob)
  let pattern = ''
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i)
    if (ch === '*') {
      if (source.charAt(i + 1) === '*') {
        if (source.charAt(i + 2) === '/') {
          pattern += '(?:.*/)?'
          i += 2
        } else {
          pattern += '.*'
          i += 1
        }
      } else {
        pattern += '[^/]*'
      }
    } else if (ch === '?') {
      pattern += '[^/]'
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`)
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  const normalized = normalizePath(path)
  return globs.some(glob => globToRegExp(glob).test(normalized))
}

export function isProtectedPath(
  path: string,
  protectedGlobs: readonly string[] = DEFAULT_PROTECTED_GLOBS,
  exceptions: readonly string[] = DEFAULT_PROTECTED_EXCEPTIONS,
): boolean {
  return matchesAnyGlob(path, protectedGlobs) && !matchesAnyGlob(path, exceptions)
}
