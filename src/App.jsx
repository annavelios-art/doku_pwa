import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bell,
  CircleHelp,
  CloudUpload,
  Dumbbell,
  Edit3,
  FileText,
  Home,
  Library,
  NotebookPen,
  Plus,
  Save,
  Search,
  Settings,
  UserCircle2,
} from 'lucide-react'
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
import './App.css'

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
  const totalLength = localHeaderLength + dataBytes.length + centralHeaderLength + 22
  const buffer = new ArrayBuffer(totalLength)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0
  const writeUint32 = value => { view.setUint32(offset, value, true); offset += 4 }
  const writeUint16 = value => { view.setUint16(offset, value, true); offset += 2 }
  const writeBytes = arr => { bytes.set(arr, offset); offset += arr.length }

  writeUint32(0x04034b50)
  writeUint16(20)
  writeUint16(0)
  writeUint16(0)
  writeUint16(0)
  writeUint16(0)
  writeUint32(crc)
  writeUint32(dataBytes.length)
  writeUint32(dataBytes.length)
  writeUint16(fileNameBytes.length)
  writeUint16(0)
  writeBytes(fileNameBytes)
  writeBytes(dataBytes)

  const centralStart = offset
  writeUint32(0x02014b50)
  writeUint16(20)
  writeUint16(20)
  writeUint16(0)
  writeUint16(0)
  writeUint16(0)
  writeUint16(0)
  writeUint32(crc)
  writeUint32(dataBytes.length)
  writeUint32(dataBytes.length)
  writeUint16(fileNameBytes.length)
  writeUint16(0)
  writeUint16(0)
  writeUint16(0)
  writeUint16(0)
  writeUint32(0)
  writeUint32(0)
  writeBytes(fileNameBytes)

  const centralSize = offset - centralStart
  writeUint32(0x06054b50)
  writeUint16(0)
  writeUint16(0)
  writeUint16(1)
  writeUint16(1)
  writeUint32(centralSize)
  writeUint32(centralStart)
  writeUint16(0)

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

function PatientCard({ patient, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(patient.id)} className="ui-card ui-card-patient ui-list-card">
      <p className="ui-card-title">{patient.lastName}, {patient.firstName}</p>
      <p className="ui-card-sub">{formatDate(patient.birthDate)}</p>
    </button>
  )
}

function PrescriptionCard({ prescription, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(prescription)} className="ui-card ui-card-prescription ui-list-card">
      <p className="ui-chip-label">Verordnung</p>
      <p className="ui-card-title-sm">{formatDate(prescription.issueDate)}</p>
      <p className="ui-card-sub">{prescription.remedy}</p>
    </button>
  )
}

function DocEntryCard({ entry, imageCount, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(entry)} className="ui-card ui-card-doc ui-list-card">
      <p className="ui-card-title-sm">{formatDate(entry.entryDate)}</p>
      <p className="ui-card-sub">{snippet(entry.text)}</p>
      {imageCount > 0 && <p className="ui-card-meta">📷 {imageCount} Bilder</p>}
    </button>
  )
}

