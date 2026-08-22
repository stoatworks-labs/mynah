import { LANGUAGES, LANGUAGE_LABELS, OSC_ROOT } from '../lang/dialects/index.ts'
import type { LanguageChoice } from '../lang/dialects/index.ts'
import type { AwjTransport } from '../settings.ts'

interface Props {
  language: LanguageChoice
  onLanguage: (v: LanguageChoice) => void
  awjTransport: AwjTransport
  onAwjTransport: (v: AwjTransport) => void
  /** False in a browser, where TCP 10606 cannot be opened by any route. */
  canAwj: boolean
  /** What the line currently typed was taken to be, if anything is typed. */
  detected?: string
}

/**
 * The language strip: what the command line accepts, and how AWJ gets out.
 *
 * ## Why the detected language is shown live
 *
 * On `All`, the language of a line is worked out from its shape. That is
 * convenient right up to the moment it is wrong, and the failure mode is
 * nasty — a line read as the wrong language produces an error about a
 * character rather than about a command, and an operator reads it as their own
 * typo. Showing the verdict as it is being typed makes the guess visible
 * before Enter, which is the only point at which it is cheap to correct.
 *
 * The correction is also right there: every language has a one-word prefix, so
 * a line that is being read wrongly is fixed by naming it rather than by
 * hunting through a menu.
 */
export function LanguageBar({
  language,
  onLanguage,
  awjTransport,
  onAwjTransport,
  canAwj,
  detected,
}: Props) {
  return (
    <div className="langbar">
      <label className="langbar-field">
        <span className="langbar-label">Language</span>
        <select
          className="select"
          value={language}
          onChange={(e) => onLanguage(e.target.value as LanguageChoice)}
          title="All detects the language of each line, and honours a leading MYNAH, AWJ, JSON or OSC. Choosing one turns detection off."
        >
          <option value="all">All — detect</option>
          {LANGUAGES.map((id) => (
            <option key={id} value={id}>
              {LANGUAGE_LABELS[id]} only
            </option>
          ))}
        </select>
      </label>

      {language === 'all' && (
        <span className="langbar-detected" role="status">
          {detected ? (
            <>
              reading as <strong>{detected}</strong>
            </>
          ) : (
            <span className="langbar-hint">
              prefix a line with MYNAH, AWJ, JSON or OSC to say which
            </span>
          )}
        </span>
      )}

      <label className="langbar-field">
        <span className="langbar-label">AWJ via</span>
        <select
          className="select"
          value={awjTransport}
          onChange={(e) => onAwjTransport(e.target.value as AwjTransport)}
          title={
            canAwj
              ? 'Store writes ride the connection this app already has. A real socket sends the message as typed on TCP 10606 and can answer a get, at the cost of one of the device’s five AWJ client slots.'
              : 'A browser cannot open TCP 10606. Run the desktop app for a real AWJ socket.'
          }
        >
          <option value="store">Store writes — this connection</option>
          <option value="socket" disabled={!canAwj}>
            TCP 10606 {canAwj ? '— a real AWJ socket' : '— desktop app only'}
          </option>
        </select>
      </label>

      <span className="langbar-note">
        OSC addresses start <code>{OSC_ROOT}/</code>
      </span>
    </div>
  )
}
