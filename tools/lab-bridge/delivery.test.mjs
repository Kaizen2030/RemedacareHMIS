import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDurableQueue } from './delivery.mjs'

let directory
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined })

describe('lab bridge durable delivery queue', () => {
  it('keeps failed sends for retry and reuses a stable measurement time', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'lab-bridge-'))
    let fail = true
    const delivered = []
    const errors = []
    const queue = createDurableQueue({
      directory,
      onError: (fileName, error) => errors.push({ fileName, message: error.message }),
      send: async (results) => {
        if (fail) throw new Error('offline')
        delivered.push(...results)
      },
    })
    const first = await queue.enqueue([{ sample_id: 'LAB-001', records: [{ code: 'WBC', value: '4.1' }] }])
    expect(first.delivered).toBe(false)
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(1)
    const persisted = JSON.parse(await readFile(path.join(directory, first.fileName), 'utf8')).results[0].measured_at
    expect(errors).toHaveLength(1)
    fail = false
    await queue.flush()
    expect(delivered[0].measured_at).toBe(persisted)
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(0)
  })

  it('reports the current batch as delivered even when an older queued batch still fails', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'lab-bridge-'))
    let sendCount = 0
    const errors = []
    const queue = createDurableQueue({
      directory,
      onError: (fileName, error) => errors.push({ fileName, message: error.message }),
      send: async (results) => {
        sendCount++
        if (results[0].sample_id === 'OLD') throw new Error('offline')
      },
    })
    await queue.enqueue([{ sample_id: 'OLD', records: [{ code: 'WBC', value: '3' }] }])
    const current = await queue.enqueue([{ sample_id: 'NEW', records: [{ code: 'WBC', value: '4' }] }])
    expect(current.delivered).toBe(true)
    expect(sendCount).toBeGreaterThan(1)
    expect(errors).toHaveLength(2)
    expect((await readdir(directory)).filter((name) => name.endsWith('.json'))).toHaveLength(1)
  })
})
