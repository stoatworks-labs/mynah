/**
 * The memory index: which slots hold anything, and what they are called.
 *
 * This has to be fetched over HTTP because the WebSocket only ever pushes
 * *changes* — a value that has not moved since the socket opened is never
 * sent, and there is no way to ask for one. The only read the device offers is
 * `GET /api/stores/device`, which is the entire store: **124 MB** on a
 * populated chassis, with no way to narrow it (sub-paths 404, and a `?path=`
 * query is ignored).
 *
 * Parsing that whole document in a browser would cost hundreds of megabytes of
 * heap for the few thousand values actually wanted, so it is streamed instead
 * and only the bank lists are kept. Everything else is discarded as it goes
 * past. This is still a heavy operation on a show network, which is why it is
 * something the operator asks for rather than something that happens on
 * connect.
 */

export interface MemorySlot {
  readonly slot: number
  readonly valid: boolean
  readonly label: string
}

export interface BankIndex {
  readonly screen: readonly MemorySlot[]
  readonly master: readonly MemorySlot[]
  readonly layer: readonly MemorySlot[]
}

/** Store keys for the three banks the command line can address. */
const TARGETS: Record<string, keyof BankIndex> = {
  presetBank: 'screen',
  masterPresetBank: 'master',
  layerBank: 'layer',
}

/**
 * Pull the bank lists out of the store stream.
 *
 * A full JSON parse is not viable at this size, so this walks the document
 * with just enough state to know where it is — string/escape awareness, a
 * depth counter, and the key that opened each level — and starts buffering
 * only once it is inside a `<bank>.bankList` value. At depth 3 or shallower
 * there is very little text, and the deep, bulky parts of the store are never
 * inside a target, so they cost a scan and nothing else.
 */
export async function fetchBankIndex(
  baseUrl: string,
  onProgress?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<BankIndex> {
  const res = await fetch(`${baseUrl}/api/stores/device`, { signal })
  if (!res.ok) throw new Error(`Store snapshot returned HTTP ${res.status}`)
  if (!res.body) throw new Error('Store snapshot returned no body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const scanner = new BankScanner()
  let bytes = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    onProgress?.(bytes)
    scanner.push(decoder.decode(value, { stream: true }))
    if (scanner.complete) {
      // Every bank has been seen; the rest of the document is of no interest,
      // and on a 124 MB body that is most of it.
      await reader.cancel()
      break
    }
  }

  return scanner.result()
}

class BankScanner {
  private depth = 0
  private inString = false
  private escaped = false
  /** The key that opened each depth, so depth 2 names the bank. */
  private keyStack: (string | undefined)[] = []
  private pendingKey?: string
  private literal = ''

  /** When capturing, the bank being captured and the text so far. */
  private capturing?: { bank: keyof BankIndex; startDepth: number; text: string }
  private captured = new Map<keyof BankIndex, string>()

  get complete(): boolean {
    return this.captured.size === Object.keys(TARGETS).length
  }

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i]
      if (this.capturing) this.capturing.text += c

      if (this.inString) {
        if (this.escaped) {
          // Keep the escaped character: only keys are read from this buffer,
          // but dropping it would silently corrupt any key containing one.
          this.literal += c
          this.escaped = false
        } else if (c === '\\') {
          this.escaped = true
        } else if (c === '"') {
          this.inString = false
          // A string that closes just before a colon is a key.
          this.pendingKey = this.literal
          this.literal = ''
        } else {
          this.literal += c
        }
        continue
      }

      if (c === '"') {
        this.inString = true
        this.literal = ''
        continue
      }

      if (c === '{' || c === '[') {
        this.depth++
        this.keyStack[this.depth] = this.pendingKey
        this.pendingKey = undefined

        if (!this.capturing && c === '{') {
          // The document is {"device":{"<bank>":{"bankList":{…}}}}, so once
          // the opening brace of bankList is counted the depth is 4: the root
          // object is 1, device 2, the bank 3, bankList 4.
          const bankKey = this.keyStack[3]
          if (this.depth === 4 && this.keyStack[4] === 'bankList' && bankKey && TARGETS[bankKey]) {
            this.capturing = { bank: TARGETS[bankKey], startDepth: this.depth, text: '{' }
          }
        }
        continue
      }

      if (c === '}' || c === ']') {
        if (this.capturing && this.depth === this.capturing.startDepth) {
          this.captured.set(this.capturing.bank, this.capturing.text)
          this.capturing = undefined
        }
        this.keyStack[this.depth] = undefined
        this.depth--
        this.pendingKey = undefined
        continue
      }

      if (c === ',' || c === ':') {
        if (c === ',') this.pendingKey = undefined
        continue
      }
    }
  }

  result(): BankIndex {
    const read = (bank: keyof BankIndex): MemorySlot[] => {
      const text = this.captured.get(bank)
      if (!text) return []
      try {
        return slotsFrom(JSON.parse(text))
      } catch {
        // A truncated capture is a missing index, not a broken app.
        return []
      }
    }
    return { screen: read('screen'), master: read('master'), layer: read('layer') }
  }
}

function slotsFrom(bankList: unknown): MemorySlot[] {
  const items = (bankList as { items?: Record<string, unknown> } | undefined)?.items
  if (!items) return []
  const out: MemorySlot[] = []
  for (const [key, raw] of Object.entries(items)) {
    const slot = Number(key)
    if (!Number.isFinite(slot)) continue
    const v = raw as {
      status?: { pp?: { isValid?: unknown } }
      control?: { pp?: { label?: unknown } }
    }
    const valid = v.status?.pp?.isValid === true
    const label = typeof v.control?.pp?.label === 'string' ? v.control.pp.label : ''
    // An empty slot with no name carries no information; keeping all 1,000 of
    // them would make every lookup a scan of mostly nothing.
    if (!valid && label === '') continue
    out.push({ slot, valid, label })
  }
  out.sort((a, b) => a.slot - b.slot)
  return out
}
