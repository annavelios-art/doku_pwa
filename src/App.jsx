import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Edit3, Plus, Save, Search } from 'lucide-react'
import {
  exportAllData,
  getAllPatients,
  getDocEntriesByPrescriptionId,
  getDocEntryImageCountMap,
  getDocEntryImages,
  getPatientById,
  getPrescriptionsByPatientId,
  getRecentlyOpenedPatients,
  importAllDataReplace,
  markPatientAsRecentlyOpened,
  saveDocEntry,
  saveDocEntryImages,
  savePatient,
  savePrescription,
} from './lib/patientsDb'

const EMPTY_PATIENT_FORM = { id: '', firstName: '', lastName: '', birthDate: '', createdAt: '' }
const EMPTY_PRESCRIPTION_FORM = { id: '', issueDate: '', remedy: '', createdAt: '' }
const EMPTY_DOC_FORM = { id: '', entryDate: '', text: '', createdAt: '' }
const TOOLBAR_INSERTS = ['⚡ Schmerzen: ', '🔥 Reizung / Entzündung: ', '👍 besser: ', '👎 schlechter: ', '↔️ unverändert: ', '🏠 Hausaufgabe: ', '🎯 nächster Fokus: ', '💪 Kraft: ', '🌀 Schwindel: ', '😴 Erschöpfung: ', '🚶 Mobilität / Gangbild: ', '🫁 Atmung: ']

function createZipWithBackupJson(jsonText) {
  const fileName = 'backup.json'
  const encoder = new TextEncoder()
  const fileNameBytes = encoder.encode(fileName)
  const dataBytes = encoder.encode(jsonText)

  const crc32Table = new Uint32Array(256).map((_, index) => {
    let c = index
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })

  let crc = 0xffffffff
  for (let i = 0; i < dataBytes.length; i += 1) crc = crc32Table[(crc ^ dataBytes[i]) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0

  const localHeaderLength = 30 + fileNameBytes.length
  const centralHeaderLength = 46 + fileNameBytes.length
  const endRecordLength = 22
  const totalLength = localHeaderLength + dataBytes.length + centralHeaderLength + endRecordLength

  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  const writeUint32 = value => { view.setUint32(offset, value, true); offset += 4 }
  const writeUint16 = value => { view.setUint16(offset, value, true); offset += 2 }
  const writeBytes = arr => { bytes.set(arr, offset); offset += arr.length }

  writeUint32(0x04034b50); writeUint16(20); writeUint16(0); writeUint16(0); writeUint16(0); writeUint16(0)
  writeUint32(crc); writeUint32(dataBytes.length); writeUint32(dataBytes.length); writeUint16(fileNameBytes.length); writeUint16(0)
  writeBytes(fileNameBytes); writeBytes(dataBytes)

  const centralStart = offset
  writeUint32(0x02014b50); writeUint16(20); writeUint16(20); writeUint16(0); writeUint16(0); writeUint16(0); writeUint16(0)
  writeUint32(crc); writeUint32(dataBytes.length); writeUint32(dataBytes.length); writeUint16(fileNameBytes.length); writeUint16(0); writeUint16(0); writeUint16(0); writeUint16(0); writeUint32(0); writeUint32(0)
  writeBytes(fileNameBytes)

  const centralSize = offset - centralStart
  writeUint32(0x06054b50); writeUint16(0); writeUint16(0); writeUint16(1); writeUint16(1); writeUint32(centralSize); writeUint32(centralStart); writeUint16(0)

  return new Blob([buffer], { type: 'application/zip' })
}

async function readBackupJsonFromZip(file) {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) break

    const compressionMethod = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const fileNameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const fileNameStart = offset + 30
    const fileNameEnd = fileNameStart + fileNameLength
    const fileName = new TextDecoder().decode(bytes.slice(fileNameStart, fileNameEnd))
    const dataStart = fileNameEnd + extraLength
    const dataEnd = dataStart + compressedSize

    if (fileName === 'backup.json') {
      if (compressionMethod !== 0) throw new Error('backup.json ist komprimiert und kann nicht gelesen werden.')
      return new TextDecoder().decode(bytes.slice(dataStart, dataEnd))
    }

    offset = dataEnd
  }

  throw new Error('backup.json wurde in der ZIP-Datei nicht gefunden.')
}

