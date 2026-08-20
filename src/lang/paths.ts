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
