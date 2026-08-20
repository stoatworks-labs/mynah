import type { EntryStatus, LogEntry } from '../useLink.ts'

const STATUS_TEXT: Record<EntryStatus, string> = {
  sent: 'sent',
  working: 'working',
  done: 'done',
  empty: 'empty memory',
  failed: 'unconfirmed',
  offline: 'not sent',
}

interface Props {
  entries: readonly LogEntry[]
  onClear: () => void
}

/**
 * The execution log.
 *
 * Status is what the device actually said, not what we hoped: a command only
 * reaches "done" on a push back from the box, and one that goes quiet is
 * reported as unconfirmed rather than being left to look successful.
 */
export function Log({ entries, onClear }: Props) {
  return (
    <div className="log">
      <div className="log-head">
        <h2>Log</h2>
        {entries.length > 0 && (
          <button className="btn btn-quiet" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="empty">Nothing sent yet.</p>
      ) : (
        <ul className="log-list">
          {entries.map((e) => (
            <li key={e.id} className={`log-item log-${e.status}`}>
              <code className="log-input">{e.input}</code>
              <span className="log-summary">{e.summary}</span>
              <span className="log-status">
                {STATUS_TEXT[e.status]}
                {e.ops > 0 && ` · ${e.ops} op${e.ops === 1 ? '' : 's'}`}
                {e.detail && ` · ${e.detail}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
