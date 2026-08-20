import type { XKeysState } from '../hid/useXKeys.ts'
import type { BankIndex } from '../link/banks.ts'

interface Props {
  scope?: string
  followVendor: boolean
  onFollowVendor: (v: boolean) => void
  xkeys: XKeysState
  banks?: BankIndex
  indexing: boolean
  indexError?: string
  canIndex: boolean
  onIndex: () => void
}

/**
 * The strip that says what the command line is pointed at, and what hardware
 * is attached to it.
 *
 * The scope is here rather than tucked into a panel because it silently
 * changes what every subsequent command does. An operator who cannot see it
 * is one keystroke from recalling onto the wrong screen.
 */
export function DeviceBar({ scope, followVendor, onFollowVendor, xkeys, banks, indexing, indexError, canIndex, onIndex }: Props) {
  return (
    <div className="devicebar">
      <div className="scope">
        <span className="scope-label">Scope</span>
        {scope ? (
          <strong className="scope-value">{scope}</strong>
        ) : (
          <span className="scope-none">none — name a Screen in the command</span>
        )}
      </div>

      <div className="devicebar-right">
        {banks ? (
          <span className="banks" title="Populated memory slots, read from the device store">
            {banks.screen.length} screen · {banks.master.length} master · {banks.layer.length} layer
          </span>
        ) : indexError ? (
          <span className="banks banks-error" title={indexError}>
            memory index unavailable
          </span>
        ) : (
          <button
            className="btn btn-quiet"
            onClick={onIndex}
            disabled={!canIndex || indexing}
            title="Reads the device store to find which memories exist. A large download, and only possible same-origin."
          >
            {indexing ? 'Indexing…' : 'Index memories'}
          </button>
        )}
        <label className="toggle" title="Mirror the vendor Web RCS's own screen selection">
          <input
            type="checkbox"
            checked={followVendor}
            onChange={(e) => onFollowVendor(e.target.checked)}
          />
          <span>Follow Web RCS selection</span>
        </label>

        {xkeys.supported ? (
          xkeys.connected ? (
            <span className="hid hid-on">
              <i className="dot" />
              {xkeys.productName ?? 'X-Keys'}
              {xkeys.lastKey !== undefined && <em> · key {xkeys.lastKey}</em>}
              <button className="btn btn-quiet" onClick={xkeys.disconnect}>
                Release
              </button>
            </span>
          ) : (
            <button className="btn btn-quiet" onClick={xkeys.request}>
              Attach X-Keys
            </button>
          )
        ) : (
          <span className="hid hid-off" title="WebHID is only available in Chromium browsers over a secure context">
            No WebHID
          </span>
        )}
      </div>
    </div>
  )
}
