/**
 * One canonical device path, rendered for either transport.
 *
 * The two transports address the same object model with different spellings,
 * so a path is held once as segments and decorated on the way out:
 *
 *   AWJ  DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake
 *   WS   ["device","screenAuxGroupList","items","S1","control","pp","xTake"]
 *
 * | | AWJ | Web RCS store |
 * |---|---|---|
 * | root       | `DeviceObject` | `device`      |
 * | collection | `$name`        | `nameList`    |
 * | item key   | `@items/KEY`   | `items`, KEY  |
 * | property   | `@props/name`  | `pp`, name    |
 *
 * The `List` suffix belongs to the store spelling only — AWJ answers E12 for
 * `$screenList` and serves `$screen`. Hold the bare name and let each
 * transport add its own decoration.
 *
 * Verified against LivePremier firmware 6.2.73 over both transports.
 */

export type Seg =
  | { kind: 'node'; name: string }
  | { kind: 'collection'; name: string }
  | { kind: 'item'; key: string }
  | { kind: 'prop'; name: string }

export class Path {
  private constructor(readonly segs: readonly Seg[]) {}

  static root(): Path {
    return new Path([])
  }

  /**
   * Read an AWJ path string back into segments.
   *
   * The inverse of `toAwj()`, and it exists for the raw-message languages:
   * an operator who types an AWJ message wants it to reach the device by
   * whichever transport is configured, and the WebSocket one needs the store
   * spelling. Doing that conversion here means there is exactly one statement
   * of how the two spellings correspond, in the file that already owns it.
   *
   * `@items` and `@props` each consume the segment that follows them. A
   * trailing `@items` or `@props` with nothing after it is a truncated path
   * and throws, rather than silently addressing the container — an AWJ GET on
   * a container answers `{}` rather than an error, so a truncated path is
   * exactly the mistake that looks like a successful read of nothing.
   */
  static fromAwj(str: string): Path {
    const parts = String(str).trim().replace(/^\/+/, '').split('/').filter((s) => s !== '')
    if (parts.length === 0) throw new Error('empty path')
    if (parts[0] === 'DeviceObject') parts.shift()

    const segs: Seg[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part === '@items') {
        const key = parts[++i]
        if (key === undefined) throw new Error('@items with no key')
        const last = segs[segs.length - 1]
        if (!last || last.kind !== 'collection') {
          throw new Error(`@items/${key} does not follow a $collection`)
        }
        segs.push({ kind: 'item', key })
      } else if (part === '@props') {
        const name = parts[++i]
        if (name === undefined) throw new Error('@props with no property')
        segs.push({ kind: 'prop', name })
      } else if (part.startsWith('$')) {
        segs.push({ kind: 'collection', name: part.slice(1) })
      } else {
        segs.push({ kind: 'node', name: part })
      }
    }
    return new Path(segs)
  }

  /**
   * Read a Web RCS store path back into segments.
   *
   * Accepts the array the socket carries, or the same thing slash-joined.
   * `items` and `pp` consume the segment after them exactly as their AWJ
   * counterparts do, and `nameList` is a collection.
   */
  static fromWs(path: readonly string[] | string): Path {
    const parts = (typeof path === 'string' ? path.split('/') : [...path])
      .map((s) => String(s))
      .filter((s) => s !== '')
    if (parts.length === 0) throw new Error('empty path')
    if (parts[0] === 'device') parts.shift()

    const segs: Seg[] = []
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part === 'items') {
        const key = parts[++i]
        if (key === undefined) throw new Error('items with no key')
        const last = segs[segs.length - 1]
        if (!last || last.kind !== 'collection') {
          throw new Error(`items/${key} does not follow a nameList`)
        }
        segs.push({ kind: 'item', key })
      } else if (part === 'pp') {
        const name = parts[++i]
        if (name === undefined) throw new Error('pp with no property')
        segs.push({ kind: 'prop', name })
      } else if (part.endsWith('List') && part.length > 4) {
        segs.push({ kind: 'collection', name: part.slice(0, -4) })
      } else {
        segs.push({ kind: 'node', name: part })
      }
    }
    return new Path(segs)
  }

  /** A plain object node: `control`, `status`, `system`. */
  node(name: string): Path {
    return new Path([...this.segs, { kind: 'node', name }])
  }

  /** A collection plus the key selected from it. They never appear apart. */
  item(collection: string, key: string | number): Path {
    return new Path([
      ...this.segs,
      { kind: 'collection', name: collection },
      { kind: 'item', key: String(key) },
    ])
  }

  /** A leaf property. */
  prop(name: string): Path {
    return new Path([...this.segs, { kind: 'prop', name }])
  }

  /**
   * True if the path ends at a leaf.
   *
   * Worth checking before a read: AWJ answers a non-leaf GET with an empty
   * object rather than an error, so a container read looks like a successful
   * read of nothing.
   */
  get isLeaf(): boolean {
    return this.segs[this.segs.length - 1]?.kind === 'prop'
  }

  /** Render for AWJ over TCP 10606. */
  toAwj(): string {
    let s = 'DeviceObject'
    for (const seg of this.segs) {
      switch (seg.kind) {
        case 'node':
          s += `/${seg.name}`
          break
        case 'collection':
          s += `/$${seg.name}`
          break
        case 'item':
          s += `/@items/${seg.key}`
          break
        case 'prop':
          s += `/@props/${seg.name}`
          break
      }
    }
    return s
  }

  /**
   * Render for the Web RCS store — used by the `DEVICE` channel and by the
   * `GET /api/stores/device` snapshot alike.
   */
  toWs(): string[] {
    const v: string[] = ['device']
    for (const seg of this.segs) {
      switch (seg.kind) {
        case 'node':
          v.push(seg.name)
          break
        case 'collection':
          v.push(`${seg.name}List`)
          break
        case 'item':
          v.push('items', seg.key)
          break
        case 'prop':
          v.push('pp', seg.name)
          break
      }
    }
    return v
  }

  /** Stable key for caches and comparisons. */
  get key(): string {
    return this.toWs().join('/')
  }
}

export const DeviceObject = Path.root()
