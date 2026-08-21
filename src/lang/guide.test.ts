/**
 * Every command printed in the programming guide must actually compile.
 *
 * Documentation drifts silently — a keyword gets renamed, a default changes,
 * and the guide goes on confidently printing something the parser now rejects.
 * This reads the guide itself and runs every command in it, so that drift is a
 * failing test rather than a support question.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { compile, type DeviceFacts } from './compile.ts'
import { parse } from './parser.ts'

/** A connected 1920×1080 screen, so percentages and buffers resolve. */
const facts: DeviceFacts = {
  buffer: () => 'B',
  canvas: () => ({ w: 1920, h: 1080 }),
}

/** A scope, so the guide's "inside a Select" examples work as printed. */
const selection = { targets: [{ kind: 'screen' as const, n: 3 }], layers: [2] }

/**
 * Pull the runnable commands out of the fenced blocks.
 *
 * The guide annotates examples with trailing prose ("four screens", "→ into S1
 * and S3") which is not part of the command, and prints device paths for
 * illustration. Both are stripped rather than being made to look like code the
 * parser should accept.
 */
function commandsFromGuide(): string[] {
  const text = readFileSync(new URL('../../docs/GUIDE.md', import.meta.url), 'utf8')
  return [...text.matchAll(/```\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1].split('\n'))
    .map((l) =>
      l
        .replace(/\s*→.*$/, '')
        .replace(/\s{3,}\S.*$/, '')
        .trim(),
    )
    .filter(
      (l) =>
        l !== '' &&
        !l.startsWith('…') &&
        !l.startsWith('[') &&
        !l.includes('@props') &&
        !l.includes('/'),
    )
}

describe('the programming guide', () => {
  const commands = commandsFromGuide()

  it('has commands in it to check', () => {
    expect(commands.length).toBeGreaterThan(30)
  })

  it.each(commands)('compiles: %s', (command) => {
    const parsed = parse(command)
    expect(parsed.ok, parsed.ok ? '' : `parse: ${parsed.errors[0]?.message}`).toBe(true)
    if (!parsed.ok) return

    const compiled = compile(parsed.command, { facts, selection })
    expect(compiled.ok, compiled.ok ? '' : `compile: ${compiled.errors[0]?.message}`).toBe(true)
  })
})