function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, 1600 / image.width)
        const w = Math.round(image.width * scale)
        const h = Math.round(image.height * scale)
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return reject(new Error('Bildverarbeitung fehlgeschlagen.'))
        ctx.drawImage(image, 0, 0, w, h)
        resolve({
          id: crypto.randomUUID(),
          fileName: file.name,
          mimeType: 'image/jpeg',
          dataUrl: c.toDataURL('image/jpeg', 0.8),
          createdAt: new Date().toISOString(),
        })
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

  useEffect(() => {
    loadListData()
  }, [])

  async function loadListData() { setLoading(true); setError(''); try { const [all, recents] = await Promise.all([getAllPatients(), getRecentlyOpenedPatients()]); setPatients(all); setRecentPatients(recents) } catch (e) { setError(e.message) } finally { setLoading(false) } }
  async function loadPatientDetail(patientId) { setError(''); try { const patient = await getPatientById(patientId); if (!patient) throw new Error('Patient wurde nicht gefunden.'); const patientPrescriptions = await getPrescriptionsByPatientId(patientId); setSelectedPatient(patient); setPrescriptions(patientPrescriptions); setSelectedPrescription(null); setDocEntries([]); setDocEntryImageCounts({}); await markPatientAsRecentlyOpened(patientId); setRecentPatients(await getRecentlyOpenedPatients()); setView('patientDetail') } catch (e) { setError(e.message) } }
  async function loadPrescriptionDetail(prescription) { setError(''); try { const entries = await getDocEntriesByPrescriptionId(prescription.id); const counts = await getDocEntryImageCountMap(entries.map(entry => entry.id)); setSelectedPrescription(prescription); setDocEntries(entries); setDocEntryImageCounts(counts); setView('prescriptionDetail') } catch (e) { setError(e.message) } }
  async function handleExportBackup() { setError(''); setSuccessMessage(''); try { const backup = await exportAllData(); const json = JSON.stringify(backup, null, 2); const zipBlob = createZipWithBackupJson(json); const d = new Date().toISOString().slice(0, 10); const url = URL.createObjectURL(zipBlob); const a = document.createElement('a'); a.href = url; a.download = `praxis-doku-backup-${d}.zip`; a.click(); URL.revokeObjectURL(url); setSuccessMessage('Backup erfolgreich als ZIP exportiert.') } catch (e) { setError(e.message) } }
  async function handleImportFile(event) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (!window.confirm('Beim Import können vorhandene lokale Daten ersetzt werden. Wirklich fortfahren?')) return; setError(''); setSuccessMessage(''); try { const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'; const text = isZip ? await readBackupJsonFromZip(file) : await file.text(); const parsed = JSON.parse(text); await importAllDataReplace(parsed); await loadListData(); setSelectedPatient(null); setSelectedPrescription(null); setPrescriptions([]); setDocEntries([]); setDocEntryImageCounts({}); setDocImages([]); setView('list'); setSuccessMessage('Backup erfolgreich importiert. Lokale Daten wurden ersetzt.') } catch (e) { setError(`Import fehlgeschlagen: ${e.message}`) } }
  async function handleSavePatient(event) { event.preventDefault(); setSaving(true); setError(''); try { if (!patientForm.lastName.trim() || !patientForm.firstName.trim() || !patientForm.birthDate) throw new Error('Bitte Name, Vorname und Geburtsdatum ausfüllen.'); const saved = await savePatient({ ...patientForm, lastName: patientForm.lastName.trim(), firstName: patientForm.firstName.trim() }); await markPatientAsRecentlyOpened(saved.id); await loadListData(); if (selectedPatient) await loadPatientDetail(saved.id); else setView('list') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  async function handleSavePrescription(event) { event.preventDefault(); if (!selectedPatient) return setError('Kein Patient ausgewählt.'); setSaving(true); setError(''); try { if (!prescriptionForm.issueDate || !prescriptionForm.remedy.trim()) throw new Error('Bitte Ausstellungsdatum und Heilmittel ausfüllen.'); await savePrescription({ ...prescriptionForm, patientId: selectedPatient.id, remedy: prescriptionForm.remedy.trim() }); setPrescriptions(await getPrescriptionsByPatientId(selectedPatient.id)); setView('patientDetail') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  async function handleSaveDocEntry(event) { event.preventDefault(); if (!selectedPrescription) return setError('Keine Verordnung ausgewählt.'); setSaving(true); setError(''); try { if (!docForm.entryDate || !docForm.text.trim()) throw new Error('Bitte Datum und Text ausfüllen.'); const saved = await saveDocEntry({ ...docForm, prescriptionId: selectedPrescription.id, text: docForm.text.trim() }); await saveDocEntryImages(saved.id, docImages); const updatedEntries = await getDocEntriesByPrescriptionId(selectedPrescription.id); const counts = await getDocEntryImageCountMap(updatedEntries.map(entry => entry.id)); setDocEntries(updatedEntries); setDocEntryImageCounts(counts); setView('prescriptionDetail') } catch (e) { setError(e.message) } finally { setSaving(false) } }
  async function handleImageUpload(event) { const files = Array.from(event.target.files || []); if (!files.length) return; setError(''); try { const compressed = await Promise.all(files.map(file => resizeImageToDataUrl(file))); setDocImages(prev => [...prev, ...compressed]); event.target.value = '' } catch (e) { setError(e.message) } }
  function handleRemoveImage(imageId) { setDocImages(prev => prev.filter(image => image.id !== imageId)) }
  function insertSymbolText(textToInsert) { setDocForm(prev => ({ ...prev, text: `${prev.text}${prev.text ? '\n' : ''}${textToInsert}` })); docTextareaRef.current?.focus() }

  return (
    <div className="app-shell">
      <div className="app-grid">
        <aside className="app-sidebar">
          <div className="sidebar-brand">
            <h1>Praxis Müller</h1>
            <p>Physiotherapie</p>
          </div>

          <nav className="sidebar-nav">
            {[['Patienten', Home], ['Verordnungen', FileText], ['Doku-Einträge', NotebookPen], ['Übungen', Dumbbell], ['Bibliothek', Library], ['Backup', CloudUpload], ['Einstellungen', Settings]].map(([label, Icon]) => (
              <div key={label} className={`sidebar-item ${label === 'Patienten' ? 'is-active' : ''}`}>
                <Icon size={18} />
                <span>{label}</span>
              </div>
            ))}
          </nav>
        </aside>

        <section className="app-main">
          <header className="app-topbar">
            <div className="search-wrap">
              <Search size={18} className="search-icon" />
              <input className="search-input" placeholder="Suchen..." />
            </div>
            <div className="top-icons">
              <Bell />
              <CircleHelp />
              <UserCircle2 />
            </div>
          </header>

          <main className="content-space">
            {error && <p className="msg msg-error">{error}</p>}
            {successMessage && <p className="msg msg-success">{successMessage}</p>}

            {view === 'list' && (
              <section className="list-layout">
                <article className="surface-card">
                  <h2 className="section-title">Patientenliste</h2>
                  <div className="row-gap">
                    <div className="search-wrap">
                      <Search size={18} className="search-icon" />
                      <input className="search-input" placeholder="Patient suchen" value={query} onChange={e => setQuery(e.target.value)} />
                    </div>
                    <button type="button" onClick={() => { setPatientForm(EMPTY_PATIENT_FORM); setView('patientEdit') }} className="btn btn-primary icon-btn"><Plus size={18} /></button>
                  </div>
                  <div className="stack">
                    {loading ? <p className="muted">Lade Patienten...</p> : filteredPatients.map(patient => <PatientCard key={patient.id} patient={patient} onOpen={loadPatientDetail} />)}
                  </div>
                </article>

                <article className="surface-card">
                  <h2 className="section-subtitle">Zuletzt geöffnet</h2>
                  <div className="stack">
                    {recentPatients.length === 0 ? <p className="muted">Keine Einträge</p> : recentPatients.map(patient => <PatientCard key={patient.id} patient={patient} onOpen={loadPatientDetail} />)}
                  </div>

                  <div className="backup-card">
                    <h3>Datensicherung</h3>
                    <p>Alle lokalen Daten als ZIP mit backup.json.</p>
                    <div className="stack-sm">
                      <button className="btn btn-secondary" onClick={handleExportBackup}>Backup exportieren</button>
                      <button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>Backup importieren</button>
                      <input ref={importInputRef} type="file" accept=".json,.zip,application/json,application/zip" className="hidden" onChange={handleImportFile} />
                    </div>
                  </div>
                </article>
              </section>
            )}

            {view === 'patientDetail' && selectedPatient && (
              <section className="stack">
                <button className="btn btn-ghost-inline" onClick={() => setView('list')}><ArrowLeft size={16} />Zurück</button>

                <article className="surface-card">
                  <div className="row-between">
                    <div>
                      <h2 className="section-title">{selectedPatient.lastName}, {selectedPatient.firstName}</h2>
                      <p className="muted">{formatDate(selectedPatient.birthDate)}</p>
                    </div>
                    <button className="btn btn-ghost" onClick={() => { setPatientForm(selectedPatient); setView('patientEdit') }}><Edit3 size={15} />Bearbeiten</button>
                  </div>
                </article>

                <div className="row-between">
                  <h3 className="section-subtitle">Verordnungen</h3>
                  <button className="btn btn-green" onClick={() => { setPrescriptionForm(EMPTY_PRESCRIPTION_FORM); setView('prescriptionEdit') }}><Plus size={16} />Verordnung</button>
                </div>

                <div className="grid-2">{prescriptions.map(item => <PrescriptionCard key={item.id} prescription={item} onOpen={loadPrescriptionDetail} />)}</div>
              </section>
            )}

            {view === 'prescriptionDetail' && selectedPrescription && (
              <section className="prescription-layout">
                <div className="stack">
                  <button className="btn btn-ghost-inline" onClick={() => setView('patientDetail')}><ArrowLeft size={16} />Zurück</button>

                  <article className="surface-card card-prescription">
                    <p className="chip-sub">Ausstellungsdatum</p>
                    <p className="strong">{formatDate(selectedPrescription.issueDate)}</p>
                    <p className="chip-sub mt">Heilmittel</p>
                    <p>{selectedPrescription.remedy}</p>
                  </article>

                  <button className="btn btn-green full" onClick={() => { setDocForm(EMPTY_DOC_FORM); setDocImages([]); setView('docEdit') }}><Plus size={16} />Doku</button>
                  <div className="stack">{docEntries.map(entry => <DocEntryCard key={entry.id} entry={entry} imageCount={docEntryImageCounts[entry.id] || 0} onOpen={async value => { setDocForm(value); setDocImages(await getDocEntryImages(value.id)); setView('docEdit') }} />)}</div>
                </div>

                <article className="surface-card card-doc-preview">
                  <p className="pre">{docEntries[0]?.text || 'Doku-Eintrag auswählen oder neu erstellen.'}</p>
                </article>
              </section>
            )}

            {view === 'patientEdit' && (
              <section className="surface-card">
                <form className="stack" onSubmit={handleSavePatient}>
                  <button type="button" className="btn btn-ghost-inline" onClick={() => setView(selectedPatient ? 'patientDetail' : 'list')}><ArrowLeft size={16} />Zurück</button>
                  <input className="field" placeholder="Name" value={patientForm.lastName} onChange={e => setPatientForm(prev => ({ ...prev, lastName: e.target.value }))} />
                  <input className="field" placeholder="Vorname" value={patientForm.firstName} onChange={e => setPatientForm(prev => ({ ...prev, firstName: e.target.value }))} />
                  <input type="date" className="field" value={patientForm.birthDate} onChange={e => setPatientForm(prev => ({ ...prev, birthDate: e.target.value }))} />
                  <button className="btn btn-primary" disabled={saving}><Save size={16} />{saving ? 'Speichern...' : 'Speichern'}</button>
                </form>
              </section>
            )}

            {view === 'prescriptionEdit' && selectedPatient && (
              <section className="surface-card">
                <form className="stack" onSubmit={handleSavePrescription}>
                  <button type="button" className="btn btn-ghost-inline" onClick={() => setView(selectedPrescription ? 'prescriptionDetail' : 'patientDetail')}><ArrowLeft size={16} />Abbrechen</button>
                  <input type="date" className="field" value={prescriptionForm.issueDate} onChange={e => setPrescriptionForm(prev => ({ ...prev, issueDate: e.target.value }))} />
                  <input className="field" placeholder="Heilmittel" value={prescriptionForm.remedy} onChange={e => setPrescriptionForm(prev => ({ ...prev, remedy: e.target.value }))} />
                  <button className="btn btn-primary" disabled={saving}><Save size={16} />{saving ? 'Speichern...' : 'Speichern'}</button>
                </form>
              </section>
            )}

            {view === 'docEdit' && selectedPrescription && (
              <section className="surface-card card-doc-edit">
                <form className="stack-lg" onSubmit={handleSaveDocEntry}>
                  <button type="button" className="btn btn-ghost-inline" onClick={() => setView('prescriptionDetail')}><ArrowLeft size={16} />Abbrechen</button>

                  <input type="date" className="field" value={docForm.entryDate} onChange={e => setDocForm(prev => ({ ...prev, entryDate: e.target.value }))} />

                  <div className="toolbar-box">
                    <p className="toolbar-title">Schreibstütze</p>
                    <div className="toolbar-row">
                      {TOOLBAR_INSERTS.map(item => (
                        <button key={item} type="button" onClick={() => insertSymbolText(item)} className="pill-btn">
                          {item.trim()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea ref={docTextareaRef} className="field textfield" value={docForm.text} onChange={e => setDocForm(prev => ({ ...prev, text: e.target.value }))} />

                  <div className="image-grid">
                    <label className="upload-card">
                      <span><Plus className="upload-plus" />Bild hinzufügen</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                    </label>

                    {docImages.map(image => (
                      <div key={image.id} className="image-card">
                        <img src={image.dataUrl} alt={image.fileName} className="image-preview" />
                        <p className="image-name">{image.fileName}</p>
                        <button type="button" className="btn btn-danger" onClick={() => handleRemoveImage(image.id)}>Bild entfernen</button>
                      </div>
                    ))}
                  </div>

                  <div className="row-end">
                    <button type="button" className="btn btn-ghost" onClick={() => setView('prescriptionDetail')}>Abbrechen</button>
                    <button className="btn btn-primary" disabled={saving}><Save size={16} />{saving ? 'Speichern...' : 'Speichern'}</button>
                  </div>
                </form>
              </section>
            )}
          </main>
        </section>
      </div>
    </div>
  )
}