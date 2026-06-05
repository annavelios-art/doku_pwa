import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, CircleHelp, CloudUpload, Dumbbell, Edit3, FileText, Home, Library,
  Plus, Printer, Save, Search, Settings, UserCircle2,
} from 'lucide-react'
import {
  exportAllData, getAllPatients, getDocEntriesByPrescriptionId, getDocEntryImageCountMap,
  getDocEntryImages, getLibraryItems, getPatientById, getPatientDocumentsByPatientId,
  getPrescriptionsByPatientId, getRecentlyOpenedPatients, importAllDataReplace,
  markPatientAsRecentlyOpened, saveDocEntry, saveDocEntryImages, saveLibraryItem,
  savePatient, savePatientDocument, savePrescription,
} from './lib/patientsDb'
import './App.css'

const EMPTY_PATIENT_FORM = { id: '', firstName: '', lastName: '', birthDate: '', createdAt: '' }
const EMPTY_PRESCRIPTION_FORM = { id: '', issueDate: '', remedy: '', createdAt: '' }
const EMPTY_DOC_FORM = { id: '', entryDate: '', text: '', createdAt: '' }
const EMPTY_LIBRARY_FORM = { id: '', category: 'nachbehandlung', title: '', note: '', file: null, createdAt: '' }
const EMPTY_PATIENT_DOCUMENT_FORM = { id: '', documentDate: '', title: '', note: '', file: null, createdAt: '' }

const LIBRARY_SECTIONS = [
  { key: 'nachbehandlung', title: 'Nachbehandlung', description: 'Schemas, Protokolle und Verlaufsempfehlungen.' },
  { key: 'uebungsblaetter', title: 'Übungsblätter', description: 'PDFs oder Bilder für Patientinnen und Patienten.' },
  { key: 'archiv', title: 'Archiv', description: 'Bleibt erstmal leer und darf später wachsen.' },
]

const TOOLBAR_INSERTS = [
  { label: '⚡ Schmerzen', insert: '⚡' },
  { label: '🔥 Reizung/Entzündung', insert: '🔥' },
  { label: '👍 besser', insert: '👍' },
  { label: '👎 schlechter', insert: '👎' },
  { label: '↔️ unverändert', insert: '↔️' },
  { label: '🏠 Hausaufgabe', insert: '🏠' },
  { label: '🎯 nächster Fokus', insert: '🎯' },
  { label: '💪 Kraft', insert: '💪' },
  { label: '🌀 Schwindel', insert: '🌀' },
  { label: '😴 Erschöpfung', insert: '😴' },
  { label: '🚶 Mobilität / Gangbild', insert: '🚶' },
  { label: '🌬️ Atmung', insert: '🌬️' },
]

function createZipWithBackupJson(jsonText) {
  const fileName = 'backup.json'
  const encoder = new TextEncoder()
  const fileNameBytes = encoder.encode(fileName)
  const dataBytes = encoder.encode(jsonText)
  const table = new Uint32Array(256).map((_, i) => {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })

  let crc = 0xffffffff
  for (let i = 0; i < dataBytes.length; i += 1) crc = table[(crc ^ dataBytes[i]) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0

  const localHeaderSize = 30 + fileNameBytes.length
  const centralHeaderSize = 46 + fileNameBytes.length
  const totalSize = localHeaderSize + dataBytes.length + centralHeaderSize + 22
  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  const write32 = value => { view.setUint32(offset, value, true); offset += 4 }
  const write16 = value => { view.setUint16(offset, value, true); offset += 2 }
  const writeBytes = value => { bytes.set(value, offset); offset += value.length }

  write32(0x04034b50)
  write16(20)
  write16(0)
  write16(0)
  write16(0)
  write16(0)
  write32(crc)
  write32(dataBytes.length)
  write32(dataBytes.length)
  write16(fileNameBytes.length)
  write16(0)
  writeBytes(fileNameBytes)
  writeBytes(dataBytes)

  const centralStart = offset
  write32(0x02014b50)
  write16(20)
  write16(20)
  write16(0)
  write16(0)
  write16(0)
  write16(0)
  write32(crc)
  write32(dataBytes.length)
  write32(dataBytes.length)
  write16(fileNameBytes.length)
  write16(0)
  write16(0)
  write16(0)
  write16(0)
  write32(0)
  write32(0)
  writeBytes(fileNameBytes)

  const centralSize = offset - centralStart
  write32(0x06054b50)
  write16(0)
  write16(0)
  write16(1)
  write16(1)
  write32(centralSize)
  write32(centralStart)
  write16(0)

  return new Blob([buffer], { type: 'application/zip' })
}

async function readBackupJsonFromZip(file) {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true)
    if (signature !== 0x04034b50) break

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
const todayIso = () => new Date().toISOString().slice(0, 10)
const snippet = text => (text || '').split('\n')[0].trim().slice(0, 90) || 'Ohne Text'
const patientLabel = patient => patient ? `${patient.firstName} ${patient.lastName}` : ''
const prescriptionLabel = prescription => prescription ? `VO ${formatDate(prescription.issueDate)} · ${prescription.remedy}` : ''
const libraryTitle = category => LIBRARY_SECTIONS.find(item => item.key === category)?.title || 'Bibliothek'

function PatientCard({ patient, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(patient.id)} className="ui-card ui-card-patient ui-list-card">
      <p className="ui-card-title">
        {patient.lastName}, {patient.firstName}
        <span className="inline-date">{' · '}{formatDate(patient.birthDate)}</span>
      </p>
    </button>
  )
}

