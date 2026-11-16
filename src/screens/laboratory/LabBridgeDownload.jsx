// One-click lab bridge package: after an analyser key is created, the lab manager picks how the analyser is connected
// and downloads a zip with everything filled in (bridge, Windows installer, config.json with the key, instructions).
// On the lab PC: unzip, double-click INSTALL. No editing of files, no command line.
import { useState } from 'react'
import JSZip from 'jszip'
import bridgeSrc from '../../../tools/lab-bridge/bridge.mjs?raw'
import protocolsSrc from '../../../tools/lab-bridge/protocols.mjs?raw'
import deliverySrc from '../../../tools/lab-bridge/delivery.mjs?raw'
import csvSrc from '../../../tools/lab-bridge/csv.mjs?raw'
import installBat from '../../../tools/lab-bridge/windows/INSTALL.bat?raw'
import startBat from '../../../tools/lab-bridge/windows/START.bat?raw'
import uninstallBat from '../../../tools/lab-bridge/windows/UNINSTALL.bat?raw'
import { C, s } from '../ncd/ui'

const CONNECTIONS = [
  ['network-in', 'Network cable — the analyser sends results to this PC (most modern analysers)'],
  ['network-out', 'Network cable — this PC connects to the analyser'],
  ['serial', 'Serial / USB cable (COM port)'],
  ['folder', 'The analyser software saves CSV files to a folder'],
]
const crlf = (text) => String(text).replace(/\r?\n/g, '\r\n')
export const safeFolder = (name) => (String(name || 'Analyser').replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '-') || 'Analyser').slice(0, 40)

/** config.json for one analyser (exported for tests). */
export function buildBridgeConfig({ endpoint, name, apiKey, protocol, connection, port, host, comPort, baudRate, folder }) {
  const analyser = { name, key: apiKey, protocol: connection === 'folder' ? 'csv' : protocol }
  if (connection === 'network-in') Object.assign(analyser, { transport: 'tcp-server', port: Number(port) })
  if (connection === 'network-out') Object.assign(analyser, { transport: 'tcp-client', host: host.trim(), port: Number(port) })
  if (connection === 'serial') Object.assign(analyser, { transport: 'serial', path: comPort.trim().toUpperCase(), baudRate: Number(baudRate) })
  if (connection === 'folder') Object.assign(analyser, { transport: 'folder', folder: folder.trim() })
  return { endpoint, queueDir: 'queue', logFile: 'bridge.log', installFolder: safeFolder(name), analysers: [analyser] }
}

function readMe({ name, connection, port, host, comPort, baudRate, folder }) {
  const setOnAnalyser = {
    'network-in': `On the analyser, open the LIS / Host settings and set:\r\n   - Host (server) IP address: the address INSTALL shows at the end\r\n   - Port: ${port}\r\n   - Send results automatically after each test: ON`,
    'network-out': `On the analyser, switch the LIS connection ON (the bridge will connect to ${host}:${port}).`,
    serial: `Plug the analyser cable into ${comPort.toUpperCase()} and set the analyser's LIS speed to ${baudRate} baud.`,
    folder: `Set the analyser software to save result files (CSV) into:\r\n   ${folder}`,
  }[connection]
  return crlf(`RemedacareHMS Lab Bridge - ${name}
=====================================================

WHAT THIS DOES
Results from this analyser go straight into RemedacareHMS. They wait in
Laboratory -> Analyzers until a lab scientist accepts them.

INSTALL (about 5 minutes, once)
1. Unzip this whole folder on the lab PC (right-click -> Extract All).
2. Double-click INSTALL.
   - It installs Node.js if it is missing (needs internet).
   - It starts the bridge and makes it start every time this PC is logged in.
   - At the end it shows this PC's network address. Write it down.
3. ${setOnAnalyser}
4. If Windows Firewall asks about Node.js, click "Allow access".

EVERY DAY
- Keep the lab PC switched on and logged in. The bridge runs in a small window
  on the taskbar called "RemedacareHMS Lab Bridge" - do not close it.
- Scan or type the RemedacareHMS barcode as the sample ID on the analyser.
- If the internet is down, results are kept on the PC and sent later.

IF SOMETHING IS WRONG
- Double-click "Lab bridge log - ${safeFolder(name)}" on the Desktop to see what happened.
- To remove the bridge: double-click UNINSTALL.

KEEP THIS FOLDER PRIVATE
config.json contains this analyser's secret key. Copy the zip straight to the
lab PC (USB stick) - do not email it. If it is lost, revoke the key in
Laboratory -> Analyzers and download a new bridge.
`)
}