const formatDate = value => (value ? new Date(value).toLocaleDateString('de-DE') : '–')
const snippet = text => (text || '').split('\n')[0].trim().slice(0, 90) || 'Ohne Text'

function PatientCard({ patient, onOpen }) { return <button type="button" onClick={() => onOpen(patient.id)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4"><p className="text-lg font-semibold text-slate-900">{patient.lastName}</p><p className="text-base text-slate-700">{patient.firstName}</p><p className="text-sm text-slate-500 mt-1">Geburtsdatum: {formatDate(patient.birthDate)}</p></button> }
function PrescriptionCard({ prescription, onOpen }) { return <button type="button" onClick={() => onOpen(prescription)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">Ausstellungsdatum</p><p className="text-base font-medium text-slate-900">{formatDate(prescription.issueDate)}</p><p className="text-sm text-slate-500 mt-2">Heilmittel</p><p className="text-base text-slate-700">{prescription.remedy}</p></button> }
function DocEntryCard({ entry, imageCount, onOpen }) { return <button type="button" onClick={() => onOpen(entry)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">Datum</p><p className="text-base font-medium text-slate-900">{formatDate(entry.entryDate)}</p><p className="text-sm text-slate-500 mt-2">Vorschau</p><p className="text-base text-slate-700">{snippet(entry.text)}</p>{imageCount > 0 && <p className="text-sm text-slate-500 mt-2">📷 {imageCount} Bilder</p>}</button> }

function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const maxWidth = 1600
        const scale = Math.min(1, maxWidth / image.width)
        const targetWidth = Math.round(image.width * scale)
        const targetHeight = Math.round(image.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Bildverarbeitung fehlgeschlagen.'))
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight)
        resolve({ id: crypto.randomUUID(), fileName: file.name, mimeType: 'image/jpeg', dataUrl: canvas.toDataURL('image/jpeg', 0.8), createdAt: new Date().toISOString() })
      }
      image.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'))
      image.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'))
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const [view, setView] = useState('list')
  const [patients, setPatients] = useState([])
  const [recentPatients, setRecentPatients] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [selectedPrescription, setSelectedPrescription] = useState(null)
  const [prescriptions, setPrescriptions] = useState([])
  const [docEntries, setDocEntries] = useState([])
  const [docEntryImageCounts, setDocEntryImageCounts] = useState({})
  const [docImages, setDocImages] = useState([])
  const [query, setQuery] = useState('')
  const [patientForm, setPatientForm] = useState(EMPTY_PATIENT_FORM)
  const [prescriptionForm, setPrescriptionForm] = useState(EMPTY_PRESCRIPTION_FORM)
  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const docTextareaRef = useRef(null)
  const importInputRef = useRef(null)

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return patients
    return patients.filter(patient => `${patient.lastName} ${patient.firstName}`.toLowerCase().includes(normalized))
  }, [patients, query])

  useEffect(() => { loadListData() }, [])

  async function loadListData() {
    setLoading(true); setError('')
    try { const [all, recents] = await Promise.all([getAllPatients(), getRecentlyOpenedPatients()]); setPatients(all); setRecentPatients(recents) }
    catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  async function loadPatientDetail(patientId) {
    setError('')
    try {
      const patient = await getPatientById(patientId)
      if (!patient) throw new Error('Patient wurde nicht gefunden.')
      const patientPrescriptions = await getPrescriptionsByPatientId(patientId)
      setSelectedPatient(patient); setPrescriptions(patientPrescriptions); setSelectedPrescription(null); setDocEntries([]); setDocEntryImageCounts({})
      await markPatientAsRecentlyOpened(patientId)
      setRecentPatients(await getRecentlyOpenedPatients())
      setView('patientDetail')
    } catch (e) { setError(e.message) }
  }

  async function loadPrescriptionDetail(prescription) {
    setError('')
    try {
      const entries = await getDocEntriesByPrescriptionId(prescription.id)
      const counts = await getDocEntryImageCountMap(entries.map(entry => entry.id))
      setSelectedPrescription(prescription); setDocEntries(entries); setDocEntryImageCounts(counts); setView('prescriptionDetail')
    } catch (e) { setError(e.message) }
  }

  async function handleExportBackup() {
    setError(''); setSuccessMessage('')
    try {
      const backup = await exportAllData()
      const json = JSON.stringify(backup, null, 2)
            const today = new Date().toISOString().slice(0, 10)
      const fileName = `praxis-doku-backup-${today}.zip`
      const zipBlob = createZipWithBackupJson(json)
      const url = URL.createObjectURL(zipBlob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      URL.revokeObjectURL(url)
      setSuccessMessage('Backup erfolgreich als ZIP exportiert.')
    } catch (e) { setError(e.message) }
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const confirmed = window.confirm('Beim Import können vorhandene lokale Daten ersetzt werden. Wirklich fortfahren?')
    if (!confirmed) return

    setError(''); setSuccessMessage('')
    try {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
      const text = isZip ? await readBackupJsonFromZip(file) : await file.text()
      const parsed = JSON.parse(text)
      await importAllDataReplace(parsed)
      await loadListData()
      setSelectedPatient(null); setSelectedPrescription(null); setPrescriptions([]); setDocEntries([]); setDocEntryImageCounts({}); setDocImages([])
      setView('list')
      setSuccessMessage('Backup erfolgreich importiert. Lokale Daten wurden ersetzt.')
    } catch (e) { setError(`Import fehlgeschlagen: ${e.message}`) }
  }

  async function handleSavePatient(event) { event.preventDefault(); setSaving(true); setError(''); try { if (!patientForm.lastName.trim() || !patientForm.firstName.trim() || !patientForm.birthDate) throw new Error('Bitte Name, Vorname und Geburtsdatum ausfüllen.'); const saved = await savePatient({ ...patientForm, lastName: patientForm.lastName.trim(), firstName: patientForm.firstName.trim() }); await markPatientAsRecentlyOpened(saved.id); await loadListData(); if (selectedPatient) await loadPatientDetail(saved.id); else setView('list') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  async function handleSavePrescription(event) { event.preventDefault(); if (!selectedPatient) return setError('Kein Patient ausgewählt.'); setSaving(true); setError(''); try { if (!prescriptionForm.issueDate || !prescriptionForm.remedy.trim()) throw new Error('Bitte Ausstellungsdatum und Heilmittel ausfüllen.'); await savePrescription({ ...prescriptionForm, patientId: selectedPatient.id, remedy: prescriptionForm.remedy.trim() }); setPrescriptions(await getPrescriptionsByPatientId(selectedPatient.id)); setView('patientDetail') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  async function handleSaveDocEntry(event) { event.preventDefault(); if (!selectedPrescription) return setError('Keine Verordnung ausgewählt.'); setSaving(true); setError(''); try { if (!docForm.entryDate || !docForm.text.trim()) throw new Error('Bitte Datum und Text ausfüllen.'); const saved = await saveDocEntry({ ...docForm, prescriptionId: selectedPrescription.id, text: docForm.text.trim() }); await saveDocEntryImages(saved.id, docImages); const updatedEntries = await getDocEntriesByPrescriptionId(selectedPrescription.id); const counts = await getDocEntryImageCountMap(updatedEntries.map(entry => entry.id)); setDocEntries(updatedEntries); setDocEntryImageCounts(counts); setView('prescriptionDetail') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  async function handleImageUpload(event) { const files = Array.from(event.target.files || []); if (!files.length) return; setError(''); try { const compressed = await Promise.all(files.map(file => resizeImageToDataUrl(file))); setDocImages(prev => [...prev, ...compressed]); event.target.value = '' } catch (e) { setError(e.message) } }
  function handleRemoveImage(imageId) { setDocImages(prev => prev.filter(image => image.id !== imageId)) }
  function insertSymbolText(textToInsert) { setDocForm(prev => ({ ...prev, text: `${prev.text}${prev.text ? '\n' : ''}${textToInsert}` })); docTextareaRef.current?.focus() }

  return <div className="min-h-screen bg-slate-50"><main className="mx-auto w-full max-w-xl p-4 pb-12 space-y-4"><header className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200"><h1 className="text-xl font-semibold text-slate-900">Physio Doku (lokal)</h1></header>{error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{error}</p>}{successMessage && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-700 text-sm">{successMessage}</p>}

  {view === 'list' && <section className="space-y-4"><div className="flex gap-2"><label className="relative flex-1"><Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" /><input className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-base" type="search" placeholder="Patient suchen" value={query} onChange={e => setQuery(e.target.value)} /></label><button type="button" onClick={() => { setPatientForm(EMPTY_PATIENT_FORM); setView('patientEdit') }} className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-4 py-3 text-white text-base font-medium"><Plus className="h-5 w-5" /> Patient</button></div><div className="space-y-2"><h2 className="text-sm font-medium text-slate-500">Zuletzt geöffnet</h2>{recentPatients.length === 0 ? <p className="text-sm text-slate-400">Noch keine zuletzt geöffneten Patienten.</p> : <div className="grid gap-2">{recentPatients.map(p => <PatientCard key={p.id} patient={p} onOpen={loadPatientDetail} />)}</div>}</div><div className="space-y-2"><h2 className="text-sm font-medium text-slate-500">Patienten</h2>{loading ? <p className="text-sm text-slate-400">Lade Patienten...</p> : filteredPatients.length === 0 ? <p className="text-sm text-slate-400">Keine Patienten gefunden.</p> : <div className="grid gap-2">{filteredPatients.map(p => <PatientCard key={p.id} patient={p} onOpen={loadPatientDetail} />)}</div>}</div>

  <article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"><h2 className="text-base font-semibold text-slate-800">Datensicherung</h2><p className="text-sm text-slate-600">Backup enthält Patienten, Verordnungen, Doku-Einträge, Bilder und zuletzt geöffnete Patienten.</p><div className="flex flex-col gap-2"><button type="button" onClick={handleExportBackup} className="w-full rounded-xl bg-slate-800 px-4 py-3 text-white text-base font-medium">Backup exportieren</button><button type="button" onClick={() => importInputRef.current?.click()} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-800 text-base font-medium">Backup importieren</button><input ref={importInputRef} type="file" accept=".json,application/json,.zip,application/zip" className="hidden" onChange={handleImportFile} /></div><p className="text-xs text-slate-500">Import unterstützt ZIP (mit backup.json) und JSON.</p></article></section>}

  {view === 'patientDetail' && selectedPatient && <section className="space-y-4"><button type="button" onClick={() => setView('list')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Zurück</button><article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"><h2 className="text-lg font-semibold text-slate-900">Patient</h2><p className="text-slate-800">{selectedPatient.lastName}, {selectedPatient.firstName}</p><p className="text-sm text-slate-500">Geburtsdatum: {formatDate(selectedPatient.birthDate)}</p><button type="button" onClick={() => { setPatientForm(selectedPatient); setView('patientEdit') }} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-white"><Edit3 className="h-5 w-5" /> Bearbeiten</button></article><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-500">Verordnungen</h3><button type="button" onClick={() => { setPrescriptionForm(EMPTY_PRESCRIPTION_FORM); setView('prescriptionEdit') }} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-3 text-white text-base font-medium"><Plus className="h-5 w-5" /> Verordnung</button></div>{prescriptions.length === 0 ? <p className="text-sm text-slate-400">Noch keine Verordnungen vorhanden.</p> : <div className="grid gap-2">{prescriptions.map(x => <PrescriptionCard key={x.id} prescription={x} onOpen={loadPrescriptionDetail} />)}</div>}</section>}

  {view === 'prescriptionDetail' && selectedPrescription && <section className="space-y-4"><button type="button" onClick={() => setView('patientDetail')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Zurück</button><article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2"><p className="text-sm text-slate-500">Ausstellungsdatum</p><p className="text-base font-medium text-slate-900">{formatDate(selectedPrescription.issueDate)}</p><p className="text-sm text-slate-500">Heilmittel</p><p className="text-base text-slate-700">{selectedPrescription.remedy}</p><button type="button" onClick={() => { setPrescriptionForm(selectedPrescription); setView('prescriptionEdit') }} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-white"><Edit3 className="h-5 w-5" /> Verordnung bearbeiten</button></article><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-500">Doku-Einträge</h3><button type="button" onClick={() => { setDocForm(EMPTY_DOC_FORM); setDocImages([]); setView('docEdit') }} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-3 text-white text-base font-medium"><Plus className="h-5 w-5" /> Doku</button></div>{docEntries.length === 0 ? <p className="text-sm text-slate-400">Noch keine Doku-Einträge vorhanden.</p> : <div className="grid gap-2">{docEntries.map(entry => <DocEntryCard key={entry.id} entry={entry} imageCount={docEntryImageCounts[entry.id] || 0} onOpen={async value => { setDocForm(value); setDocImages(await getDocEntryImages(value.id)); setView('docEdit') }} />)}</div>}</section>}

  {view === 'patientEdit' && <section className="rounded-2xl border border-slate-200 bg-white p-4"><form className="space-y-4" onSubmit={handleSavePatient}><button type="button" onClick={() => (selectedPatient ? setView('patientDetail') : setView('list'))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Zurück</button><div><label className="block text-sm text-slate-600 mb-1">Name</label><input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={patientForm.lastName} onChange={e => setPatientForm(prev => ({ ...prev, lastName: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Vorname</label><input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={patientForm.firstName} onChange={e => setPatientForm(prev => ({ ...prev, firstName: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Geburtsdatum</label><input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={patientForm.birthDate} onChange={e => setPatientForm(prev => ({ ...prev, birthDate: e.target.value }))} /></div><button type="submit" disabled={saving} className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"><Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}</button></form></section>}
  {view === 'prescriptionEdit' && selectedPatient && <section className="rounded-2xl border border-slate-200 bg-white p-4"><form className="space-y-4" onSubmit={handleSavePrescription}><button type="button" onClick={() => setView(selectedPrescription ? 'prescriptionDetail' : 'patientDetail')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Abbrechen</button><div><label className="block text-sm text-slate-600 mb-1">Ausstellungsdatum</label><input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={prescriptionForm.issueDate} onChange={e => setPrescriptionForm(prev => ({ ...prev, issueDate: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Heilmittel</label><input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={prescriptionForm.remedy} onChange={e => setPrescriptionForm(prev => ({ ...prev, remedy: e.target.value }))} /></div><button type="submit" disabled={saving} className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"><Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}</button></form></section>}
  {view === 'docEdit' && selectedPrescription && <section className="rounded-2xl border border-slate-200 bg-white p-4"><form className="space-y-4" onSubmit={handleSaveDocEntry}><button type="button" onClick={() => setView('prescriptionDetail')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Abbrechen</button><div><label className="block text-sm text-slate-600 mb-1">Datum</label><input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={docForm.entryDate} onChange={e => setDocForm(prev => ({ ...prev, entryDate: e.target.value }))} /></div><div className="space-y-2"><p className="text-sm text-slate-600">Schreibstütze</p><div className="flex flex-wrap gap-2">{TOOLBAR_INSERTS.map(item => <button key={item} type="button" onClick={() => insertSymbolText(item)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">{item.trim()}</button>)}</div></div><div><label className="block text-sm text-slate-600 mb-1">Dokumentation</label><textarea ref={docTextareaRef} className="w-full min-h-44 rounded-xl border border-slate-200 px-3 py-3 text-base" value={docForm.text} onChange={e => setDocForm(prev => ({ ...prev, text: e.target.value }))} /></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"><p className="font-medium text-slate-700 mb-2">Symbol-Erklärung</p><div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-slate-600"><span>⚡</span><span>Schmerzen</span><span>🔥</span><span>Reizung / Entzündung</span><span>👍</span><span>besser</span><span>👎</span><span>schlechter</span><span>↔️</span><span>unverändert</span><span>🏠</span><span>Hausaufgabe</span><span>🎯</span><span>nächster Fokus</span><span>💪</span><span>Kraft</span><span>🌀</span><span>Schwindel</span><span>😴</span><span>Erschöpfung</span><span>🚶</span><span>Mobilität / Gangbild</span><span>🫁</span><span>Atmung</span></div></div><div className="space-y-2"><label className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-white text-base font-medium cursor-pointer"><Plus className="h-5 w-5" /> Bild hinzufügen<input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} /></label>{docImages.length > 0 && <div className="grid grid-cols-2 gap-2">{docImages.map(image => <div key={image.id} className="rounded-xl border border-slate-200 bg-white p-2"><img src={image.dataUrl} alt={image.fileName} className="w-full h-28 object-cover rounded-lg" /><p className="text-xs text-slate-500 mt-1 truncate">{image.fileName}</p><button type="button" onClick={() => handleRemoveImage(image.id)} className="mt-2 w-full rounded-lg border border-red-200 bg-red-50 py-2 text-sm text-red-700">Bild entfernen</button></div>)}</div>}</div><button type="submit" disabled={saving} className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"><Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}</button></form></section>}

  </main></div>
}