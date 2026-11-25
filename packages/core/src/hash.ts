const encoder = new TextEncoder()

/** SHA-256 of a string, as lowercase hex. Uses the environment's `crypto.subtle`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  let hex = ''
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * A fingerprint of a set of files. Each entry is a path and its content, or `null` for an
 * absent file. The result changes whenever any path or byte changes, and is independent of order.
 */
export async function fingerprintFiles(
  entries: ReadonlyArray<readonly [string, string | null]>,
): Promise<string> {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const lines: string[] = []
  for (const [path, content] of sorted) {
    const digest = content === null ? '<absent>' : await sha256Hex(content)
    lines.push(`${path}\u0000${digest}`)
  }
  return sha256Hex(lines.join('\n'))
}

/** A short, stable code derived from text. Used so a person confirms the exact command shown. */
export async function shortCode(text: string, length = 6): Promise<string> {
  const hex = await sha256Hex(text)
  return hex.slice(0, length).toUpperCase()
}
