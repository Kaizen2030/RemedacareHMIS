import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

export function createDurableQueue({ directory, send, onError }) {
  if (!directory || typeof send !== 'function' || typeof onError !== 'function') {
    throw new Error('Queue directory, delivery function and error handler are required.')
  }
  let flushInProgress = null

  async function flush() {
    if (flushInProgress) return flushInProgress
    flushInProgress = (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
      let delivered = 0
      let failed = 0
      for (const fileName of files) {
        const filePath = path.join(directory, fileName)
        try {
          const payload = JSON.parse(await readFile(filePath, 'utf8'))
          if (!Array.isArray(payload.results) || !payload.results.length) throw new Error('Queue item has no results.')
          await send(payload.results)
          await unlink(filePath)
          delivered++
        } catch (error) {
          failed++
          onError(fileName, error instanceof Error ? error : new Error(String(error)))
        }
      }
      return { delivered, failed }
    })()
    try { return await flushInProgress } finally { flushInProgress = null }
  }

  async function enqueue(results) {
    if (!Array.isArray(results) || results.length < 1) throw new Error('At least one analyser result is required.')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const queuedFiles = (await readdir(directory)).filter((name) => name.endsWith('.json'))
    if (queuedFiles.length >= 1000) throw new Error('Local retry queue is full; resolve queued deliveries before accepting more results.')
    const stableResults = results.map((result) => ({
      ...result,
      measured_at: result.measured_at || new Date().toISOString(),
    }))
    const fileName = `${Date.now()}-${randomUUID()}.json`
    const filePath = path.join(directory, fileName)
    const handle = await open(filePath, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ results: stableResults }), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await flush()
    const remaining = (await readdir(directory)).includes(fileName)
    return { fileName, delivered: !remaining }
  }

  return { enqueue, flush }
}
