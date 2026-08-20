import { forwardRef, type KeyboardEvent } from 'react'

import type { Op } from '../lang/compile.ts'
import type { Keyword } from '../lang/keywords.ts'

export type Preview =
  | { ok: true; summary: string; ops: readonly Op[]; selection?: unknown; warning?: string }
  | { ok: false; message: string }
  | undefined

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  preview: Preview
  suggestions: readonly Keyword[]
}

/**
 * The command line.
 *
 * Nothing reaches the device until Enter, and everything typed before that is
 * shown compiled underneath — the summary in words, and the exact paths behind
 * a disclosure. An operator about to fire eight writes at a live show should
 * be able to see that it is eight and not eighty.
 */
export const CommandLine = forwardRef<HTMLInputElement, Props>(function CommandLine(
  { value, onChange, onSubmit, preview, suggestions },
  ref,
) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
      return
    }
    if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault()
      // Complete the last word to the first candidate, which is what a desk
      // does: the shortest unambiguous form is already accepted, so Tab is a
      // convenience for reading it back, not a requirement for running it.
      const completed = value.replace(/([A-Za-z]+)$/, suggestions[0].word)
      onChange(`${completed} `)
    }
  }

  return (
    <div className="commandline">
      <div className="cl-row">
        <span className="cl-prompt" aria-hidden="true">
          ›
        </span>
        <input
          ref={ref}
          className="cl-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Recall Screen 1 Memory 5"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          aria-label="Command line"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="cl-suggest">
          {suggestions.map((k) => (
            <span key={k.word} className={`chip chip-${k.kind}`}>
              {k.word}
            </span>
          ))}
        </div>
      )}

      {preview && (
        <div className={`cl-preview ${preview.ok ? 'ok' : 'bad'}`}>
          {preview.ok ? (
            <>
              <strong>{preview.summary}</strong>
              <span className="cl-ops">
                {preview.ops.length === 0
                  ? 'no device write'
                  : `${preview.ops.length} op${preview.ops.length === 1 ? '' : 's'}`}
              </span>
              {preview.warning && <span className="cl-warn">{preview.warning}</span>}
              {preview.ops.length > 0 && (
                <details className="cl-paths">
                  <summary>paths</summary>
                  <ol>
                    {preview.ops.map((op, i) => (
                      <li key={i}>
                        <code>{op.path.toAwj()}</code>
                        <span className="cl-val"> = {JSON.stringify(op.value)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          ) : (
            <span>{preview.message}</span>
          )}
        </div>
      )}
    </div>
  )
})
