import type { Keyword } from '../lang/keywords.ts'

interface Props {
  table: readonly { keyword: Keyword; short: string }[]
}

const GROUPS: { kind: Keyword['kind']; title: string }[] = [
  { kind: 'function', title: 'Functions' },
  { kind: 'object', title: 'Objects' },
  { kind: 'mode', title: 'Preset' },
  { kind: 'clause', title: 'Clause' },
  { kind: 'operator', title: 'Range' },
  { kind: 'category', title: 'Categories' },
]

/**
 * The vocabulary, with the shortest form that reaches each word.
 *
 * The short forms are computed from the table rather than written down, so
 * this panel is always telling the truth about what will resolve today —
 * including the awkward cases, like Mask having no abbreviation at all
 * because Master shares its first three letters.
 */
export function KeywordHelp({ table }: Props) {
  return (
    <div className="help">
      <h2>Vocabulary</h2>
      <p className="help-note">
        Any unambiguous prefix works. The short form shown is the shortest that
        reaches that word and nothing else.
      </p>
      {GROUPS.map((g) => (
        <section key={g.kind} className="help-group">
          <h3>{g.title}</h3>
          <ul>
            {table
              .filter((t) => t.keyword.kind === g.kind)
              .map(({ keyword, short }) => (
                <li key={keyword.word}>
                  <span className="help-word">{keyword.word}</span>
                  <code className="help-short">
                    {short === keyword.word ? '—' : short}
                  </code>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
