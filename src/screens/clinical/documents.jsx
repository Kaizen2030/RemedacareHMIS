// Files attached to clinical guides, pathways and the hospital library: upload, in-page reading, removal.
import { useCallback, useEffect, useRef, useState } from 'react'
import JSZip from 'jszip'
import supabase from '../../supabase'
import { C, s } from '../ncd/ui'

export const DOCUMENT_BUCKET = 'clinical-content-files'
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
export const DOCUMENT_TYPES = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint presentation' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel workbook' },
  xls: { mime: 'application/vnd.ms-excel', label: 'Excel workbook' },
  csv: { mime: 'text/csv', label: 'CSV spreadsheet' },
  txt: { mime: 'text/plain', label: 'Text file' },
  png: { mime: 'image/png', label: 'PNG image' },
  jpg: { mime: 'image/jpeg', label: 'JPEG image' },
  jpeg: { mime: 'image/jpeg', label: 'JPEG image' },
  webp: { mime: 'image/webp', label: 'WebP image' },
}

export function documentExtension(name) {
  return String(name).split('.').pop().toLowerCase()
}

async function readPowerPoint(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml$/)[1]) - Number(b.match(/slide(\d+)\.xml$/)[1]))
  if (!slideFiles.length) throw new Error('This PowerPoint file has no readable slides.')
  return Promise.all(slideFiles.map(async (name, index) => {
    const xml = await zip.files[name].async('text')
    const parsed = new DOMParser().parseFromString(xml, 'application/xml')
    if (parsed.querySelector('parsererror')) throw new Error(`Could not read slide ${index + 1}.`)
    const paragraphs = [...parsed.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'p')]
      .map((paragraph) => [...paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't')]
        .map((run) => run.textContent).join('').trim())
      .filter(Boolean)
    return { number: index + 1, paragraphs }
  }))
}