function PrescriptionCard({ prescription, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(prescription)} className="prescription-row">
      <span className="prescription-date">{formatDate(prescription.issueDate)}</span>
      <span className="prescription-remedy">{prescription.remedy}</span>
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

function StoredFileCard({ title, date, note, file, onOpen, tone = 'document' }) {
  return (
    <button type="button" onClick={() => onOpen(file)} className={`ui-card ui-card-file ui-card-file-${tone} ui-list-card`}>
      <p className="ui-card-title-sm">{title}</p>
      <p className="ui-card-sub">
        {formatDate(date)}
        {file?.fileName ? ` · ${file.fileName}` : ''}
      </p>
      {note && <p className="ui-card-meta">{note}</p>}
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
        const width = Math.round(image.width * scale)
        const height = Math.round(image.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Bildverarbeitung fehlgeschlagen.'))

        ctx.drawImage(image, 0, 0, width, height)
        resolve({
          id: crypto.randomUUID(),
          fileName: file.name,
          mimeType: 'image/jpeg',
          dataUrl: canvas.toDataURL('image/jpeg', 0.8),
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve({
      id: crypto.randomUUID(),
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataUrl: String(reader.result),
      createdAt: new Date().toISOString(),
    })

    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'))
    reader.readAsDataURL(file)
  })
}

async function prepareStoredFile(file) {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png']
  const isAllowedByName = /\.(pdf|jpe?g|png)$/i.test(file.name)

  if (!allowedTypes.includes(file.type) && !isAllowedByName) {
    throw new Error('Bitte nur PDF, JPG oder PNG hochladen.')
  }

  if (file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(file.name)) {
    return resizeImageToDataUrl(file)
  }

  return readFileAsDataUrl(file)
}

export default function App() {
  const [view, setView] = useState('list')
  const [nav, setNav] = useState('patients')
  const [patients, setPatients] = useState([])
  const [recentPatients, setRecentPatients] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [selectedPrescription, setSelectedPrescription] = useState(null)
  const [prescriptions, setPrescriptions] = useState([])
  const [docEntries, setDocEntries] = useState([])
  const [docEntryImageCounts, setDocEntryImageCounts] = useState({})
  const [docImages, setDocImages] = useState([])
  const [patientDocuments, setPatientDocuments] = useState([])
  const [libraryCategory, setLibraryCategory] = useState('nachbehandlung')
  const [libraryItems, setLibraryItems] = useState([])
  const [fullscreenImage, setFullscreenImage] = useState(null)
  const [query, setQuery] = useState('')
  const [patientForm, setPatientForm] = useState(EMPTY_PATIENT_FORM)
  const [prescriptionForm, setPrescriptionForm] = useState(EMPTY_PRESCRIPTION_FORM)
  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM)
  const [libraryForm, setLibraryForm] = useState(EMPTY_LIBRARY_FORM)
  const [patientDocumentForm, setPatientDocumentForm] = useState(EMPTY_PATIENT_DOCUMENT_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [printData, setPrintData] = useState(null)
  const docTextareaRef = useRef(null)
  const importInputRef = useRef(null)

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return patients
    return patients.filter(patient => `${patient.lastName} ${patient.firstName}`.toLowerCase().includes(normalized))
  }, [patients, query])

  const breadcrumbItems = useMemo(() => {
    if (nav === 'exercises') return ['Übungen']
    if (nav === 'settings') return ['Einstellungen']
    if (nav === 'library') {
      if (view === 'libraryList') return ['Bibliothek', libraryTitle(libraryCategory)]
      if (view === 'libraryEdit') return ['Bibliothek', libraryTitle(libraryCategory), 'Datei hinzufügen']
      return ['Bibliothek']
    }
    if (view === 'patientEdit') return [selectedPatient ? patientLabel(selectedPatient) : 'Patientenliste', selectedPatient ? 'Patient bearbeiten' : 'Patient hinzufügen']
    if (view === 'patientDocumentEdit') return [patientLabel(selectedPatient), 'Dokumente/Befunde', 'Dokument hinzufügen']
    if (view === 'prescriptionEdit') return [patientLabel(selectedPatient), selectedPrescription ? prescriptionLabel(selectedPrescription) : 'Neue Verordnung']
    if (view === 'docEdit') return [
      patientLabel(selectedPatient),
      prescriptionLabel(selectedPrescription),
      docForm.entryDate ? `Doku ${formatDate(docForm.entryDate)}` : 'Neue Doku',
    ].filter(Boolean)
    if (view === 'prescriptionDetail') return [patientLabel(selectedPatient), prescriptionLabel(selectedPrescription)].filter(Boolean)
    if (view === 'patientDetail') return [patientLabel(selectedPatient)].filter(Boolean)
    return ['Patientenliste']
  }, [nav, view, selectedPatient, selectedPrescription, docForm.entryDate, libraryCategory])

  useEffect(() => { loadListData() }, [])

  useEffect(() => {
    if (!printData) return

    const timer = window.setTimeout(() => {
      window.print()
    }, 80)

    return () => window.clearTimeout(timer)
  }, [printData])

  async function loadListData() {
    setLoading(true)
    setError('')

    try {
      const [all, recents] = await Promise.all([getAllPatients(), getRecentlyOpenedPatients()])
      setPatients(all)
      setRecentPatients(recents)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPatientDetail(patientId) {
    setNav('patients')
    setError('')

    try {
      const patient = await getPatientById(patientId)
      if (!patient) throw new Error('Patient wurde nicht gefunden.')

      const [patientPrescriptions, documents] = await Promise.all([
        getPrescriptionsByPatientId(patientId),
        getPatientDocumentsByPatientId(patientId),
      ])

      setSelectedPatient(patient)
      setPrescriptions(patientPrescriptions)
      setPatientDocuments(documents)
      setSelectedPrescription(null)
      setDocEntries([])
      setDocEntryImageCounts({})

      await markPatientAsRecentlyOpened(patientId)
      setRecentPatients(await getRecentlyOpenedPatients())
      setView('patientDetail')
    } catch (e) {
      setError(e.message)
    }
  }

  async function reloadPatientDocuments(patientId = selectedPatient?.id) {
    if (!patientId) return
    setPatientDocuments(await getPatientDocumentsByPatientId(patientId))
  }

  async function loadPrescriptionDetail(prescription) {
    setNav('patients')
    setError('')

    try {
      const entries = await getDocEntriesByPrescriptionId(prescription.id)
      const counts = await getDocEntryImageCountMap(entries.map(entry => entry.id))
      setSelectedPrescription(prescription)
      setDocEntries(entries)
      setDocEntryImageCounts(counts)
      setView('prescriptionDetail')
    } catch (e) {
      setError(e.message)
    }
  }

  async function loadLibraryItems(category) {
    setError('')
    setLibraryCategory(category)

    try {
      setLibraryItems(await getLibraryItems(category))
      setNav('library')
      setView('libraryList')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleExportBackup() {
    setError('')
    setSuccessMessage('')

    try {
      const backup = await exportAllData()
      const json = JSON.stringify(backup, null, 2)
      const zipBlob = createZipWithBackupJson(json)
      const date = new Date().toISOString().slice(0, 10)
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `praxis-doku-backup-${date}.zip`
      link.click()
      URL.revokeObjectURL(url)
      setSuccessMessage('Backup erfolgreich als ZIP exportiert.')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm('Beim Import können vorhandene lokale Daten ersetzt werden. Wirklich fortfahren?')) return

    setError('')
    setSuccessMessage('')

    try {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
      const text = isZip ? await readBackupJsonFromZip(file) : await file.text()
      const parsed = JSON.parse(text)
      await importAllDataReplace(parsed)
      await loadListData()

      setSelectedPatient(null)
      setSelectedPrescription(null)
      setPrescriptions([])
      setPatientDocuments([])
      setDocEntries([])
      setDocEntryImageCounts({})
      setDocImages([])
      setNav('patients')
      setView('list')
      setSuccessMessage('Backup erfolgreich importiert. Lokale Daten wurden ersetzt.')
    } catch (e) {
      setError(`Import fehlgeschlagen: ${e.message}`)
    }
  }

  async function handleSavePatient(event) {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      if (!patientForm.lastName.trim() || !patientForm.firstName.trim() || !patientForm.birthDate) {
        throw new Error('Bitte Name, Vorname und Geburtsdatum ausfüllen.')
      }

      const saved = await savePatient({
        ...patientForm,
        lastName: patientForm.lastName.trim(),
        firstName: patientForm.firstName.trim(),
      })

      await markPatientAsRecentlyOpened(saved.id)
      await loadListData()

      if (selectedPatient) await loadPatientDetail(saved.id)
      else setView('list')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePrescription(event) {
    event.preventDefault()
    if (!selectedPatient) return setError('Kein Patient ausgewählt.')

    setSaving(true)
    setError('')

    try {
      if (!prescriptionForm.issueDate || !prescriptionForm.remedy.trim()) {
        throw new Error('Bitte Ausstellungsdatum und Heilmittel ausfüllen.')
      }

      await savePrescription({
        ...prescriptionForm,
        patientId: selectedPatient.id,
        remedy: prescriptionForm.remedy.trim(),
      })

      setPrescriptions(await getPrescriptionsByPatientId(selectedPatient.id))
      setView('patientDetail')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveDocEntry(event) {
    event.preventDefault()
    if (!selectedPrescription) return setError('Keine Verordnung ausgewählt.')

    setSaving(true)
    setError('')

    try {
      if (!docForm.entryDate || !docForm.text.trim()) throw new Error('Bitte Datum und Text ausfüllen.')

      const saved = await saveDocEntry({
        ...docForm,
        prescriptionId: selectedPrescription.id,
        text: docForm.text.trim(),
      })

      await saveDocEntryImages(saved.id, docImages)

      const updatedEntries = await getDocEntriesByPrescriptionId(selectedPrescription.id)
      const counts = await getDocEntryImageCountMap(updatedEntries.map(entry => entry.id))

      setDocEntries(updatedEntries)
      setDocEntryImageCounts(counts)
      setView('prescriptionDetail')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveLibraryItem(event) {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      if (libraryCategory === 'archiv') throw new Error('Das Archiv bleibt erstmal leer.')
      if (!libraryForm.title.trim()) throw new Error('Bitte eine kurze Überschrift eintragen.')
      if (!libraryForm.file) throw new Error('Bitte eine Datei auswählen.')

      await saveLibraryItem({
        ...libraryForm,
        category: libraryCategory,
        title: libraryForm.title.trim(),
        note: libraryForm.note.trim(),
      })

      await loadLibraryItems(libraryCategory)
      setSuccessMessage('Datei wurde gespeichert.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePatientDocument(event) {
    event.preventDefault()
    if (!selectedPatient) return setError('Kein Patient ausgewählt.')

    setSaving(true)
    setError('')

    try {
      if (!patientDocumentForm.documentDate) throw new Error('Bitte Datum ausfüllen.')
      if (!patientDocumentForm.title.trim()) throw new Error('Bitte eine kurze Überschrift eintragen.')
      if (!patientDocumentForm.file) throw new Error('Bitte eine Datei auswählen.')

      await savePatientDocument({
        ...patientDocumentForm,
        patientId: selectedPatient.id,
        title: patientDocumentForm.title.trim(),
        note: patientDocumentForm.note.trim(),
      })

      await reloadPatientDocuments(selectedPatient.id)
      setView('patientDetail')
      setSuccessMessage('Dokument/Befund wurde gespeichert.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleImageUpload(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return

    setError('')

    try {
      const compressed = await Promise.all(files.map(file => resizeImageToDataUrl(file)))
      setDocImages(prev => [...prev, ...compressed])
      event.target.value = ''
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleLibraryFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')

    try {
      const storedFile = await prepareStoredFile(file)
      setLibraryForm(prev => ({ ...prev, file: storedFile }))
    } catch (e) {
      setError(e.message)
    }
  }

  async function handlePatientDocumentFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')

    try {
      const storedFile = await prepareStoredFile(file)
      setPatientDocumentForm(prev => ({ ...prev, file: storedFile }))
    } catch (e) {
      setError(e.message)
    }
  }

  function handleRemoveImage(imageId) {
    setDocImages(prev => prev.filter(image => image.id !== imageId))
  }

  function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',')
  const mimeMatch = header.match(/data:(.*?);base64/)
  const mimeType = mimeMatch?.[1] || 'application/octet-stream'

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new Blob([bytes], { type: mimeType })
}

function openStoredFile(file) {
  if (!file?.dataUrl) return

  setError('')

  if (file.mimeType?.startsWith('image/')) {
    setFullscreenImage(file.dataUrl)
    return
  }

  const blob = dataUrlToBlob(file.dataUrl)
  const url = URL.createObjectURL(blob)

  const opened = window.open(url, '_blank')

  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60000)

  if (!opened) {
    setError('Die Datei konnte nicht geöffnet werden. Bitte Pop-ups/Weiterleitungen erlauben.')
  }
}

  function printPrescriptionDocs() {
    if (!selectedPrescription) return

    const sortedEntries = [...docEntries].sort((a, b) => {
      const dateA = a.entryDate || a.createdAt || ''
      const dateB = b.entryDate || b.createdAt || ''
      return dateA.localeCompare(dateB)
    })

    setError('')
    setPrintData({
      patient: selectedPatient,
      prescription: selectedPrescription,
      entries: sortedEntries,
      createdAt: new Date().toISOString(),
    })
  }

  function insertSymbolText(textToInsert) {
  const textarea = docTextareaRef.current

  if (!textarea) {
    setDocForm(prev => ({
      ...prev,
      text: `${prev.text}${prev.text ? ' ' : ''}${textToInsert}`
    }))
    return
  }

  const start = textarea.selectionStart ?? 0
  const end = textarea.selectionEnd ?? start

  setDocForm(prev => {
    const before = prev.text.slice(0, start)
    const after = prev.text.slice(end)

    const needsSpaceBefore = before && !before.endsWith(' ') && !before.endsWith('\n')
    const needsSpaceAfter = after && !after.startsWith(' ') && !after.startsWith('\n')

    const insertText =
      `${needsSpaceBefore ? ' ' : ''}${textToInsert}${needsSpaceAfter ? ' ' : ''}`

    return {
      ...prev,
      text: `${before}${insertText}${after}`
    }
  })

  window.setTimeout(() => {
    textarea.focus()
    const newPosition = start + textToInsert.length + (start > 0 ? 1 : 0)
    textarea.setSelectionRange(newPosition, newPosition)
  }, 0)
}

  function goPatients() {
    setNav('patients')
    setView('list')
  }

  return (
    <div className="app-shell">
      <div className="app-grid">
        <aside className="app-sidebar">
          <div className="sidebar-logo-wrap">
            <img src="/logo_kl.gif" alt="Praxis Logo" className="sidebar-logo" />
          </div>

          <nav className="sidebar-nav">
            {[
              ['patients', 'Patienten', Home],
              ['exercises', 'Übungen', Dumbbell],
              ['library', 'Bibliothek', Library],
              ['backup', 'Backup', CloudUpload],
              ['settings', 'Einstellungen', Settings],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                className={`sidebar-item ${nav === key ? 'is-active' : ''}`}
                onClick={() => {
                  setNav(key)
                  setSuccessMessage('')
                  if (key === 'patients') setView('list')
                  if (key === 'backup') setView('list')
                  if (key === 'library') setView('libraryHome')
                  if (key === 'exercises') setView('list')
                  if (key === 'settings') setView('list')
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="app-main">
          <header className="app-topbar">
            <div className="breadcrumb">
              {breadcrumbItems.map((item, index) => (
                <span key={`${item}-${index}`} className="breadcrumb-part">
                  {index > 0 && <span className="breadcrumb-separator">→</span>}
                  {item}
                </span>
              ))}
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

            {nav === 'exercises' && <section className="surface-card stack-lg">
              <h2 className="section-title">Übungen</h2>
              <p className="muted">Dieser Bereich wird später erweitert.</p>
              <div><button className="btn btn-ghost" onClick={goPatients}>Zurück zur Patientenliste</button></div>
            </section>}

            {nav === 'settings' && <section className="surface-card stack-lg">
              <h2 className="section-title">Einstellungen</h2>
              <p className="muted">Dieser Bereich wird später erweitert.</p>
              <div><button className="btn btn-ghost" onClick={goPatients}>Zurück zur Patientenliste</button></div>
            </section>}

            {nav === 'library' && view === 'libraryHome' && (
              <section className="surface-card stack-lg">
                <h2 className="section-title">Bibliothek</h2>
                <div className="library-grid">
                  {LIBRARY_SECTIONS.map(section => (
                    <button
                      key={section.key}
                      type="button"
                      className={`library-tile ${section.key === 'archiv' ? 'is-muted' : ''}`}
                      onClick={() => section.key === 'archiv' ? setError('Das Archiv bleibt erstmal leer.') : loadLibraryItems(section.key)}
                    >
                      <Library size={18} />
                      <span className="library-tile-title">{section.title}</span>
                      <span className="library-tile-text">{section.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {nav === 'library' && view === 'libraryList' && (
              <section className="surface-card stack">
                <div className="row-between prescription-header">
                  <div>
                    <h2 className="section-title">{libraryTitle(libraryCategory)}</h2>
                    <p className="muted">PDF, JPG oder PNG mit kurzer Überschrift speichern.</p>
                  </div>

                  <button
                    className="btn btn-green"
                    onClick={() => {
                      setLibraryForm({ ...EMPTY_LIBRARY_FORM, category: libraryCategory })
                      setView('libraryEdit')
                    }}
                  >
                    <Plus size={16} />
                    Datei
                  </button>
                </div>

                <button className="btn btn-ghost-inline" onClick={() => setView('libraryHome')}>
                  <ArrowLeft size={16} />
                  Zurück
                </button>

                <div className="stack">
                  {libraryItems.length === 0 ? (
                    <p className="muted">Noch keine Dateien.</p>
                  ) : (
                    libraryItems.map(item => (
                      <StoredFileCard
                        key={item.id}
                        title={item.title}
                        date={item.createdAt}
                        note={item.note}
                        file={item.file}
                        tone="library"
                        onOpen={openStoredFile}
                      />
                    ))
                  )}
                </div>
              </section>
            )}

            {nav === 'library' && view === 'libraryEdit' && (
              <section className="surface-card">
                <form className="stack" onSubmit={handleSaveLibraryItem}>
                  <button type="button" className="btn btn-ghost-inline" onClick={() => setView('libraryList')}>
                    <ArrowLeft size={16} />
                    Abbrechen
                  </button>

                  <h2 className="section-title">Datei für {libraryTitle(libraryCategory)}</h2>

                  <input
                    className="field"
                    placeholder="Kurze Überschrift, z. B. Proximale Humerusfraktur"
                    value={libraryForm.title}
                    onChange={event => setLibraryForm(prev => ({ ...prev, title: event.target.value }))}
                  />

                  <textarea
                    className="field library-note"
                    placeholder="Notiz optional"
                    value={libraryForm.note}
                    onChange={event => setLibraryForm(prev => ({ ...prev, note: event.target.value }))}
                  />

                  <label className="upload-card">
                    <span>
                      <Plus className="upload-plus" />
                      {libraryForm.file ? libraryForm.file.fileName : 'PDF, JPG oder PNG auswählen'}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={handleLibraryFileChange}
                    />
                  </label>

                  <div className="row-end">
                    <button type="button" className="btn btn-ghost" onClick={() => setView('libraryList')}>Abbrechen</button>
                    <button className="btn btn-primary" disabled={saving}>
                      <Save size={16} />
                      {saving ? 'Speichern...' : 'Speichern'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {(nav === 'patients' || nav === 'backup') && view === 'list' && (
              <section className="list-layout">
                <article className="surface-card">
                  <h2 className="section-title">Patientenliste</h2>

                  <div className="patient-actions">
                    <div className="search-row">
                      <div className="search-wrap">
                        <Search size={18} className="search-icon" />
                        <input
                          className="search-input"
                          placeholder="Patient suchen"
                          value={query}
                          onChange={event => setQuery(event.target.value)}
                        />
                      </div>
                      <button type="button" className="btn btn-search" aria-label="Patient suchen">
                        <Search size={18} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPatientForm(EMPTY_PATIENT_FORM)
                        setSelectedPatient(null)
                        setView('patientEdit')
                      }}
                      className="btn btn-primary add-patient-btn"
                    >
                      <Plus size={18} />
                      Patient hinzufügen
                    </button>
                  </div>

                  <div className="stack">
                    {loading ? (
                      <p className="muted">Lade Patienten...</p>
                    ) : filteredPatients.length === 0 ? (
                      <p className="muted">Keine Patienten gefunden.</p>
                    ) : (
                      filteredPatients.map(patient => (
                        <PatientCard key={patient.id} patient={patient} onOpen={loadPatientDetail} />
                      ))
                    )}
                  </div>
                </article>

                <article className="surface-card side-panel">
                  <h2 className="section-subtitle">Zuletzt geöffnet</h2>

                  <div className="stack">
                    {recentPatients.length === 0 ? (
                      <p className="muted">Keine Einträge</p>
                    ) : (
                      recentPatients.map(patient => (
                        <PatientCard key={patient.id} patient={patient} onOpen={loadPatientDetail} />
                      ))
                    )}
                  </div>

                  <div className="backup-card">
                    <h3>Datensicherung</h3>
                    <p>Alle lokalen Daten als ZIP mit backup.json.</p>

                    <div className="stack-sm">
                      <button className="btn btn-secondary" onClick={handleExportBackup}>Backup exportieren</button>
                      <button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>Backup importieren</button>
                      <input
                        ref={importInputRef}
                        type="file"
                        accept=".json,.zip,application/json,application/zip"
                        className="hidden"
                        onChange={handleImportFile}
                      />
                    </div>
                  </div>
                </article>
              </section>
            )}

            {view === 'patientDetail' && selectedPatient && (
              <section className="stack">
                <button className="btn btn-ghost-inline" onClick={() => setView('list')}>
                  <ArrowLeft size={16} />
                  Zurück
                </button>

                <article className="surface-card patient-head-card">
                  <div className="row-between">
                    <div>
                      <h2 className="section-title">{selectedPatient.lastName}, {selectedPatient.firstName}</h2>
                      <p className="muted">{formatDate(selectedPatient.birthDate)}</p>
                    </div>

                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setPatientForm(selectedPatient)
                        setView('patientEdit')
                      }}
                    >
                      <Edit3 size={15} />
                      Bearbeiten
                    </button>
                  </div>
                </article>

                <article className="surface-card card-patient-documents">
                  <div className="row-between prescription-header">
                    <h3 className="section-subtitle">Dokumente / Befunde</h3>
                    <button
                      className="btn btn-green"
                      onClick={() => {
                        setPatientDocumentForm({
                          ...EMPTY_PATIENT_DOCUMENT_FORM,
                          documentDate: todayIso(),
                        })
                        setView('patientDocumentEdit')
                      }}
                    >
                      <Plus size={16} />
                      Dokument
                    </button>
                  </div>

                  <div className="stack">
                    {patientDocuments.length === 0 ? (
                      <p className="muted">Noch keine Dokumente/Befunde.</p>
                    ) : (
                      patientDocuments.map(item => (
                        <StoredFileCard
                          key={item.id}
                          title={item.title}
                          date={item.documentDate}
                          note={item.note}
                          file={item.file}
                          tone="patient"
                          onOpen={openStoredFile}
                        />
                      ))
                    )}
                  </div>
                </article>
 <article className="surface-card">
                  <div className="row-between prescription-header">
                    <h3 className="section-subtitle">Verordnungen</h3>
                    <button
                      className="btn btn-green"
                      onClick={() => {
                        setPrescriptionForm(EMPTY_PRESCRIPTION_FORM)
                        setView('prescriptionEdit')
                      }}
                    >
		   <Plus size={16} />
                      Verordnung
                    </button>
                  </div>

                  <div className="prescription-list">
                    {prescriptions.length === 0 ? (
                      <p className="muted">Noch keine Verordnungen.</p>
                    ) : (
                      prescriptions.map(item => (
                        <PrescriptionCard key={item.id} prescription={item} onOpen={loadPrescriptionDetail} />
                      ))
                    )}
                  </div>
                </article>
              </section>
            )}

            {view === 'prescriptionDetail' && selectedPrescription && (
              <section className="prescription-layout">
                <div className="stack">
                  <button className="btn btn-ghost-inline" onClick={() => setView('patientDetail')}>
                    <ArrowLeft size={16} />
                    Zurück
                  </button>

                  <article className="surface-card card-prescription">
                    <div className="row-between">
                      <div>
                        <p><span className="chip-sub">Ausstellungsdatum:</span>
                          {' '}
                          <span className="strong">{formatDate(selectedPrescription.issueDate)}</span></p>
                        <p><span className="chip-sub mt">Heilmittel:</span>
                          {' '}
                          <span className="chip-sub mt">{selectedPrescription.remedy}</span></p>
                      </div>

                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={printPrescriptionDocs}
                        title="Doku drucken / als PDF speichern"
                        aria-label="Doku drucken oder als PDF speichern"
                      >
                        <Printer size={18} />
                      </button>
                    </div>
                  </article>

                  <button
                    className="btn btn-green full"
                    onClick={() => {
                      setDocForm(EMPTY_DOC_FORM)
                      setDocImages([])
                      setView('docEdit')
                    }}
                  >
                    <Plus size={16} />
                    Doku
                  </button>

                  <div className="stack">
                    {docEntries.length === 0 ? (
                      <p className="muted">Noch keine Doku-Einträge.</p>
                    ) : (
                      docEntries.map(entry => (
                        <DocEntryCard
                          key={entry.id}
                          entry={entry}
                          imageCount={docEntryImageCounts[entry.id] || 0}
                          onOpen={async value => {
                            setDocForm(value)
                            setDocImages(await getDocEntryImages(value.id))
                            setView('docEdit')
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>

                <article className="surface-card card-doc-preview">
                  <p className="pre">{docEntries[0]?.text || 'Doku-Eintrag auswählen oder neu erstellen.'}</p>
                </article>
              </section>
            )}

            {view === 'patientEdit' && (
              <section className="surface-card">
                <form className="stack" onSubmit={handleSavePatient}>
                  <button
                    type="button"
                    className="btn btn-ghost-inline"
                    onClick={() => setView(selectedPatient ? 'patientDetail' : 'list')}
                  >
                    <ArrowLeft size={16} />
                    Zurück
                  </button>

                  <input
                    className="field"
                    placeholder="Name"
                    value={patientForm.lastName}
                    onChange={event => setPatientForm(prev => ({ ...prev, lastName: event.target.value }))}
                  />

                  <input
                    className="field"
                    placeholder="Vorname"
                    value={patientForm.firstName}
                    onChange={event => setPatientForm(prev => ({ ...prev, firstName: event.target.value }))}
                  />

                  <input
                    type="date"
                    className="field"
                    value={patientForm.birthDate}
                    onChange={event => setPatientForm(prev => ({ ...prev, birthDate: event.target.value }))}
                  />

                  <button className="btn btn-primary" disabled={saving}>
                    <Save size={16} />
                    {saving ? 'Speichern...' : 'Speichern'}
                  </button>
                </form>
              </section>
            )}

            {view === 'patientDocumentEdit' && selectedPatient && (
              <section className="surface-card">
                <form className="stack" onSubmit={handleSavePatientDocument}>
                  <button type="button" className="btn btn-ghost-inline" onClick={() => setView('patientDetail')}>
                    <ArrowLeft size={16} />
                    Abbrechen
                  </button>

                  <h2 className="section-title">Neues Dokument / neuer Befund</h2>

                  <input
                    type="date"
                    className="field"
                    value={patientDocumentForm.documentDate}
                    onChange={event => setPatientDocumentForm(prev => ({ ...prev, documentDate: event.target.value }))}
                  />

                  <input
                    className="field"
                    placeholder="Kurze Überschrift, z. B. MRT Schulter rechts"
                    value={patientDocumentForm.title}
                    onChange={event => setPatientDocumentForm(prev => ({ ...prev, title: event.target.value }))}
                  />

                  <textarea
                    className="field library-note"
                    placeholder="Notiz optional"
                    value={patientDocumentForm.note}
                    onChange={event => setPatientDocumentForm(prev => ({ ...prev, note: event.target.value }))}
                  />

                  <label className="upload-card">
                    <span>
                      <Plus className="upload-plus" />
                      {patientDocumentForm.file ? patientDocumentForm.file.fileName : 'PDF, JPG oder PNG auswählen'}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={handlePatientDocumentFileChange}
                    />
                  </label>

                  <div className="row-end">
                    <button type="button" className="btn btn-ghost" onClick={() => setView('patientDetail')}>Abbrechen</button>
                    <button className="btn btn-primary" disabled={saving}>
                      <Save size={16} />
                      {saving ? 'Speichern...' : 'Speichern'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {view === 'prescriptionEdit' && selectedPatient && (
              <section className="surface-card">
                <form className="stack" onSubmit={handleSavePrescription}>
                  <button
                    type="button"
                    className="btn btn-ghost-inline"
                    onClick={() => setView(selectedPrescription ? 'prescriptionDetail' : 'patientDetail')}
                  >
                    <ArrowLeft size={16} />
                    Abbrechen
                  </button>

                  <input
                    type="date"
                    className="field"
                    value={prescriptionForm.issueDate}
                    onChange={event => setPrescriptionForm(prev => ({ ...prev, issueDate: event.target.value }))}
                  />

                  <input
                    className="field"
                    placeholder="Heilmittel"
                    value={prescriptionForm.remedy}
                    onChange={event => setPrescriptionForm(prev => ({ ...prev, remedy: event.target.value }))}
                  />

                  <button className="btn btn-primary" disabled={saving}>
                    <Save size={16} />
                    {saving ? 'Speichern...' : 'Speichern'}
                  </button>
                </form>
              </section>
            )}

            {view === 'docEdit' && selectedPrescription && (
              <section className="surface-card card-doc-edit">
                <form className="stack-lg" onSubmit={handleSaveDocEntry}>
                  <button type="button" className="btn btn-ghost-inline" onClick={() => setView('prescriptionDetail')}>
                    <ArrowLeft size={16} />
                    Abbrechen
                  </button>

                  <input
                    type="date"
                    className="field"
                    value={docForm.entryDate}
                    onChange={event => setDocForm(prev => ({ ...prev, entryDate: event.target.value }))}
                  />

                  <div className="toolbar-box">
                    <p className="toolbar-title">Schreibstütze</p>

                    <div className="toolbar-row">
                      {TOOLBAR_INSERTS.map(item => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => insertSymbolText(item.insert)}
                          className="pill-btn"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    ref={docTextareaRef}
                    className="field textfield"
                    value={docForm.text}
                    onChange={event => setDocForm(prev => ({ ...prev, text: event.target.value }))}
                  />

                  <div className="image-grid">
                    <label className="upload-card">
                      <span><Plus className="upload-plus" />Bild hinzufügen</span>
                      <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                    </label>

                    {docImages.map(image => (
                      <div key={image.id} className="image-card">
                        <img
                          src={image.dataUrl}
                          alt={image.fileName}
                          className="image-preview"
                          onClick={() => setFullscreenImage(image.dataUrl)}
                        />
                        <p className="image-name">{image.fileName}</p>
                        <button type="button" className="btn btn-danger" onClick={() => handleRemoveImage(image.id)}>Bild entfernen</button>
                      </div>
                    ))}
                  </div>

                  <div className="row-end">
                    <button type="button" className="btn btn-ghost" onClick={() => setView('prescriptionDetail')}>Abbrechen</button>
                    <button className="btn btn-primary" disabled={saving}>
                      <Save size={16} />
                      {saving ? 'Speichern...' : 'Speichern'}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </main>
        </section>
      </div>

      {printData && (
        <section className="print-only" aria-label="Druckansicht Behandlungsdokumentation">
          <header className="print-header">
            <h1>Behandlungsdokumentation</h1>
            <p>
              <span className="print-label">Patient/in:</span>
              {' '}
              {printData.patient ? `${printData.patient.lastName}, ${printData.patient.firstName}` : 'Patient/in'}
            </p>
            <p>
              <span className="print-label">Geburtsdatum:</span>
              {' '}
              {formatDate(printData.patient?.birthDate)}
            </p>
            <p>
              <span className="print-label">Verordnung:</span>
              {' '}
              {formatDate(printData.prescription.issueDate)}
              {' · '}
              {printData.prescription.remedy}
            </p>
          </header>

          <main>
            {printData.entries.length === 0 ? (
              <p className="print-muted">Zu dieser Verordnung gibt es noch keine Doku-Einträge.</p>
            ) : (
              printData.entries.map(entry => (
                <section key={entry.id} className="print-entry">
                  <h2>{formatDate(entry.entryDate)}</h2>
                  <p>{entry.text}</p>
                </section>
              ))
            )}
          </main>

          <footer className="print-footer">
            Erstellt am {formatDate(printData.createdAt)}
          </footer>
        </section>
      )}

      {fullscreenImage && (
        <div
          className="lightbox"
          onClick={() => setFullscreenImage(null)}
          role="button"
          tabIndex={0}
          onKeyDown={event => {
            if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
              setFullscreenImage(null)
            }
          }}
          aria-label="Bild schließen"
        >
          <img
            src={fullscreenImage}
            alt="Vergrößerte Bildansicht"
            className="lightbox-image"
            onClick={event => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
