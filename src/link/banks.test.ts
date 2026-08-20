import { describe, expect, it } from 'vitest'

import { fetchBankIndex } from './banks.ts'

/** Serve a document as a streamed body, in awkward chunk sizes. */
function serve(doc: unknown, chunkSize = 7): void {
  const text = JSON.stringify(doc)
  const bytes = new TextEncoder().encode(text)
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize))
        }
        controller.close()
      },
    }),
  })) as unknown as typeof fetch
}

const slot = (label: string, isValid: boolean) => ({
  control: { pp: { label, xDelete: false } },
  status: { pp: { isValid } },
})

const doc = {
  device: {
    // A bulky sibling that must be scanned past without being captured, and
    // which contains the word bankList as a decoy key at the wrong depth.
    layerList: {
      items: {
        '1': { bankList: { items: { '1': slot('decoy', true) } }, blob: 'x'.repeat(500) },
      },
    },
    presetBank: {
      control: { pp: {} },
      bankList: {
        itemKeys: ['1', '2', '3'],
        items: {
          '1': slot('Wide Open', true),
          '2': slot('', true),
          '3': slot('', false),
        },
      },
    },
    masterPresetBank: {
      bankList: { items: { '1': slot('Top of show', true), '2': slot('', false) } },
    },
    layerBank: {
      bankList: { items: { '7': slot('PIP', true) } },
    },
  },
}

describe('bank index streaming', () => {
  it('extracts each bank from a chunked stream', async () => {
    serve(doc)
    const index = await fetchBankIndex('http://device')

    expect(index.screen).toEqual([
      { slot: 1, valid: true, label: 'Wide Open' },
      { slot: 2, valid: true, label: '' },
    ])
    expect(index.master).toEqual([{ slot: 1, valid: true, label: 'Top of show' }])
    expect(index.layer).toEqual([{ slot: 7, valid: true, label: 'PIP' }])
  })

  it('drops empty unnamed slots rather than carrying a thousand of them', async () => {
    serve(doc)
    const index = await fetchBankIndex('http://device')
    expect(index.screen.find((s) => s.slot === 3)).toBeUndefined()
  })

  it('ignores a bankList that is not a direct child of a bank', async () => {
    serve(doc)
    const index = await fetchBankIndex('http://device')
    expect(index.screen.some((s) => s.label === 'decoy')).toBe(false)
    expect(index.master.some((s) => s.label === 'decoy')).toBe(false)
  })

  it('survives a chunk boundary falling inside a string', async () => {
    // One byte at a time puts a boundary between every character, including
    // mid-key and mid-escape.
    serve(doc, 1)
    const index = await fetchBankIndex('http://device')
    expect(index.screen[0].label).toBe('Wide Open')
  })

  it('handles escaped quotes in a label', async () => {
    serve({
      device: {
        presetBank: { bankList: { items: { '1': slot('He said "go"', true) } } },
        masterPresetBank: { bankList: { items: {} } },
        layerBank: { bankList: { items: {} } },
      },
    })
    const index = await fetchBankIndex('http://device')
    expect(index.screen[0].label).toBe('He said "go"')
  })
})