export default function LabBridgeDownload({ name, protocol, apiKey, endpoint }) {
  const defaultPort = protocol === 'hl7' ? 5100 : 5200
  const [f, setF] = useState({ connection: protocol === 'csv' ? 'folder' : 'network-in', port: defaultPort, host: '', comPort: 'COM1', baudRate: 9600, folder: 'C:\\LabExports' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const download = async () => {
    setErr('')
    if (f.connection.startsWith('network') && !(Number(f.port) > 0 && Number(f.port) < 65536)) { setErr('Enter a port between 1 and 65535 (the analyser manual or LIS settings show it).'); return }
    if (f.connection === 'network-out' && !f.host.trim()) { setErr("Enter the analyser's IP address."); return }
    if (f.connection === 'serial' && !/^(COM\d+|\/dev\/\S+)$/i.test(f.comPort.trim())) { setErr('Enter the COM port, for example COM1 (Device Manager → Ports shows it).'); return }
    if (f.connection === 'folder' && !f.folder.trim()) { setErr('Enter the folder the analyser saves results to.'); return }
    setBusy(true)
    try {
      const config = buildBridgeConfig({ endpoint, name, apiKey, protocol, ...f })
      const zip = new JSZip()
      const dir = zip.folder(`RemedacareHMS Lab Bridge - ${config.installFolder}`)
      dir.file('READ ME FIRST.txt', readMe({ name, ...f }))
      dir.file('INSTALL.bat', crlf(installBat))
      dir.file('START.bat', crlf(startBat))
      dir.file('UNINSTALL.bat', crlf(uninstallBat))
      dir.file('config.json', JSON.stringify(config, null, 2))
      dir.file('bridge.mjs', bridgeSrc)
      dir.file('protocols.mjs', protocolsSrc)
      dir.file('delivery.mjs', deliverySrc)
      dir.file('csv.mjs', csvSrc)
      dir.file('package.json', JSON.stringify({ name: 'remedacare-lab-bridge', private: true, type: 'module' }, null, 2))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `RemedacareHMS-Lab-Bridge-${config.installFolder}.zip`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setErr(e.message || 'Could not build the download.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <b>Easiest: download a ready-made lab bridge</b>
      <p style={s.sub}>Answer one question, download, then on the lab PC unzip and double-click <b>INSTALL</b>. The key and settings are already inside.</p>
      <label style={s.label} htmlFor="lbd-conn">How is this analyser connected to the lab PC?</label>
      <select id="lbd-conn" style={s.input} value={f.connection} onChange={set('connection')}>
        {CONNECTIONS.filter(([k]) => protocol !== 'csv' || k === 'folder').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <div style={{ ...s.grid(160), marginTop: 8 }}>
        {f.connection === 'network-out' && <div><label style={s.label} htmlFor="lbd-host">Analyser IP address</label><input id="lbd-host" style={s.input} placeholder="192.168.1.50" value={f.host} onChange={set('host')} /></div>}
        {f.connection.startsWith('network') && <div><label style={s.label} htmlFor="lbd-port">Port</label><input id="lbd-port" type="number" style={s.input} value={f.port} onChange={set('port')} /></div>}
        {f.connection === 'serial' && <div><label style={s.label} htmlFor="lbd-com">COM port</label><input id="lbd-com" style={s.input} value={f.comPort} onChange={set('comPort')} /></div>}
        {f.connection === 'serial' && <div><label style={s.label} htmlFor="lbd-baud">Speed (baud)</label><select id="lbd-baud" style={s.input} value={f.baudRate} onChange={set('baudRate')}>{[2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => <option key={b}>{b}</option>)}</select></div>}
        {f.connection === 'folder' && <div style={{ gridColumn: '1 / -1' }}><label style={s.label} htmlFor="lbd-folder">Folder on the lab PC</label><input id="lbd-folder" style={s.input} value={f.folder} onChange={set('folder')} /></div>}
      </div>
      {err && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{err}</div>}
      <button type="button" style={{ ...s.btn, ...s.pri, marginTop: 8 }} disabled={busy} onClick={download}>{busy ? 'Preparing…' : 'Download lab bridge (.zip)'}</button>
      <p style={{ ...s.sub, marginTop: 6 }}>The zip contains this analyser's secret key: copy it to the lab PC on a USB stick, do not email it.</p>
    </div>
  )
}
