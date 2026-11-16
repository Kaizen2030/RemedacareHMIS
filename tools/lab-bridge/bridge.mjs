#!/usr/bin/env node
// RemedacareHMS lab bridge — runs on a PC in the laboratory, receives results from analysers and sends them to
// RemedacareHMS (lab-ingest edge function). One bridge can serve several analysers. Usage:  node bridge.mjs config.json
//
// Config (see config.example.json):
//   endpoint   https://<project>.supabase.co/functions/v1/lab-ingest
//   queueDir   folder for the durable retry queue (default ./queue)
//   analysers  [{ name, key, protocol: astm | hl7 | csv,
//                 transport: tcp-server | tcp-client | serial | folder,
//                 port, host, path, baudRate, folder }]
//
// Every batch is written to the durable queue (delivery.mjs) before it is sent, so nothing is lost if the internet
// or RemedacareHMS is unreachable; the queue is retried every 30 seconds. CSV exports dropped in a folder are parsed
// with csv.mjs and moved to done/ (or failed/). Serial ports need the optional "serialport" package.
import net from 'node:net'
import path from 'node:path'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { appendFileSync, readFileSync } from 'node:fs'
import { AstmReceiver, hl7Ack, MllpReceiver, mllpWrap, parseAstmRecords, parseHl7 } from './protocols.mjs'
import { createDurableQueue } from './delivery.mjs'
import { parseCsvResults } from './csv.mjs'

const configPath = process.argv[2] || 'config.json'
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const QUEUE_DIR = config.queueDir || 'queue'
const log = (...a) => {
  const line = [new Date().toISOString(), ...a].join(' ')
  console.log(line)
  if (config.logFile) { try { appendFileSync(config.logFile, line + '\r\n') } catch { /* never stop the bridge for a log write */ } }
}
const safeName = (s) => String(s || 'analyser').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60)

/** POST one batch; throws with the server's message so the queue keeps it for a retry. */
async function send(analyser, results) {
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': analyser.key },
    body: JSON.stringify({ results }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    const msg = body.message || `HTTP ${res.status}`
    if (res.status === 401) log(`[${analyser.name}] ${msg} → create a new key in Laboratory → Analysers and update config.json`)
    throw new Error(msg)
  }
  log(`[${analyser.name}] delivered ${results.length} sample(s): received ${body.received ?? '?'}, unmatched ${body.unmatched ?? 0}, auto-accepted ${body.auto_accepted ?? 0}`)
}

const queues = new Map()
function queueFor(analyser) {
  if (!queues.has(analyser.name)) {
    queues.set(analyser.name, createDurableQueue({
      directory: path.join(QUEUE_DIR, safeName(analyser.name)),
      send: (results) => send(analyser, results),
      onError: (file, error) => log(`[${analyser.name}] ${file} not delivered yet: ${error.message}`),
    }))
  }
  return queues.get(analyser.name)
}

async function deliver(analyser, results) {
  if (!results.length) return
  log(`[${analyser.name}] received ${results.length} sample(s): ${results.map((r) => r.sample_id).join(', ')}`)
  const { delivered } = await queueFor(analyser).enqueue(results)
  if (!delivered) log(`[${analyser.name}] kept in the local queue; will retry`)
}

/** Wire a byte stream (socket or serial port) to the analyser's protocol. */
function attach(analyser, stream) {
  if (analyser.protocol === 'hl7') {
    const rx = new MllpReceiver((msg) => {
      try {
        const results = parseHl7(msg)
        stream.write(mllpWrap(hl7Ack(msg, true)))                 // acknowledge once safely parsed; delivery is durable
        deliver(analyser, results).catch((e) => log(`[${analyser.name}] ${e.message}`))
      } catch (e) { stream.write(mllpWrap(hl7Ack(msg, false, e.message))) }
    })
    stream.on('data', (d) => rx.feed(d))
  } else {
    const rx = new AstmReceiver((text) => deliver(analyser, parseAstmRecords(text)).catch((e) => log(`[${analyser.name}] ${e.message}`)))
    stream.on('data', (d) => { for (const b of rx.feed(d)) stream.write(Buffer.from([b])) })
  }
}

/** Watch a folder for CSV exports; parsed files go to done/, unreadable ones to failed/ with the reason. */
async function watchFolder(analyser) {
  const dir = analyser.folder
  await mkdir(path.join(dir, 'done'), { recursive: true })
  await mkdir(path.join(dir, 'failed'), { recursive: true })
  log(`[${analyser.name}] watching ${dir} for CSV files`)
  const scan = async () => {
    for (const name of (await readdir(dir)).filter((n) => /\.(csv|txt)$/i.test(n))) {
      const file = path.join(dir, name)
      try {
        await deliver(analyser, parseCsvResults(await readFile(file, 'utf8')))
        await rename(file, path.join(dir, 'done', `${Date.now()}-${name}`))
      } catch (e) {
        log(`[${analyser.name}] ${name}: ${e.message}`)
        await rename(file, path.join(dir, 'failed', name)).catch(() => {})
        await writeFile(path.join(dir, 'failed', `${name}.error.txt`), e.message).catch(() => {})
      }
    }
  }
  setInterval(() => scan().catch((e) => log(`[${analyser.name}] ${e.message}`)), 15000)
  await scan()
}

async function start(analyser) {
  if (!analyser.key || !/^rcl_/.test(analyser.key)) throw new Error('missing analyser key (rcl_…) — create one in Laboratory → Analysers')
  if (analyser.transport === 'folder' || analyser.protocol === 'csv') return watchFolder(analyser)
  if (analyser.transport === 'tcp-server') {
    net.createServer((sock) => {
      log(`[${analyser.name}] connected from ${sock.remoteAddress}`)
      attach(analyser, sock)
      sock.on('error', (e) => log(`[${analyser.name}] ${e.message}`))
    }).listen(analyser.port, () => log(`[${analyser.name}] listening on port ${analyser.port} (${analyser.protocol})`))
  } else if (analyser.transport === 'tcp-client') {
    const connect = () => {
      const sock = net.connect(analyser.port, analyser.host, () => log(`[${analyser.name}] connected to ${analyser.host}:${analyser.port}`))
      attach(analyser, sock)
      sock.on('error', (e) => log(`[${analyser.name}] ${e.message}`))
      sock.on('close', () => setTimeout(connect, 10000))
    }
    connect()
  } else if (analyser.transport === 'serial') {
    let SerialPort
    try { ({ SerialPort } = await import('serialport')) } catch { throw new Error('serial connections need the serialport package: npm install serialport') }
    const port = new SerialPort({ path: analyser.path, baudRate: analyser.baudRate || 9600, dataBits: analyser.dataBits || 8, parity: analyser.parity || 'none', stopBits: analyser.stopBits || 1 })
    port.on('open', () => log(`[${analyser.name}] serial ${analyser.path} open`))
    port.on('error', (e) => log(`[${analyser.name}] ${e.message}`))
    attach(analyser, port)
  } else {
    throw new Error(`unknown transport "${analyser.transport}"`)
  }
}

if (!config.endpoint || !Array.isArray(config.analysers) || !config.analysers.length) {
  console.error('config needs "endpoint" and at least one entry in "analysers"')
  process.exit(1)
}
for (const a of config.analysers) {
  start(a).catch((e) => log(`[${a.name}] not started: ${e.message}`))
  queueFor(a).flush().catch((e) => log(`[${a.name}] ${e.message}`))       // send anything left from last time
}
setInterval(() => { for (const q of queues.values()) q.flush().catch(() => {}) }, 30000)