export function DocumentViewer({ document }) {
  const [text, setText] = useState('')
  const [slides, setSlides] = useState([])
  const [sheets, setSheets] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const wordBodyRef = useRef(null)
  const extension = documentExtension(document.file_name)
  const isPdf = extension === 'pdf'
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(extension)
  const isWord = extension === 'docx'
  const isPowerPoint = extension === 'pptx'
  const isSpreadsheet = extension === 'xlsx'
  const isLegacyExcel = extension === 'xls'
  const isText = ['txt', 'csv'].includes(extension)
  useEffect(() => {
    if (!isWord && !isPowerPoint && !isText && !isSpreadsheet) return undefined
    let active = true
    const renderDocument = async () => {
      setLoading(true)
      setError('')
      setText('')
      setSlides([])
      setSheets([])
      try {
        const response = await fetch(document.signed_url)
        if (!response.ok) throw new Error('Could not download the selected file for preview.')
        const blob = await response.blob()
        if (isWord) {
          const { renderAsync } = await import('docx-preview')
          if (active && wordBodyRef.current) {
            wordBodyRef.current.replaceChildren()
            await renderAsync(blob, wordBodyRef.current, null, { className: 'clinical-docx', inWrapper: true, renderAltChunks: false })
            // Links inside an uploaded document must not run script or replace the app window.
            for (const link of wordBodyRef.current.querySelectorAll('a[href]')) {
              if (!/^(https?:|mailto:|#)/i.test(link.getAttribute('href') || '')) link.removeAttribute('href')
              else if (!link.getAttribute('href').startsWith('#')) { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noreferrer noopener') }
            }
          }
        } else if (isPowerPoint) {
          const content = await readPowerPoint(await blob.arrayBuffer())
          if (active) setSlides(content)
        } else if (isSpreadsheet) {
          // exceljs (maintained) instead of the npm "xlsx" package, which has unpatched parsing vulnerabilities
          const ExcelJS = (await import('exceljs')).default
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(await blob.arrayBuffer())
          const cellText = (v) => {
            if (v == null) return ''
            if (v instanceof Date) return v.toISOString().slice(0, 10)
            if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : v.hyperlink ?? ''))
            return String(v)
          }
          const content = workbook.worksheets.map((ws) => {
            const rows = []
            ws.eachRow({ includeEmpty: false }, (row) => { if (rows.length < 2000) rows.push(row.values.slice(1).map(cellText)) })
            return { name: ws.name, rows }
          })
          if (active) setSheets(content)
        } else {
          const content = await blob.text()
          if (active) setText(content)
        }
      } catch (e) {
        if (active) setError(e.message || 'This file could not be previewed.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void renderDocument()
    return () => {
      active = false
      if (wordBodyRef.current) wordBodyRef.current.replaceChildren()
    }
  }, [document.signed_url, isPowerPoint, isSpreadsheet, isText, isWord])

  return (
    <div style={{ marginTop: 8 }}>
      {loading && <p role="status" style={s.sub}>Preparing preview…</p>}
      {error && <div role="alert" style={s.err}>{error}</div>}
      {isPdf && <iframe title={`PDF preview: ${document.file_name}`} src={document.signed_url} style={{ width: '100%', height: 'min(75vh, 900px)', border: `1px solid ${C.border}`, borderRadius: 8 }} />}
      {isImage && <img src={document.signed_url} alt={document.file_name} style={{ display: 'block', maxWidth: '100%', maxHeight: '75vh', margin: '8px auto' }} />}
      {isWord && <div ref={wordBodyRef} style={{ maxHeight: '75vh', overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, background: '#fff' }} />}
      {isPowerPoint && slides.map((slide) => (
        <section key={slide.number} aria-label={`Slide ${slide.number}`} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginTop: 8, minHeight: 140 }}>
          <h4 style={s.h2}>Slide {slide.number}</h4>
          {slide.paragraphs.length ? slide.paragraphs.map((paragraph, index) => <p key={index} style={{ whiteSpace: 'pre-wrap' }}>{paragraph}</p>) : <p style={s.sub}>No extractable text on this slide.</p>}
        </section>
      ))}
      {isSpreadsheet && sheets.map((sheet) => (
        <section key={sheet.name} style={{ marginTop: 10 }}>
          <h4 style={s.h2}>{sheet.name}</h4>
          <div style={{ overflow: 'auto', maxHeight: '65vh', background: '#fff', border: `1px solid ${C.border}` }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 12 }}>
              <tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={{ border: `1px solid ${C.border}`, padding: '4px 8px', whiteSpace: 'pre-wrap' }}>{String(cell ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
      ))}
      {isText && <pre style={{ maxHeight: '75vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>{text}</pre>}
      {isPowerPoint && !loading && !error && <p style={s.sub}>PowerPoint preview shows slide text. For complex layouts, animations, or charts, download the original file.</p>}
      {isLegacyExcel && <p style={s.sub}>Older .xls workbooks are not previewed in the browser. Download to open, or save the file as .xlsx and upload it again.</p>}
      {isSpreadsheet && !loading && !error && sheets.some((sheet) => sheet.rows.length >= 2000) && <p style={s.sub}>Preview shows the first 2,000 rows of each sheet.</p>}
      <a href={document.signed_url} target="_blank" rel="noreferrer noopener" style={{ ...s.btn, ...s.soft, display: 'inline-block', marginTop: 8 }}>Open or download original</a>
    </div>
  )
}

export function ClinicalDocumentPanel({ guide, hospitalId, canEdit }) {
  const [documents, setDocuments] = useState([])
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const load = useCallback(async () => {
    if (!hospitalId || !guide.id) { setDocuments([]); return }
    const { data, error: listError } = await supabase.from('clinical_content_documents').select('*').eq('hospital_id', hospitalId).eq('guide_id', guide.id).order('created_at', { ascending: false })
    if (listError) { setError(listError.message); return }
    // One missing or unreadable file must not hide the others.
    const signed = await Promise.all((data || []).map(async (item) => {
      const { data: urlData, error: urlError } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(item.object_path, 3600)
      return urlError || !urlData?.signedUrl ? { ...item, signed_url: null, unavailable: urlError?.message || 'File not found in storage' } : { ...item, signed_url: urlData.signedUrl }
    }))
    setDocuments(signed)
    setError('')
  }, [guide.id, hospitalId])

  const remove = async (document) => {
    if (!window.confirm(`Remove "${document.file_name}" from this guide for everyone at this hospital?`)) return
    setError('')
    const { error: rowError } = await supabase.from('clinical_content_documents').delete().eq('id', document.id)
    if (rowError) { setError(/row-level|permission/i.test(rowError.message) ? 'Only an authorised clinical lead, consultant, head of department, pharmacist or administrator can remove files.' : rowError.message); return }
    const { error: fileError } = await supabase.storage.from(DOCUMENT_BUCKET).remove([document.object_path])
    if (fileError) setError(`The file was removed from the guide, but the stored copy could not be deleted: ${fileError.message}`)
    await load().catch((e) => setError(e.message))
  }
  useEffect(() => { void load().catch((e) => setError(e.message || 'Could not load guide files.')) }, [load])

  const upload = async (event) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    const extension = documentExtension(file.name)
    const type = DOCUMENT_TYPES[extension]
    if (!type) {
      setError('Use PDF, Word (DOCX), PowerPoint (PPTX), Excel (XLSX or XLS), CSV, TXT, PNG, JPG or WebP files. Older DOC/PPT files should be converted to PDF or the newer Office format.')
      input.value = ''
      return
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError('Files must be 50 MB or smaller. Split a large book into chapters, or add it to the Library as a link.')
      input.value = ''
      return
    }
    setError('')
    setUploading(true)
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const objectPath = `${hospitalId}/${guide.id}/${crypto.randomUUID()}-${safeName}`
      const { error: uploadError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(objectPath, file, { contentType: type.mime, upsert: false })
      if (uploadError) {
        setError(uploadError.message)
        return
      }
      const { error: insertError } = await supabase.from('clinical_content_documents').insert({
        hospital_id: hospitalId,
        guide_id: guide.id,
        object_path: objectPath,
        file_name: file.name,
        file_size: file.size,
        content_type: type.mime,
      })
      if (insertError) {
        const { error: cleanupError } = await supabase.storage.from(DOCUMENT_BUCKET).remove([objectPath])
        setError(cleanupError ? `${insertError.message} The uploaded file could not be cleaned up: ${cleanupError.message}` : insertError.message)
        return
      }
      await load()
    } catch (e) {
      setError(e.message || 'The file could not be uploaded.')
    } finally {
      setUploading(false)
      input.value = ''
    }
  }

  return (
    <section style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <h3 style={s.h2}>Files for this guide</h3>
      <p style={s.sub}>PDF, Word, PowerPoint, Excel/CSV, text and common image files. Word renders in-page, PowerPoint shows slide text, and spreadsheets render as tables.</p>
      {canEdit && hospitalId && <div style={{ margin: '8px 0' }}>
        <label style={{ ...s.btn, ...s.soft, display: 'inline-block', cursor: uploading ? 'wait' : 'pointer' }}>
          {uploading ? 'Uploading…' : 'Upload file'}
          <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.webp" disabled={uploading} onChange={upload} style={{ display: 'none' }} />
        </label>
      </div>}
      {error && <div role="alert" style={{ ...s.err, marginTop: 8 }}>{error}</div>}
      {documents.map((document) => (
        <div key={document.id} style={{ borderTop: `1px solid ${C.border}`, padding: '8px 0' }}>
          {document.signed_url ? (
            <button type="button" style={{ ...s.btn, ...s.ghost }} aria-expanded={open === document.id} onClick={() => setOpen((current) => current === document.id ? '' : document.id)}>
              {open === document.id ? 'Close' : 'Read'}: {document.file_name}
            </button>
          ) : <span style={{ ...s.sub, color: C.danger }}>{document.file_name} — unavailable ({document.unavailable})</span>}
          {canEdit && <button type="button" style={{ ...s.btn, ...s.ghost, marginLeft: 6 }} onClick={() => void remove(document)}>Remove</button>}
          {open === document.id && document.signed_url && <DocumentViewer document={document} />}
        </div>
      ))}
      {!documents.length && !error && <p style={s.sub}>No files have been added to this guide.</p>}
    </section>
  )
}

