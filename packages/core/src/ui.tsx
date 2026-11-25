/*
 * The shared look of every agentic-mods surface: one palette, one set of glyphs, and the few
 * building blocks the panes and bands are made of, so the mods read as one product.
 *
 * Each block takes the element table a mod resolved for the surface it draws on
 * (`$.ui.resolve(e)`), so the same code draws in the terminal, the desktop app and mobile.
 */
import type { Elements, RenderElement, RenderNode } from 'claude-code'

/** The elements every surface carries, as `$.ui.resolve(e)` returns them. */
export type Kit = Pick<Elements[keyof Elements], 'Box' | 'Text' | 'Progress'>

/** Theme keys, so colors follow the person's theme instead of fixed hex values. */
export type Tone = 'success' | 'error' | 'warning' | 'claude' | 'suggestion' | 'subtle' | 'inactive'

type Look = { tone: Tone; glyph: string }

const VERDICTS: Readonly<Record<string, Look>> = {
  PASS: { tone: 'success', glyph: '✓' },
  READY: { tone: 'success', glyph: '✓' },
  FAIL: { tone: 'error', glyph: '✗' },
  'NOT READY': { tone: 'error', glyph: '✗' },
  BLOCKED: { tone: 'error', glyph: '✗' },
  WARN: { tone: 'warning', glyph: '!' },
  DEFERRED: { tone: 'warning', glyph: '»' },
  STALE: { tone: 'warning', glyph: '↻' },
  UNKNOWN: { tone: 'inactive', glyph: '○' },
}

const STATUSES: Readonly<Record<string, Look>> = {
  running: { tone: 'claude', glyph: '●' },
  completed: { tone: 'success', glyph: '✓' },
  failed: { tone: 'error', glyph: '✗' },
  cancelled: { tone: 'inactive', glyph: '⊘' },
  stopped: { tone: 'inactive', glyph: '⊘' },
}

const LEVELS: Readonly<Record<string, Look>> = {
  ok: { tone: 'success', glyph: '●' },
  warn: { tone: 'warning', glyph: '▲' },
  critical: { tone: 'error', glyph: '■' },
}

const NEUTRAL: Look = { tone: 'inactive', glyph: '○' }

/** The look of a gate verdict (PASS, FAIL, UNKNOWN, ...); unknown words read as neutral. */
export function verdictLook(verdict: string): Look {
  return VERDICTS[verdict.toUpperCase()] ?? NEUTRAL
}

/** The look of a running, completed, failed or cancelled node. */
export function statusLook(status: string): Look {
  return STATUSES[status] ?? NEUTRAL
}

/** The look of an ok, warn or critical level. */
export function levelLook(level: string): Look {
  return LEVELS[level] ?? NEUTRAL
}

/** A verdict as a filled chip: ` ✓ PASS `. */
export function chip(kit: Kit, label: string, look: Look): RenderElement {
  const { Text } = kit
  return (
    <Text inverse weight="bold" color={look.tone}>
      {` ${look.glyph} ${label} `}
    </Text>
  )
}

/** A colored glyph and its label, for one row of a list. */
export function mark(kit: Kit, label: string, look: Look): RenderElement {
  const { Text } = kit
  return (
    <Text color={look.tone}>
      {look.glyph} {label}
    </Text>
  )
}

type HeaderInput = { title: string; badge?: RenderNode; meta?: string }

/** A pane's title row: the title in the brand color, a badge and a short summary at the right. */
export function header(kit: Kit, input: HeaderInput): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Text weight="bold" color="claude">
        ◆ {input.title}
      </Text>
      <Box flexDirection="row" gap={1}>
        {input.meta === undefined ? null : <Text dimColor>{input.meta}</Text>}
        {input.badge ?? null}
      </Box>
    </Box>
  )
}

type CardInput = { key: string; title: string; look: Look; lines?: readonly string[] }

/** A bordered card in the color of its state, its title led by the state's glyph. */
export function card(kit: Kit, input: CardInput): RenderElement {
  const { Box, Text } = kit
  return (
    <Box
      key={input.key}
      flexDirection="column"
      borderStyle="round"
      borderColor={input.look.tone}
      paddingX={1}
    >
      <Text weight="bold" color={input.look.tone}>
        {input.look.glyph} {input.title}
      </Text>
      {(input.lines ?? []).map((line) => (
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  )
}

/** A label column and a value column, for settings and per-check rows. */
export function row(kit: Kit, label: string, value: RenderNode, width = 14): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="row">
      <Box width={width}>
        <Text dimColor>{label}</Text>
      </Box>
      {value}
    </Box>
  )
}

/** A percentage as a bar in the color of its level. */
export function meter(kit: Kit, label: string, percent: number, look: Look): RenderElement {
  const { Progress } = kit
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <Progress
      label={label}
      value={clamped}
      max={100}
      valueText={`${Math.round(clamped)}%`}
      color={look.tone}
    />
  )
}

export type Segment = { text: string; tone?: Tone; bold?: boolean }

/** One band row above the prompt: the mod's name, then its segments separated by dots. */
export function band(kit: Kit, name: string, segments: readonly Segment[]): RenderElement {
  const { Box, Text } = kit
  const parts: RenderNode[] = []
  segments.forEach((segment, index) => {
    if (index > 0) parts.push(<Text dimColor> · </Text>)
    parts.push(
      <Text color={segment.tone} weight={segment.bold === true ? 'bold' : 'regular'}>
        {segment.text}
      </Text>,
    )
  })
  return (
    <Box flexDirection="row">
      <Text color="claude">◆ </Text>
      <Text dimColor>{name} </Text>
      {parts}
    </Box>
  )
}

/** What a pane shows before it has anything: a quiet line and the command that fills it. */
export function empty(kit: Kit, text: string, hint?: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column">
      <Text dimColor italic>
        {text}
      </Text>
      {hint === undefined ? null : <Text color="suggestion">→ {hint}</Text>}
    </Box>
  )
}

/** A percentage as a one-line gauge, for bands where a full bar does not fit: `▰▰▰▱▱▱▱▱▱▱`. */
export function gauge(percent: number, width = 10): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`
}
