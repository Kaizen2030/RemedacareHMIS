import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import LabBridgeDownload, { buildBridgeConfig, safeFolder } from './LabBridgeDownload'

const KEY = `rcl_${'a'.repeat(64)}`
const ENDPOINT = 'https://demo.supabase.co/functions/v1/lab-ingest'

describe('lab bridge download', () => {
  it('builds the config for each kind of connection', () => {
    const base = { endpoint: ENDPOINT, name: 'Mindray BC-5000 (haem)', apiKey: KEY, protocol: 'hl7', port: 5100, host: '', comPort: 'com3', baudRate: 9600, folder: 'C:\\Exports' }
    expect(buildBridgeConfig({ ...base, connection: 'network-in' })).toEqual({ endpoint: ENDPOINT, queueDir: 'queue', logFile: 'bridge.log', installFolder: 'Mindray-BC-5000-haem',
      analysers: [{ name: 'Mindray BC-5000 (haem)', key: KEY, protocol: 'hl7', transport: 'tcp-server', port: 5100 }] })
    expect(buildBridgeConfig({ ...base, connection: 'serial' }).analysers[0]).toMatchObject({ transport: 'serial', path: 'COM3', baudRate: 9600 })
    expect(buildBridgeConfig({ ...base, connection: 'folder' }).analysers[0]).toMatchObject({ protocol: 'csv', transport: 'folder', folder: 'C:\\Exports' })
    expect(safeFolder('  ')).toBe('Analyser')
  })

  it('downloads a zip with the installer, the bridge and a filled-in config; checks the inputs first', async () => {
    let blob = null
    globalThis.URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:x' })
    globalThis.URL.revokeObjectURL = vi.fn()
    render(<LabBridgeDownload name="BS-240" protocol="astm" apiKey={KEY} endpoint={ENDPOINT} />)
    fireEvent.change(screen.getByLabelText('How is this analyser connected to the lab PC?'), { target: { value: 'serial' } })
    fireEvent.change(screen.getByLabelText('COM port'), { target: { value: 'printer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download lab bridge (.zip)' }))
    expect(await screen.findByText(/Enter the COM port/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('COM port'), { target: { value: 'COM4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download lab bridge (.zip)' }))
    await waitFor(() => expect(blob).not.toBeNull())
    const zip = await JSZip.loadAsync(blob)
    const root = 'RemedacareHMS Lab Bridge - BS-240/'
    for (const f of ['READ ME FIRST.txt', 'INSTALL.bat', 'START.bat', 'UNINSTALL.bat', 'config.json', 'bridge.mjs', 'protocols.mjs', 'delivery.mjs', 'csv.mjs', 'package.json']) {
      expect(zip.file(root + f), f).not.toBeNull()
    }
    const config = JSON.parse(await zip.file(root + 'config.json').async('string'))
    expect(config.analysers[0]).toMatchObject({ key: KEY, protocol: 'astm', transport: 'serial', path: 'COM4' })
    expect(await zip.file(root + 'INSTALL.bat').async('string')).toMatch(/\r\n/)
    expect(await zip.file(root + 'READ ME FIRST.txt').async('string')).toMatch(/COM4 and set the analyser's LIS speed to 9600 baud/)
  })
})
