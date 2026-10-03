import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, CircleHelp, CloudUpload, Dumbbell, Edit3, FileText, Home, Library,
  Plus, Printer, RotateCcw, Save, Search, Settings, Trash2, UserCircle2,
} from 'lucide-react'
import {
  exportAllData, getAllPatients, getDeletedPatients, getDocEntriesByPrescriptionId, getDocEntryImageCountMap,
  getDocEntryImages, getLibraryItems, getPatientById, getPatientDocumentsByPatientId,
  getPrescriptionsByPatientId, getRecentlyOpenedPatients, importAllDataReplace,
  markPatientAsRecentlyOpened, movePatientToTrash, restorePatientFromTrash, saveDocEntry,
  saveDocEntryImages, saveLibraryItem, savePatient, savePatientDocument, savePrescription,
} from './lib/patientsDb'
import './App.css'
import DocumentationEditor from './components/DocumentationEditor'
import DateInput from './components/DateInput'
import { loadModel } from './speech/speechService'
import { supabase } from './lib/supabase'
import { downloadVault, downloadVaultManifest, getVaultInfo, uploadVault } from './lib/cloudVault'
import {
  getPatientFromSupabase, listActivePatients, listDeletedPatients, patientFromRow,
  restorePatientInSupabase, savePatientToSupabase, softDeletePatientInSupabase,
} from './lib/supabasePatients'
import {
  listPrescriptionsForPatient, prescriptionFromRow, savePrescriptionToSupabase,
} from './lib/supabasePrescriptions'
import {
  docEntryFromRow, listDocEntriesForPrescription, saveDocEntryToSupabase,
} from './lib/supabaseDocEntries'
import {
  getDocEntryImageCountMapFromSupabase, listDocEntryImageMeta,
  loadDocEntryImagesFromSupabase, syncDocEntryImagesToSupabase,
} from './lib/supabaseDocImages'
import {
  listPatientDocumentsForPatient, loadPatientDocumentFile, patientDocumentFromRow,
  savePatientDocumentToSupabase,
} from './lib/supabasePatientDocuments'
import {
  libraryItemFromRow, listLibraryItems, loadLibraryItemFile, saveLibraryItemToSupabase,
} from './lib/supabaseLibrary'
import {
  inspectLegacyBackup, migrateLegacyBackupToSupabase,
} from './lib/supabaseMigration'
import {
  cacheDocEntries, cacheDocEntry, cachePatient, cachePatients,
  cachePrescription, cachePrescriptions, enqueueOutbox, getCachedDocEntries,
  getCachedPatient, getCachedPatients, getCachedPrescriptions, getOutboxCount,
  getOutboxItems, markOutboxConflict, removeOutboxItem,
} from './lib/v2OfflineDb'
import {
  createPracticeKeyBundle, createProductionPracticeKeyBundle,
  decryptPracticeBytes, decryptPracticeText,
  encryptPracticeBytes, encryptPracticeText, sha256Hex,
  unlockPracticeKey, unlockPracticeKeyWithRecovery, V2_CRYPTO_PARAMETERS,
} from './lib/v2Crypto'
import {
  getEncryptedLabFileId, getEncryptedMiniPracticeIds, loadEncryptedFantasyPatient,
  loadEncryptedLabFile, loadEncryptedMiniPractice, saveEncryptedFantasyPatient,
  saveEncryptedLabFile, saveEncryptedMiniDocEntryPayload, saveEncryptedMiniPractice,
} from './lib/supabaseCryptoLab'
import {
  clearEncryptedOfflineLab, getEncryptedOfflineOutbox, inspectEncryptedOfflineLabRaw,
  loadEncryptedOfflineSnapshot, queueEncryptedOfflineDocEntry,
  removeEncryptedOfflineOutboxItem, saveEncryptedOfflineSnapshot,
} from './lib/v2EncryptedOfflineLab'
import {
  createEncryptedSupabaseBackup, verifyEncryptedSupabaseBackup,
} from './lib/v2EncryptedBackup'
import {
  createV3Keyring, getV3EncryptedCounts, loadV3Keyring,
} from './lib/v3EncryptedPractice'
import {
  buildV3EncryptedParallelCopy, verifyV3EncryptedParallelCopy,
} from './lib/v3ParallelMigration'
import {
  getV3DocEntryImageCountMap, getV3Patient, listV3ActivePatients,
  listV3DeletedPatients, listV3DocEntriesForPrescription, listV3LibraryItems,
  listV3PatientDocumentsForPatient, listV3PrescriptionsForPatient,
  loadV3DocEntryImages, loadV3LibraryItemFile, loadV3PatientDocumentFile,
} from './lib/v3ReadOnly'
import {
  createEncryptedV3MirrorOfflineItem, mirrorQueuedV3OfflineItem,
  mirrorV3DocEntryById, mirrorV3LibraryItemById, mirrorV3PatientById,
  mirrorV3PatientDocumentById, mirrorV3PrescriptionById,
} from './lib/v3WriteMirror'
import {
  enqueueV3MirrorOutbox, getV3MirrorOutboxCount, getV3MirrorOutboxItems,
  inspectV3MirrorOutboxRaw, removeV3MirrorOutboxItem,
} from './lib/v3MirrorOfflineDb'
import {
  restoreV3Patient, saveV3DocEntry, saveV3LibraryItem, saveV3Patient,
  saveV3PatientDocument, saveV3Prescription, softDeleteV3Patient,
  syncV3DocEntryImages,
} from './lib/v3PrimaryStore'


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

const USER_ROLES = {
  OWNER: 'owner',
  STAFF: 'staff',
}

const USER_ROLE_LABELS = {
  [USER_ROLES.OWNER]: 'Praxisleitung',
  [USER_ROLES.STAFF]: 'Mitarbeiter',
}

const LAST_MODIFIED_STORAGE_KEY = 'pwaLastModifiedAt'
const LOGIN_AT_STORAGE_KEY = 'physiooptima-doku-login-at'
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000
const LAST_ENCRYPTED_EXPORT_STORAGE_KEY = 'pwaLastEncryptedExportAt'
const AUTO_SYNC_DEBOUNCE_MS = 8000
const AUTO_SYNC_POLL_MS = 20000
const ENCRYPTION_ITERATIONS = 100000
const APP_VERSION = '2026-07-17-backup-v2'
const V2_CRYPTO_LAB_STORAGE_KEY = 'physiooptima-v2-crypto-lab'
const V2_CRYPTO_LAB_PATIENT_CONTEXT = 'physiooptima:v2:crypto-lab:fantasy_patient_v1'
const V2_CRYPTO_LAB_PATIENT = Object.freeze({
  firstName: 'Max',
  lastName: 'Muster',
  birthDate: '1970-02-01',
  note: 'Schulter rechts',
})
const V2_CRYPTO_MINI_PATIENT = Object.freeze({
  firstName: 'Erika',
  lastName: 'Probe',
  birthDate: '1965-04-12',
})
const V2_CRYPTO_MINI_PRESCRIPTION = Object.freeze({
  issueDate: '2026-10-01',
  remedy: 'MT',
})
const V2_CRYPTO_MINI_DOC_ENTRY = Object.freeze({
  entryDate: '2026-10-03',
  text: 'Schulter rechts: Elevation eingeschränkt. Behandlung gut vertragen.',
})
const V2_CRYPTO_MINI_DOC_ENTRY_OFFLINE = Object.freeze({
  entryDate: '2026-10-03',
  text: 'Schulter rechts: Offline-Test – Elevation verbessert. Behandlung gut vertragen.',
})

function miniPatientContext(patientId) {
  return `physiooptima:v2:patient:${patientId}`
}

function miniPrescriptionContext(prescriptionId, patientId) {
  return `physiooptima:v2:prescription:${prescriptionId}:patient:${patientId}`
}

function miniDocEntryContext(docEntryId, prescriptionId) {
  return `physiooptima:v2:doc-entry:${docEntryId}:prescription:${prescriptionId}`
}

function miniFileMetadataContext(fileId, docEntryId) {
  return `physiooptima:v2:file-metadata:${fileId}:doc-entry:${docEntryId}`
}

function miniFileBytesContext(fileId, docEntryId) {
  return `physiooptima:v2:file-bytes:${fileId}:doc-entry:${docEntryId}`
}

function createCryptoLabPdfBytes() {
  const encoder = new TextEncoder()
  const content = [
    'BT',
    '/F1 18 Tf',
    '72 720 Td',
    '(PhysioOptima Testbefund) Tj',
    '0 -28 Td',
    '(Erika Probe - 12.04.1965) Tj',
    '0 -28 Td',
    '(Schulter rechts) Tj',
    'ET',
  ].join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  objects.forEach((objectText, index) => {
    offsets[index + 1] = encoder.encode(pdf).byteLength
    pdf += `${index + 1} 0 obj\n${objectText}\nendobj\n`
  })

  const xrefOffset = encoder.encode(pdf).byteLength
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`

  return encoder.encode(pdf)
}

const BACKUP_ARRAY_KEYS = [
  'patients',
  'prescriptions',
  'documentationEntries',
  'images',
  'patientDocuments',
  'libraryItems',
]

const getNowIso = () => new Date().toISOString()

function isConnectivityError(error) {
  if (!navigator.onLine) return true
  const message = String(error?.message || error || '').toLowerCase()
  return (
    error instanceof TypeError ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed') ||
    message.includes('fetch')
  )
}

function localPendingRecord(item) {
  const now = getNowIso()
  return {
    ...item,
    createdAt: item.createdAt || now,
    updatedAt: now,
    pendingSync: true,
  }
}

function readStoredTimestamp(key) {
  return window.localStorage.getItem(key) || ''
}

function writeStoredTimestamp(key, value) {
  window.localStorage.setItem(key, value)
}

function getItemChangeDate(item) {
  return item?.updatedAt || item?.createdAt || item?.entryDate || item?.issueDate || item?.documentDate || ''
}

function isChangedAfter(item, timestamp) {
  if (!timestamp) return true
  const changedAt = getItemChangeDate(item)
  return changedAt && changedAt > timestamp
}

function stampForSave(item, now = getNowIso()) {
  return {
    ...item,
    createdAt: item.createdAt || now,
    updatedAt: now,
  }
}

function getBackupMaxModifiedAt(backup) {
  let max = ''

  BACKUP_ARRAY_KEYS.forEach(key => {
    ;(backup?.[key] || []).forEach(item => {
      const changedAt = getItemChangeDate(item)
      if (changedAt && changedAt > max) max = changedAt
    })
  })

  return max
}

function mergeItemsByNewest(currentItems = [], incomingItems = []) {
  const map = new Map()

  currentItems.forEach(item => {
    if (item?.id) map.set(item.id, item)
  })

  incomingItems.forEach(item => {
    if (!item?.id) return

    const existing = map.get(item.id)
    if (!existing || getItemChangeDate(item) >= getItemChangeDate(existing)) {
      map.set(item.id, item)
    }
  })

  return Array.from(map.values())
}

function mergeBackupData(currentBackup, incomingBackup) {
  const merged = { ...currentBackup }

  BACKUP_ARRAY_KEYS.forEach(key => {
    merged[key] = mergeItemsByNewest(currentBackup?.[key] || [], incomingBackup?.[key] || [])
  })

  return merged
}

function createChangeBackup(fullBackup, changedAfter) {
  const changedDocEntryIds = new Set(
    (fullBackup.documentationEntries || [])
      .filter(item => isChangedAfter(item, changedAfter))
      .map(item => item.id)
  )

  return {
    type: 'praxis-doku-change-backup',
    version: 2,
    exportedAt: getNowIso(),
    changedAfter: changedAfter || '',

    patients: (fullBackup.patients || [])
      .filter(item => isChangedAfter(item, changedAfter)),

    prescriptions: (fullBackup.prescriptions || [])
      .filter(item => isChangedAfter(item, changedAfter)),

    documentationEntries: (fullBackup.documentationEntries || [])
      .filter(item => isChangedAfter(item, changedAfter)),

    images: (fullBackup.images || [])
      .filter(item =>
        isChangedAfter(item, changedAfter) ||
        changedDocEntryIds.has(item.docEntryId)
      ),

    patientDocuments: (fullBackup.patientDocuments || [])
      .filter(item => isChangedAfter(item, changedAfter)),

    libraryItems: (fullBackup.libraryItems || [])
      .filter(item => isChangedAfter(item, changedAfter)),
  }
}


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
const formatDateTime = value => (value ? new Date(value).toLocaleString('de-DE') : 'Noch keine Änderung erfasst')
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
          updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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
  const [deletedPatients, setDeletedPatients] = useState([])
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
  const [patientDocumentConflict, setPatientDocumentConflict] = useState(null)
  const [patientDocumentBase, setPatientDocumentBase] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [outboxCount, setOutboxCount] = useState(0)
  const [migrationPreview, setMigrationPreview] = useState(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState('')
  const [cryptoLabConfigured, setCryptoLabConfigured] = useState(
    () => Boolean(window.localStorage.getItem(V2_CRYPTO_LAB_STORAGE_KEY)),
  )
  const [cryptoPassphrase, setCryptoPassphrase] = useState('')
  const [cryptoPassphraseConfirm, setCryptoPassphraseConfirm] = useState('')
  const [cryptoRecoveryCode, setCryptoRecoveryCode] = useState('')
  const [cryptoRecoveryInput, setCryptoRecoveryInput] = useState('')
  const [cryptoUnlocked, setCryptoUnlocked] = useState(false)
  const [cryptoBusy, setCryptoBusy] = useState(false)
  const [cryptoTestText, setCryptoTestText] = useState('Testpatient Max Muster – Schulter rechts.')
  const [cryptoCipherPreview, setCryptoCipherPreview] = useState('')
  const [cryptoDecryptedText, setCryptoDecryptedText] = useState('')
  const [cryptoCloudCipherPreview, setCryptoCloudCipherPreview] = useState('')
  const [cryptoCloudPatient, setCryptoCloudPatient] = useState(null)
  const [cryptoCloudUpdatedAt, setCryptoCloudUpdatedAt] = useState('')
  const [cryptoMiniCipherSummary, setCryptoMiniCipherSummary] = useState([])
  const [cryptoMiniPractice, setCryptoMiniPractice] = useState(null)
  const [cryptoLabFileCipherInfo, setCryptoLabFileCipherInfo] = useState(null)
  const [cryptoLabFileResult, setCryptoLabFileResult] = useState(null)
  const [cryptoLabFileUrl, setCryptoLabFileUrl] = useState('')
  const [cryptoOfflineAudit, setCryptoOfflineAudit] = useState(null)
  const [cryptoOfflinePractice, setCryptoOfflinePractice] = useState(null)
  const [cloudBackupPassphrase, setCloudBackupPassphrase] = useState('')
  const [cloudBackupPassphraseConfirm, setCloudBackupPassphraseConfirm] = useState('')
  const [cloudBackupBusy, setCloudBackupBusy] = useState(false)
  const [cloudBackupProgress, setCloudBackupProgress] = useState('')
  const [cloudBackupSummary, setCloudBackupSummary] = useState(null)
  const [cloudBackupVerification, setCloudBackupVerification] = useState(null)
  const [cloudBackupVerificationFile, setCloudBackupVerificationFile] = useState('')
  const [v3Keyring, setV3Keyring] = useState(null)
  const [v3KeyringReady, setV3KeyringReady] = useState(false)
  const [v3KeyBusy, setV3KeyBusy] = useState(false)
  const [v3Passphrase, setV3Passphrase] = useState('')
  const [v3PassphraseConfirm, setV3PassphraseConfirm] = useState('')
  const [v3RecoveryCode, setV3RecoveryCode] = useState('')
  const [v3RecoveryInput, setV3RecoveryInput] = useState('')
  const [v3RecoveryDownloaded, setV3RecoveryDownloaded] = useState(false)
  const [v3Unlocked, setV3Unlocked] = useState(false)
  const [v3Counts, setV3Counts] = useState(null)
  const [v3BridgeBusy, setV3BridgeBusy] = useState(false)
  const [v3BridgeProgress, setV3BridgeProgress] = useState('')
  const [v3BridgeVerification, setV3BridgeVerification] = useState(null)
  const [v3ReadMode, setV3ReadMode] = useState(false)
  const [v3MirrorMode, setV3MirrorMode] = useState(false)
  const [v3MirrorLastMessage, setV3MirrorLastMessage] = useState('')
  const [v3MirrorOutboxCount, setV3MirrorOutboxCount] = useState(0)
  const [v3MirrorOfflineAudit, setV3MirrorOfflineAudit] = useState(null)
  const [v3PrimaryMode, setV3PrimaryMode] = useState(false)
  const [printData, setPrintData] = useState(null)
  const docTextareaRef = useRef(null)
  const importInputRef = useRef(null)
  const changeImportRef = useRef(null)
  const changeZipImportRef = useRef(null)
  const migrationInputRef = useRef(null)
  const migrationBackupRef = useRef(null)
  const encryptedCloudBackupInputRef = useRef(null)
  const cryptoPracticeKeyRef = useRef(null)
  const v3CandidateBundleRef = useRef(null)
  const v3PracticeKeyRef = useRef(null)
  const v3ReadModeRef = useRef(false)
  const v3MirrorModeRef = useRef(false)
  const v3PrimaryModeRef = useRef(false)
  const [userRole, setUserRole] = useState(() => window.localStorage.getItem('pwaUserRole') || USER_ROLES.OWNER)
  const [userName, setUserName] = useState(() => window.localStorage.getItem('pwaUserName') || 'Anna')
  const [lastModifiedAt, setLastModifiedAt] = useState(() => readStoredTimestamp(LAST_MODIFIED_STORAGE_KEY))
  const [lastEncryptedExportAt, setLastEncryptedExportAt] = useState(() => readStoredTimestamp(LAST_ENCRYPTED_EXPORT_STORAGE_KEY))
  const [cloudUser, setCloudUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [patientConflict, setPatientConflict] = useState(null)
  const [prescriptionConflict, setPrescriptionConflict] = useState(null)
  const [docConflict, setDocConflict] = useState(null)
  const [docBaseEntry, setDocBaseEntry] = useState(null)
  const [docImageBaseIds, setDocImageBaseIds] = useState([])
  const [cloudEmail, setCloudEmail] = useState('')
  const [cloudPassword, setCloudPassword] = useState('')
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState('')
  const [cloudBusy, setCloudBusy] = useState(false)
  const [autoSyncPassword, setAutoSyncPassword] = useState('')
  const [autoSyncStatus, setAutoSyncStatus] = useState('off')
  const [autoSyncMessage, setAutoSyncMessage] = useState('Automatische Synchronisation ist ausgeschaltet.')
  const autoSyncBusyRef = useRef(false)
  const outboxFlushBusyRef = useRef(false)
  const v3MirrorFlushBusyRef = useRef(false)
  const autoSyncTimerRef = useRef(null)
  const lastCloudTimestampRef = useRef('')
  const lastSyncedLocalTimestampRef = useRef('')
  const lastModifiedAtRef = useRef(lastModifiedAt)
  const remoteApplyRef = useRef(false)
  const selectedPatientRef = useRef(null)
  const patientFormRef = useRef(EMPTY_PATIENT_FORM)
  const viewRef = useRef('list')
  const patientSaveBusyRef = useRef(false)
  const selectedPrescriptionRef = useRef(null)
  const prescriptionFormRef = useRef(EMPTY_PRESCRIPTION_FORM)
  const prescriptionSaveBusyRef = useRef(false)
  const docFormRef = useRef(EMPTY_DOC_FORM)
  const docBaseEntryRef = useRef(null)
  const docSaveBusyRef = useRef(false)
  const docImagesRef = useRef([])
  const docImageBaseIdsRef = useRef([])
  const patientDocumentFormRef = useRef(EMPTY_PATIENT_DOCUMENT_FORM)
  const patientDocumentBaseRef = useRef(null)
  const patientDocumentSaveBusyRef = useRef(false)
  const libraryCategoryRef = useRef('nachbehandlung')
  const isOwner = userRole === USER_ROLES.OWNER
  const isStaff = userRole === USER_ROLES.STAFF
  const canManageTrash = isOwner && Boolean(cloudUser) && !v3ReadMode

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return patients
    return patients.filter(patient => `${patient.lastName} ${patient.firstName}`.toLowerCase().includes(normalized))
  }, [patients, query])

  const breadcrumbItems = useMemo(() => {
    if (nav === 'backup') return ['Backup']
    if (nav === 'trash') return ['Patienten', 'Papierkorb']
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

  useEffect(() => {
    return () => {
      if (cryptoLabFileUrl) URL.revokeObjectURL(cryptoLabFileUrl)
    }
  }, [cryptoLabFileUrl])

  useEffect(() => {
    selectedPatientRef.current = selectedPatient
    patientFormRef.current = patientForm
    selectedPrescriptionRef.current = selectedPrescription
    prescriptionFormRef.current = prescriptionForm
    docFormRef.current = docForm
    docBaseEntryRef.current = docBaseEntry
    docImagesRef.current = docImages
    docImageBaseIdsRef.current = docImageBaseIds
    patientDocumentFormRef.current = patientDocumentForm
    patientDocumentBaseRef.current = patientDocumentBase
    libraryCategoryRef.current = libraryCategory
    viewRef.current = view
  }, [selectedPatient, patientForm, selectedPrescription, prescriptionForm, docForm, docBaseEntry, docImages, docImageBaseIds, patientDocumentForm, patientDocumentBase, libraryCategory, view])

  useEffect(() => {
    // Im V3-Hauptbetrieb wird vor dem Entsperren absichtlich keine
    // Patientenliste geladen. So blitzt kein alter lokaler/Klartext-Stand auf.
    if (!cloudUser) return
  }, [cloudUser])


  useEffect(() => {
    let active = true

    if (!cloudUser) {
      setV3Keyring(null)
      setV3KeyringReady(false)
      setV3Counts(null)
      v3PracticeKeyRef.current = null
      v3ReadModeRef.current = false
      v3MirrorModeRef.current = false
      v3PrimaryModeRef.current = false
      setV3ReadMode(false)
      setV3MirrorMode(false)
      setV3PrimaryMode(false)
      setV3Unlocked(false)
      return () => { active = false }
    }

    setV3KeyringReady(false)
    Promise.all([
      loadV3Keyring(cloudUser.id),
      getV3EncryptedCounts(cloudUser.id),
    ]).then(([keyring, counts]) => {
      if (!active) return
      setV3Keyring(keyring)
      setV3Counts(counts)
      setV3KeyringReady(true)
    }).catch(error => {
      if (!active) return
      setV3KeyringReady(true)
      setError(`V3-Status konnte nicht geladen werden: ${error.message}`)
    })

    return () => { active = false }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    // Alt-Outbox nur noch anzeigen, nicht mehr automatisch in die
    // Klartexttabellen schreiben. Vor dem Produktionswechsel muss sie leer sein.
    void refreshOutboxCount()
    void refreshV3MirrorOutboxCount()
    return undefined
  }, [cloudUser])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return

      const loginAt = Number(window.localStorage.getItem(LOGIN_AT_STORAGE_KEY) || 0)
      const session = data.session

      if (session && loginAt && Date.now() - loginAt > TEN_DAYS_MS) {
        await supabase.auth.signOut()
        window.localStorage.removeItem(LOGIN_AT_STORAGE_KEY)
        setCloudUser(null)
      } else {
        if (session && !loginAt) {
          window.localStorage.setItem(LOGIN_AT_STORAGE_KEY, String(Date.now()))
        }
        setCloudUser(session?.user || null)
      }

      setAuthReady(true)
    }).catch(() => setAuthReady(true))

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setCloudUser(session?.user || null)
      setAuthReady(true)

      if (event === 'SIGNED_OUT') {
        v3PracticeKeyRef.current = null
        v3CandidateBundleRef.current = null
        v3ReadModeRef.current = false
        v3MirrorModeRef.current = false
        v3PrimaryModeRef.current = false
        setV3ReadMode(false)
        setV3MirrorMode(false)
        setV3PrimaryMode(false)
        setV3Unlocked(false)
        setV3Keyring(null)
        setV3KeyringReady(false)
        setV3Counts(null)
        window.localStorage.removeItem(LOGIN_AT_STORAGE_KEY)
        window.clearTimeout(autoSyncTimerRef.current)
        setAutoSyncPassword('')
        setAutoSyncStatus('off')
        setAutoSyncMessage('Automatische Synchronisation ist ausgeschaltet.')
      }
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!cloudUser) return undefined

    const canRefreshV3 = () =>
      v3PrimaryModeRef.current && Boolean(v3PracticeKeyRef.current)

    const refreshPatientScope = () => {
      if (!canRefreshV3()) return
      void loadListData()
      const patient = selectedPatientRef.current
      if (patient?.id) void loadPatientDetail(patient.id)
    }

    const refreshPrescriptionScope = () => {
      if (!canRefreshV3()) return
      const prescription = selectedPrescriptionRef.current
      if (prescription?.id) {
        void loadPrescriptionDetail(prescription)
      } else {
        const patient = selectedPatientRef.current
        if (patient?.id) void loadPatientDetail(patient.id)
      }
    }

    const channel = supabase
      .channel('doku-v3-primary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v3_patients' }, refreshPatientScope)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v3_prescriptions' }, refreshPatientScope)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v3_doc_entries' }, refreshPrescriptionScope)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v3_doc_entry_images' }, refreshPrescriptionScope)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v3_patient_documents' }, refreshPatientScope)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'v3_library_items' }, () => {
        if (!canRefreshV3()) return
        if (viewRef.current === 'libraryList') {
          void loadLibraryItems(libraryCategoryRef.current)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    const channel = supabase
      .channel('doku-v2-patients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, payload => {
        if (v3ReadModeRef.current || v3PrimaryModeRef.current) return
        if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id
          if (removedId) setPatients(current => current.filter(item => item.id !== removedId))
          return
        }

        const incoming = patientFromRow(payload.new)
        if (!incoming?.id) return
        void cachePatient(incoming).catch(() => {})

        if (incoming.deletedAt) {
          setPatients(current => current.filter(item => item.id !== incoming.id))
          setDeletedPatients(current => {
            const exists = current.some(item => item.id === incoming.id)
            return exists
              ? current.map(item => item.id === incoming.id ? incoming : item)
              : [...current, incoming]
          })
        } else {
          setPatients(current => {
            const exists = current.some(item => item.id === incoming.id)
            const next = exists
              ? current.map(item => item.id === incoming.id ? incoming : item)
              : [...current, incoming]
            return next.sort((a, b) =>
              a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
            )
          })
          setDeletedPatients(current => current.filter(item => item.id !== incoming.id))
        }

        const selected = selectedPatientRef.current
        if (!selected || selected.id !== incoming.id || patientSaveBusyRef.current) return

        if (viewRef.current === 'patientEdit') {
          const form = patientFormRef.current
          const dirty =
            form.firstName !== selected.firstName ||
            form.lastName !== selected.lastName ||
            form.birthDate !== selected.birthDate

          if (dirty && incoming.updatedAt !== selected.updatedAt) {
            setPatientConflict(incoming)
          } else if (!dirty) {
            setSelectedPatient(incoming)
            setPatientForm(incoming)
            setPatientConflict(null)
          }
        } else if (viewRef.current === 'patientDetail') {
          setSelectedPatient(incoming)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    const channel = supabase
      .channel('doku-v2-prescriptions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prescriptions' }, payload => {
        if (v3ReadModeRef.current || v3PrimaryModeRef.current) return
        if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id
          if (removedId) setPrescriptions(current => current.filter(item => item.id !== removedId))
          return
        }

        const incoming = prescriptionFromRow(payload.new)
        if (!incoming?.id) return
        void cachePrescription(incoming).catch(() => {})

        const selectedPatientNow = selectedPatientRef.current
        if (!selectedPatientNow || incoming.patientId !== selectedPatientNow.id) return

        if (incoming.deletedAt) {
          setPrescriptions(current => current.filter(item => item.id !== incoming.id))
        } else {
          setPrescriptions(current => {
            const exists = current.some(item => item.id === incoming.id)
            const next = exists
              ? current.map(item => item.id === incoming.id ? incoming : item)
              : [...current, incoming]
            return next.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
          })
        }

        const selected = selectedPrescriptionRef.current
        if (!selected || selected.id !== incoming.id || prescriptionSaveBusyRef.current) return

        if (viewRef.current === 'prescriptionEdit') {
          const form = prescriptionFormRef.current
          const dirty =
            form.issueDate !== selected.issueDate ||
            form.remedy !== selected.remedy

          if (dirty && incoming.updatedAt !== selected.updatedAt) {
            setPrescriptionConflict(incoming)
          } else if (!dirty) {
            setSelectedPrescription(incoming)
            setPrescriptionForm(incoming)
            setPrescriptionConflict(null)
          }
        } else if (viewRef.current === 'prescriptionDetail') {
          setSelectedPrescription(incoming)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    const channel = supabase
      .channel('doku-v2-doc-entries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_entries' }, payload => {
        if (v3ReadModeRef.current || v3PrimaryModeRef.current) return
        if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id
          if (removedId) {
            setDocEntries(current => current.filter(item => item.id !== removedId))
            setDocEntryImageCounts(current => {
              const next = { ...current }
              delete next[removedId]
              return next
            })
          }
          return
        }

        const incoming = docEntryFromRow(payload.new)
        if (!incoming?.id) return
        void cacheDocEntry(incoming).catch(() => {})

        const prescription = selectedPrescriptionRef.current
        if (!prescription || incoming.prescriptionId !== prescription.id) return

        if (incoming.deletedAt) {
          setDocEntries(current => current.filter(item => item.id !== incoming.id))
        } else {
          setDocEntries(current => {
            const exists = current.some(item => item.id === incoming.id)
            const next = exists
              ? current.map(item => item.id === incoming.id ? incoming : item)
              : [...current, incoming]
            return next.sort((a, b) =>
              (b.entryDate || '').localeCompare(a.entryDate || '') ||
              (b.createdAt || '').localeCompare(a.createdAt || '')
            )
          })
          setDocEntryImageCounts(current => (
            Object.prototype.hasOwnProperty.call(current, incoming.id)
              ? current
              : { ...current, [incoming.id]: 0 }
          ))
        }

        if (viewRef.current !== 'docEdit' || docSaveBusyRef.current) return

        const form = docFormRef.current
        const base = docBaseEntryRef.current
        if (!form?.id || form.id !== incoming.id || !base) return

        const dirty =
          form.entryDate !== base.entryDate ||
          form.text !== base.text

        if (dirty && incoming.updatedAt !== base.updatedAt) {
          setDocConflict(incoming)
        } else if (!dirty) {
          setDocForm(incoming)
          setDocBaseEntry(incoming)
          setDocConflict(null)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    const channel = supabase
      .channel('doku-v2-doc-images')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doc_entry_images' }, async payload => {
        if (v3ReadModeRef.current || v3PrimaryModeRef.current) return
        const row = payload.new || payload.old
        const docEntryId = row?.doc_entry_id
        if (!docEntryId) return

        try {
          const meta = await listDocEntryImageMeta(docEntryId)
          setDocEntryImageCounts(current => ({ ...current, [docEntryId]: meta.length }))

          if (
            viewRef.current === 'docEdit' &&
            docFormRef.current?.id === docEntryId &&
            !docSaveBusyRef.current
          ) {
            const currentIds = docImagesRef.current.map(image => image.id).sort().join('|')
            const baseIds = docImageBaseIdsRef.current.slice().sort().join('|')

            // Nur automatisch nachladen, wenn dieses Gerät seine Bildauswahl nicht lokal verändert hat.
            if (currentIds === baseIds) {
              const images = await loadDocEntryImagesFromSupabase(docEntryId)
              setDocImages(images)
              setDocImageBaseIds(images.map(image => image.id))
            }
          }
        } catch (e) {
          setError(`Bild-Synchronisation: ${e.message}`)
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    const channel = supabase
      .channel('doku-v2-patient-documents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patient_documents' }, async payload => {
        if (v3ReadModeRef.current || v3PrimaryModeRef.current) return
        if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id
          if (removedId) {
            setPatientDocuments(current => current.filter(item => item.id !== removedId))
          }
          return
        }

        const incoming = patientDocumentFromRow(payload.new)
        if (!incoming?.id) return

        const selected = selectedPatientRef.current
        if (!selected || selected.id !== incoming.patientId) return

        setPatientDocuments(current => {
          if (incoming.deletedAt) {
            return current.filter(item => item.id !== incoming.id)
          }

          const exists = current.some(item => item.id === incoming.id)
          const next = exists
            ? current.map(item => item.id === incoming.id ? incoming : item)
            : [...current, incoming]

          return next.sort((a, b) =>
            (b.documentDate || '').localeCompare(a.documentDate || '') ||
            (b.createdAt || '').localeCompare(a.createdAt || '')
          )
        })

        if (
          viewRef.current === 'patientDocumentEdit' &&
          patientDocumentBaseRef.current?.id === incoming.id &&
          !patientDocumentSaveBusyRef.current
        ) {
          const form = patientDocumentFormRef.current
          const base = patientDocumentBaseRef.current
          const dirty =
            form.documentDate !== base.documentDate ||
            form.title !== base.title ||
            form.note !== base.note ||
            (form.file?.storagePath || '') !== (base.file?.storagePath || '') ||
            Boolean(form.file?.dataUrl && !form.file?.storagePath)

          if (dirty && incoming.updatedAt !== base.updatedAt) {
            setPatientDocumentConflict(incoming)
          } else if (!dirty) {
            try {
              const loaded = await loadPatientDocumentFile(incoming)
              setPatientDocumentForm(loaded)
              setPatientDocumentBase(incoming)
              setPatientDocumentConflict(null)
            } catch (e) {
              setError(`Dokument konnte nicht aktualisiert werden: ${e.message}`)
            }
          }
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) return undefined

    const channel = supabase
      .channel('doku-v2-library-items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'library_items' }, payload => {
        if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id
          if (removedId) setLibraryItems(current => current.filter(item => item.id !== removedId))
          return
        }

        const incoming = libraryItemFromRow(payload.new)
        if (!incoming?.id || incoming.category !== libraryCategoryRef.current) return

        setLibraryItems(current => {
          if (incoming.deletedAt) {
            return current.filter(item => item.id !== incoming.id)
          }

          const exists = current.some(item => item.id === incoming.id)
          const next = exists
            ? current.map(item => item.id === incoming.id ? incoming : item)
            : [...current, incoming]

          return next.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [cloudUser])

  useEffect(() => {
    if (!cloudUser) { setCloudUpdatedAt(''); return }
    getVaultInfo(cloudUser.id).then(info => {
      const updatedAt = info?.updatedAt || ''
      setCloudUpdatedAt(updatedAt)
      lastCloudTimestampRef.current = updatedAt
    }).catch(() => setCloudUpdatedAt(''))
  }, [cloudUser])

  useEffect(() => {
    lastModifiedAtRef.current = lastModifiedAt
  }, [lastModifiedAt])

  useEffect(() => {
    if (!autoSyncPassword || !cloudUser) return undefined

    const checkCloud = async () => {
      if (autoSyncBusyRef.current) return

      try {
        const info = await getVaultInfo(cloudUser.id)
        const remoteTimestamp = info?.updatedAt || ''
        if (!remoteTimestamp || remoteTimestamp === lastCloudTimestampRef.current) return

        // WICHTIG: Nie einen veralteten lokalen Komplettstand blind hochladen.
        // Auch wenn dieses Gerät eigene Änderungen hat, werden zuerst beide Stände
        // zusammengeführt (pro Datensatz gewinnt updatedAt) und erst danach hochgeladen.
        setAutoSyncStatus('syncing')
        setAutoSyncMessage('Cloud-Änderung erkannt – beide Geräte werden sicher zusammengeführt ...')
        await syncLocalVault(autoSyncPassword, true, 'remote')
      } catch (e) {
        setAutoSyncStatus('error')
        setAutoSyncMessage(`Synchronisation angehalten: ${e.message}`)
      }
    }

    const interval = window.setInterval(checkCloud, AUTO_SYNC_POLL_MS)
    return () => window.clearInterval(interval)
  }, [autoSyncPassword, cloudUser])

  useEffect(() => {
    if (!autoSyncPassword || !cloudUser || !lastModifiedAt) return undefined
    if (remoteApplyRef.current) {
      remoteApplyRef.current = false
      return undefined
    }
    if (lastModifiedAt === lastSyncedLocalTimestampRef.current) return undefined

    setAutoSyncStatus('waiting')
    setAutoSyncMessage('Lokale Änderung erkannt – wird gleich verschlüsselt synchronisiert ...')
    window.clearTimeout(autoSyncTimerRef.current)
    autoSyncTimerRef.current = window.setTimeout(() => {
      syncLocalVault(autoSyncPassword, true)
    }, AUTO_SYNC_DEBOUNCE_MS)

    return () => window.clearTimeout(autoSyncTimerRef.current)
  }, [lastModifiedAt, autoSyncPassword, cloudUser])

  useEffect(() => {
    if (nav === 'trash' && !canManageTrash) {
      setNav('patients')
      setView('list')
    }
  }, [canManageTrash, nav])

  useEffect(() => {
    if (!isOwner && autoSyncPassword) handleDisableAutoSync()
  }, [isOwner, autoSyncPassword])

  useEffect(() => {
    if (!printData) return

    const timer = window.setTimeout(() => {
      window.print()
    }, 80)

    return () => window.clearTimeout(timer)
  }, [printData])

  async function loadListData(forceLegacy = false) {
    if (!cloudUser) return
    setLoading(true)
    setError('')

    if ((v3ReadModeRef.current || v3PrimaryModeRef.current) && !forceLegacy) {
      try {
        if (!v3PracticeKeyRef.current) {
          throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
        }
        const [all, deleted] = await Promise.all([
          listV3ActivePatients(v3PracticeKeyRef.current),
          listV3DeletedPatients(v3PracticeKeyRef.current),
        ])
        setPatients(all)
        setDeletedPatients(deleted)
        setRecentPatients([])
        setSuccessMessage(v3PrimaryModeRef.current ? '🚗 V3-Hauptbetrieb: Patientenliste aus verschlüsseltem V3-Bestand geladen.' : '🔒 V3-Lesemodus: Patientenliste lokal aus Chiffretext entschlüsselt.')
      } catch (e) {
        setError(`V3-Lesen fehlgeschlagen: ${e.message}`)
      } finally {
        setLoading(false)
      }
      return
    }

    try {
      const [all, deleted] = await Promise.all([
        listActivePatients(),
        listDeletedPatients(),
      ])
      setPatients(all)
      setDeletedPatients(deleted)
      setRecentPatients([])
      await cachePatients([...all, ...deleted])
    } catch (e) {
      try {
        const cached = await getCachedPatients()
        const active = cached.filter(patient => !patient.deletedAt)
        const deleted = cached.filter(patient => patient.deletedAt)
        if (!cached.length) throw e

        setPatients(active)
        setDeletedPatients(deleted)
        setRecentPatients([])
        setError('')
        setSuccessMessage('Offline: lokale Arbeitskopie geladen.')
      } catch {
        setError(e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadPatientDetail(patientId) {
    setNav('patients')
    setError('')
    setPatientConflict(null)

    if (v3ReadModeRef.current || v3PrimaryModeRef.current) {
      try {
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const [patient, patientPrescriptions, documents] = await Promise.all([
          getV3Patient(patientId, v3PracticeKeyRef.current),
          listV3PrescriptionsForPatient(patientId, v3PracticeKeyRef.current),
          listV3PatientDocumentsForPatient(patientId, v3PracticeKeyRef.current),
        ])

        if (!patient || patient.deletedAt) throw new Error('V3-Patient wurde nicht gefunden.')

        setSelectedPatient(patient)
        setPrescriptions(patientPrescriptions)
        setPatientDocuments(documents)
        setSelectedPrescription(null)
        setDocEntries([])
        setDocEntryImageCounts({})
        setView('patientDetail')
        setSuccessMessage(v3PrimaryModeRef.current ? '🚗 V3-Hauptbetrieb: Patient aus V3 geladen.' : '🔒 V3-Lesemodus: Patient, Verordnungen und Befunde lokal entschlüsselt.')
      } catch (e) {
        setError(`V3-Patient konnte nicht gelesen werden: ${e.message}`)
      }
      return
    }

    try {
      const patient = await getPatientFromSupabase(patientId)
      if (!patient || patient.deletedAt) throw new Error('Patient wurde nicht gefunden.')

      const [patientPrescriptions, documents] = await Promise.all([
        listPrescriptionsForPatient(patientId),
        listPatientDocumentsForPatient(patientId),
      ])

      await Promise.all([
        cachePatient(patient),
        cachePrescriptions(patientPrescriptions),
      ])

      setSelectedPatient(patient)
      setPrescriptions(patientPrescriptions)
      setPatientDocuments(documents)
      setSelectedPrescription(null)
      setDocEntries([])
      setDocEntryImageCounts({})
      setView('patientDetail')
    } catch (e) {
      try {
        const [patient, patientPrescriptions] = await Promise.all([
          getCachedPatient(patientId),
          getCachedPrescriptions(patientId),
        ])
        if (!patient || patient.deletedAt) throw e

        setSelectedPatient(patient)
        setPrescriptions(patientPrescriptions)
        setPatientDocuments([])
        setSelectedPrescription(null)
        setDocEntries([])
        setDocEntryImageCounts({})
        setView('patientDetail')
        setError('')
        setSuccessMessage('Offline: Patient und Verordnungen aus lokaler Arbeitskopie.')
      } catch {
        setError(e.message)
      }
    }
  }

  async function reloadPatientDocuments(patientId = selectedPatient?.id) {
    if (!patientId) return

    if (v3ReadModeRef.current || v3PrimaryModeRef.current) {
      if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
      setPatientDocuments(
        await listV3PatientDocumentsForPatient(patientId, v3PracticeKeyRef.current),
      )
      return
    }

    setPatientDocuments(await listPatientDocumentsForPatient(patientId))
  }

  async function loadPrescriptionDetail(prescription) {
    setNav('patients')
    setError('')
    setPrescriptionConflict(null)

    if (v3ReadModeRef.current || v3PrimaryModeRef.current) {
      try {
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
        const entries = await listV3DocEntriesForPrescription(
          prescription.id,
          v3PracticeKeyRef.current,
        )
        const counts = await getV3DocEntryImageCountMap(entries.map(entry => entry.id))
        setSelectedPrescription(prescription)
        setDocEntries(entries)
        setDocEntryImageCounts(counts)
        setView('prescriptionDetail')
        setSuccessMessage(v3PrimaryModeRef.current ? '🚗 V3-Hauptbetrieb: Verordnung und Doku aus V3 geladen.' : '🔒 V3-Lesemodus: Verordnung und Doku lokal entschlüsselt.')
      } catch (e) {
        setError(`V3-Verordnung konnte nicht gelesen werden: ${e.message}`)
      }
      return
    }

    try {
      const entries = await listDocEntriesForPrescription(prescription.id)
      const counts = await getDocEntryImageCountMapFromSupabase(entries.map(entry => entry.id))
      await Promise.all([
        cachePrescription(prescription),
        cacheDocEntries(entries),
      ])
      setSelectedPrescription(prescription)
      setDocEntries(entries)
      setDocEntryImageCounts(counts)
      setView('prescriptionDetail')
    } catch (e) {
      try {
        const entries = await getCachedDocEntries(prescription.id)
        setSelectedPrescription(prescription)
        setDocEntries(entries)
        setDocEntryImageCounts(Object.fromEntries(entries.map(entry => [entry.id, 0])))
        setView('prescriptionDetail')
        setError('')
        setSuccessMessage('Offline: Doku aus lokaler Arbeitskopie.')
      } catch {
        setError(e.message)
      }
    }
  }

  async function loadLibraryItems(category) {
    setError('')
    setLibraryCategory(category)

    try {
      if (v3ReadModeRef.current || v3PrimaryModeRef.current) {
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
        setLibraryItems(await listV3LibraryItems(category, v3PracticeKeyRef.current))
        setSuccessMessage(v3PrimaryModeRef.current ? '🚗 V3-Hauptbetrieb: Bibliothek aus V3 geladen.' : '🔒 V3-Lesemodus: Bibliothek lokal entschlüsselt.')
      } else {
        setLibraryItems(await listLibraryItems(category))
      }
      setNav('library')
      setView('libraryList')
    } catch (e) {
      setError(e.message)
    }
  }

  async function refreshOutboxCount() {
    try {
      setOutboxCount(await getOutboxCount())
    } catch {
      setOutboxCount(0)
    }
  }

  async function refreshV3MirrorOutboxCount() {
    try {
      setV3MirrorOutboxCount(await getV3MirrorOutboxCount())
    } catch {
      setV3MirrorOutboxCount(0)
    }
  }

  async function queueEncryptedV3MirrorOffline(kind, record, parentId = '') {
    if (!v3MirrorModeRef.current) return
    if (!v3PracticeKeyRef.current) {
      throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
    }

    const item = await createEncryptedV3MirrorOfflineItem(
      kind,
      record,
      parentId,
      v3PracticeKeyRef.current,
      cloudUser?.id || '',
    )

    await enqueueV3MirrorOutbox(item)

    const forbiddenValues = kind === 'patient'
      ? [record.firstName, record.lastName, record.birthDate]
      : kind === 'prescription'
        ? [String(record.remedy || '').length >= 4 ? record.remedy : '']
        : [record.text]

    const audit = await inspectV3MirrorOutboxRaw(forbiddenValues)
    setV3MirrorOfflineAudit(audit)

    if (!audit.safe) {
      await removeV3MirrorOutboxItem(item.id)
      await refreshV3MirrorOutboxCount()
      throw new Error(
        `Sicherheitsprüfung der V3-Spiegel-Outbox fehlgeschlagen: Klartextfund ${audit.leaks.join(', ')}`,
      )
    }

    await refreshV3MirrorOutboxCount()
  }

  async function flushV3MirrorOutbox() {
    if (
      !cloudUser ||
      !navigator.onLine ||
      !v3PracticeKeyRef.current ||
      v3MirrorFlushBusyRef.current
    ) return

    v3MirrorFlushBusyRef.current = true
    let mirrored = 0

    try {
      const [mirrorItems, legacyItems] = await Promise.all([
        getV3MirrorOutboxItems(),
        getOutboxItems(),
      ])
      const legacyPendingIds = new Set(
        legacyItems
          .filter(item => !item.userId || item.userId === cloudUser.id)
          .map(item => item.id),
      )

      for (const item of mirrorItems) {
        if (item.userId && item.userId !== cloudUser.id) continue
        if (legacyPendingIds.has(item.id)) continue

        try {
          await mirrorQueuedV3OfflineItem(
            item,
            cloudUser.id,
            v3PracticeKeyRef.current,
          )
          await removeV3MirrorOutboxItem(item.id)
          mirrored += 1
        } catch (e) {
          setError(
            `V3-Spiegel-Outbox wartet weiter: ${e.message}`,
          )
          break
        }
      }

      await refreshV3MirrorOutboxCount()
      setV3MirrorOfflineAudit(await inspectV3MirrorOutboxRaw([]))

      if (mirrored > 0) {
        setV3MirrorLastMessage(
          `🪞 ${mirrored} Offline-Änderung${mirrored === 1 ? '' : 'en'} nach V3 gespiegelt und geprüft.`,
        )
      }
    } finally {
      v3MirrorFlushBusyRef.current = false
    }
  }

  async function flushOutbox() {
    if (!cloudUser || !navigator.onLine || outboxFlushBusyRef.current) return

    outboxFlushBusyRef.current = true
    let synced = 0
    let conflicts = 0

    try {
      const items = await getOutboxItems()

      for (const item of items) {
        if (item.userId && item.userId !== cloudUser.id) continue

        try {
          if (item.kind === 'patient') {
            const result = await savePatientToSupabase(
              item.payload,
              cloudUser.id,
              item.expectedUpdatedAt || '',
              item.mode || 'update',
            )

            if (result.conflict) {
              conflicts += 1
              await markOutboxConflict(item.id, result.conflict)
              continue
            }

            const saved = { ...result.patient, pendingSync: false }
            await cachePatient(saved)
            setPatients(current => {
              const exists = current.some(row => row.id === saved.id)
              const next = exists
                ? current.map(row => row.id === saved.id ? saved : row)
                : [...current, saved]
              return next.sort((a, b) =>
                a.lastName.localeCompare(b.lastName, 'de') ||
                a.firstName.localeCompare(b.firstName, 'de')
              )
            })
          }

          if (item.kind === 'prescription') {
            const result = await savePrescriptionToSupabase(
              item.payload,
              item.parentId,
              cloudUser.id,
              item.expectedUpdatedAt || '',
              item.mode || 'update',
            )

            if (result.conflict) {
              conflicts += 1
              await markOutboxConflict(item.id, result.conflict)
              continue
            }

            const saved = { ...result.prescription, pendingSync: false }
            await cachePrescription(saved)

            if (selectedPatientRef.current?.id === saved.patientId) {
              setPrescriptions(current => {
                const exists = current.some(row => row.id === saved.id)
                const next = exists
                  ? current.map(row => row.id === saved.id ? saved : row)
                  : [...current, saved]
                return next.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
              })
            }
          }

          if (item.kind === 'docEntry') {
            const result = await saveDocEntryToSupabase(
              item.payload,
              item.parentId,
              cloudUser.id,
              item.expectedUpdatedAt || '',
              item.mode || 'update',
            )

            if (result.conflict) {
              conflicts += 1
              await markOutboxConflict(item.id, result.conflict)
              continue
            }

            const saved = { ...result.entry, pendingSync: false }
            await cacheDocEntry(saved)

            if (selectedPrescriptionRef.current?.id === saved.prescriptionId) {
              setDocEntries(current => {
                const exists = current.some(row => row.id === saved.id)
                const next = exists
                  ? current.map(row => row.id === saved.id ? saved : row)
                  : [...current, saved]
                return next.sort((a, b) =>
                  (b.entryDate || '').localeCompare(a.entryDate || '') ||
                  (b.createdAt || '').localeCompare(a.createdAt || '')
                )
              })
            }
          }

          await removeOutboxItem(item.id)
          synced += 1
        } catch (e) {
          if (isConnectivityError(e)) break
          setError(`Offline-Synchronisation: ${e.message}`)
          break
        }
      }

      await refreshOutboxCount()
      await flushV3MirrorOutbox()

      if (synced > 0 && conflicts === 0) {
        setError('')
        setSuccessMessage(
          synced === 1
            ? '1 Offline-Änderung wurde mit Supabase synchronisiert.'
            : `${synced} Offline-Änderungen wurden mit Supabase synchronisiert.`,
        )
      } else if (conflicts > 0) {
        setError(
          conflicts === 1
            ? 'Eine Offline-Änderung hat einen Konflikt und wurde nicht überschrieben.'
            : `${conflicts} Offline-Änderungen haben Konflikte und wurden nicht überschrieben.`,
        )
      }
    } finally {
      outboxFlushBusyRef.current = false
    }
  }

  function markDataChanged(timestamp = getNowIso()) {
    writeStoredTimestamp(LAST_MODIFIED_STORAGE_KEY, timestamp)
    setLastModifiedAt(timestamp)
    return timestamp
  }
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte)
  })

  return window.btoa(binary)
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes.buffer
}

async function createEncryptionKey(password, salt, iterations = ENCRYPTION_ITERATIONS) {
  const encoder = new TextEncoder()

  if (!window.crypto?.subtle) {
    throw new Error('Dieser Browser unterstützt die benötigte Verschlüsselung nicht.')
  }

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptText(text, password) {
  const encoder = new TextEncoder()
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const key = await createEncryptionKey(password, salt, ENCRYPTION_ITERATIONS)

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(text)
  )

  return JSON.stringify({
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: ENCRYPTION_ITERATIONS,
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encryptedBuffer)
  })
}
async function decryptText(encryptedText, password) {
  const payload = JSON.parse(encryptedText)
  const decoder = new TextDecoder()

  const salt = new Uint8Array(base64ToArrayBuffer(payload.salt))
  const iv = new Uint8Array(base64ToArrayBuffer(payload.iv))
  const encryptedBuffer = base64ToArrayBuffer(payload.data)

  const key = await createEncryptionKey(
    password,
    salt,
    payload.iterations || 250000
  )

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encryptedBuffer
  )

  return decoder.decode(decryptedBuffer)
}

async function handleCloudLogin(event) {
  event.preventDefault(); setError(''); setCloudBusy(true)
  try {
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: cloudEmail.trim(), password: cloudPassword })
    if (loginError) throw loginError
    window.localStorage.setItem(LOGIN_AT_STORAGE_KEY, String(Date.now()))
    setCloudPassword(''); setSuccessMessage('Anmeldung erfolgreich.')
  } catch (e) { setError(`Cloud-Anmeldung fehlgeschlagen: ${e.message}`) }
  finally { setCloudBusy(false) }
}

async function syncLocalVault(password, automatic = false, reason = 'local') {
  if (!password || !cloudUser || autoSyncBusyRef.current) return
  autoSyncBusyRef.current = true
  setCloudBusy(true)
  if (automatic) {
    setAutoSyncStatus('syncing')
    setAutoSyncMessage(
      reason === 'remote'
        ? 'Cloud-Änderung wird mit diesem Gerät zusammengeführt ...'
        : 'Lokale Änderung wird zuerst mit der Cloud abgeglichen ...'
    )
  }

  try {
    // Sicherheitsregel: PULL -> MERGE -> PUSH.
    // Dadurch kann ein Gerät, das über Nacht einen alten lokalen Stand behalten hat,
    // den neueren Cloud-Stand nicht mehr einfach überschreiben.
    let localBackup = await exportAllData()
    let infoBefore = await getVaultInfo(cloudUser.id)
    let previousManifest = null
    let mergedBackup = localBackup

    if (infoBefore) {
      previousManifest = await downloadVaultManifest(password, decryptText, cloudUser.id)
      const remoteBackup = await downloadVault(password, decryptText, cloudUser.id, localBackup)
      mergedBackup = mergeBackupData(localBackup, remoteBackup)

      // Falls sich die Cloud genau während des Downloads geändert hat, einmal neu lesen.
      // Das verkleinert das verbleibende Race-Window zwischen zwei gleichzeitig aktiven Geräten.
      const infoAfterDownload = await getVaultInfo(cloudUser.id)
      if (infoAfterDownload?.updatedAt && infoAfterDownload.updatedAt !== infoBefore.updatedAt) {
        infoBefore = infoAfterDownload
        previousManifest = await downloadVaultManifest(password, decryptText, cloudUser.id)
        const newestRemote = await downloadVault(password, decryptText, cloudUser.id, mergedBackup)
        mergedBackup = mergeBackupData(mergedBackup, newestRemote)
      }

      await importAllDataReplace(mergedBackup)
      await loadListData()
    }

    const result = await uploadVault(mergedBackup, password, encryptText, cloudUser.id, previousManifest)
    const infoAfter = await getVaultInfo(cloudUser.id)
    const remoteTimestamp = infoAfter?.updatedAt || result.exportedAt
    const localTimestamp = getBackupMaxModifiedAt(mergedBackup) || lastModifiedAtRef.current || result.exportedAt

    // Nur wenn der Merge tatsächlich einen anderen Änderungsstand einspielt,
    // soll der folgende React-Effekt diesen State-Wechsel ignorieren.
    const timestampChangedByMerge = localTimestamp !== lastModifiedAtRef.current
    remoteApplyRef.current = timestampChangedByMerge
    writeStoredTimestamp(LAST_MODIFIED_STORAGE_KEY, localTimestamp)
    lastModifiedAtRef.current = localTimestamp
    lastSyncedLocalTimestampRef.current = localTimestamp
    lastCloudTimestampRef.current = remoteTimestamp
    setLastModifiedAt(localTimestamp)
    setCloudUpdatedAt(remoteTimestamp)

    if (reason === 'remote') {
      setSelectedPatient(null)
      setSelectedPrescription(null)
      setNav('patients')
      setView('list')
    }

    setAutoSyncStatus(autoSyncPassword || automatic ? 'active' : 'off')
    setAutoSyncMessage(
      automatic
        ? `Aktuell – Datenstände sicher zusammengeführt. ${result.fileCount} geänderte Datei(en) übertragen.`
        : 'Cloud-Tresor wurde sicher abgeglichen und aktualisiert.'
    )
    if (!automatic) {
      setSuccessMessage(`Cloud-Tresor sicher synchronisiert. ${result.fileCount} geänderte Dateien wurden übertragen.`)
    }
  } catch (e) {
    if (automatic) {
      setAutoSyncStatus('error')
      setAutoSyncMessage(`Automatische Synchronisation angehalten: ${e.message}`)
    } else {
      setError(`Cloud-Synchronisation fehlgeschlagen: ${e.message}`)
    }
  } finally {
    autoSyncBusyRef.current = false
    setCloudBusy(false)
  }
}

async function handleEnableAutoSync() {
  if (!cloudUser || !isOwner || autoSyncBusyRef.current) return
  const password = window.prompt('Tresor-Passwort eingeben. Es bleibt nur bis zum Schließen der PWA im Arbeitsspeicher:')
  if (!password) return

  setError('')
  setCloudBusy(true)
  autoSyncBusyRef.current = true
  setAutoSyncStatus('syncing')
  setAutoSyncMessage('Tresor wird geprüft und sicher mit diesem Gerät abgeglichen ...')

  try {
    const info = await getVaultInfo(cloudUser.id)
    let remoteBackup = null
    let remoteManifest = null
    const localBackup = await exportAllData()

    if (info) {
      remoteManifest = await downloadVaultManifest(password, decryptText, cloudUser.id)
      remoteBackup = await downloadVault(password, decryptText, cloudUser.id, localBackup)
    } else {
      const confirmation = window.prompt('Noch einmal dasselbe Tresor-Passwort eingeben:')
      if (confirmation !== password) throw new Error('Die beiden Passwörter stimmen nicht überein.')
    }

    const mergedBackup = remoteBackup ? mergeBackupData(localBackup, remoteBackup) : localBackup
    if (remoteBackup) {
      await importAllDataReplace(mergedBackup)
      await loadListData()
    }

    const result = await uploadVault(mergedBackup, password, encryptText, cloudUser.id, remoteManifest)
    const infoAfter = await getVaultInfo(cloudUser.id)
    const remoteTimestamp = infoAfter?.updatedAt || result.exportedAt
    const localTimestamp = getBackupMaxModifiedAt(mergedBackup) || result.exportedAt

    writeStoredTimestamp(LAST_MODIFIED_STORAGE_KEY, localTimestamp)
    lastModifiedAtRef.current = localTimestamp
    lastSyncedLocalTimestampRef.current = localTimestamp
    lastCloudTimestampRef.current = remoteTimestamp
    setLastModifiedAt(localTimestamp)
    setCloudUpdatedAt(remoteTimestamp)
    setAutoSyncPassword(password)
    setAutoSyncStatus('active')
    setAutoSyncMessage(`Aktuell – automatische Synchronisation läuft. ${result.fileCount} geänderte Datei(en) übertragen.`)
    setSuccessMessage('Automatische Synchronisation wurde sicher gestartet.')
  } catch (e) {
    setAutoSyncPassword('')
    setAutoSyncStatus('error')
    setAutoSyncMessage(`Synchronisation nicht gestartet: ${e.message}`)
    setError(`Synchronisation nicht gestartet: ${e.message}`)
  } finally {
    autoSyncBusyRef.current = false
    setCloudBusy(false)
  }
}

function handleDisableAutoSync() {
  window.clearTimeout(autoSyncTimerRef.current)
  setAutoSyncPassword('')
  setAutoSyncStatus('off')
  setAutoSyncMessage('Automatische Synchronisation ist ausgeschaltet.')
}

async function handleCloudUpload() {
  const password = window.prompt('Verschlüsselungspasswort für den Cloud-Tresor eingeben:')
  if (!password || !cloudUser) return
  const existingVault = await getVaultInfo(cloudUser.id).catch(() => null)
  if (!existingVault) {
    const confirmation = window.prompt('Dasselbe Verschlüsselungspasswort noch einmal eingeben:')
    if (confirmation !== password) {
      setError('Die beiden Passwörter stimmen nicht überein. Es wurde nichts hochgeladen.')
      return
    }
  }
  setError(''); setSuccessMessage('Lokale und Cloud-Daten werden sicher zusammengeführt und verschlüsselt synchronisiert...')
  await syncLocalVault(password, false)
}

async function handleCloudDownload() {
  if (!cloudUser || !window.confirm('Cloud-Daten herunterladen und die lokalen Daten vollständig ersetzen?')) return
  const password = window.prompt('Verschlüsselungspasswort für den Cloud-Tresor eingeben:')
  if (!password) return
  setError(''); setCloudBusy(true)
  try {
    const currentBackup = await exportAllData()
    const backup = await downloadVault(password, decryptText, cloudUser.id, currentBackup)
    await importAllDataReplace(backup); await loadListData()
    const importedTimestamp = getBackupMaxModifiedAt(backup) || getNowIso()
    remoteApplyRef.current = true
    markDataChanged(importedTimestamp)
    lastSyncedLocalTimestampRef.current = importedTimestamp
    setSelectedPatient(null); setSelectedPrescription(null); setNav('patients'); setView('list')
    setSuccessMessage('Cloud-Tresor entschlüsselt und lokal wiederhergestellt.')
  } catch (e) { setError(`Cloud-Download fehlgeschlagen: ${e.message}`) }
  finally { setCloudBusy(false) }
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

async function handleExportEncryptedBackup() {
  setError('')
  setSuccessMessage('')

  try {
    const password = window.prompt('Praxis-Passwort für Verschlüsselung eingeben:')

    if (!password) {
      setError('Verschlüsselter Änderungs-Export abgebrochen.')
      return
    }

    const fullBackup = await exportAllData()
    const changeBackup = createChangeBackup(fullBackup, lastEncryptedExportAt)
console.log('=== CHANGE BACKUP ===')
console.log(changeBackup)
console.log('documentationEntries:', changeBackup.documentationEntries)
console.log('images:', changeBackup.images)
console.log('lastEncryptedExportAt:', lastEncryptedExportAt)
    const changeCount = BACKUP_ARRAY_KEYS.reduce((sum, key) => sum + (changeBackup[key]?.length || 0), 0)

    if (changeCount === 0) {
      setSuccessMessage('Keine neuen Änderungen seit dem letzten verschlüsselten Änderungs-Export.')
      return
    }

    setSuccessMessage('Verschlüsseltes Backup wird vorbereitet... bitte kurz warten.')

    const json = JSON.stringify(changeBackup)
    const encryptedText = await encryptText(json, password)

    const blob = new Blob([encryptedText], {
      type: 'application/octet-stream'
    })

    const date = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `praxis-aenderungen-${date}.enc`
    document.body.appendChild(link)
    link.click()
    link.remove()

    window.setTimeout(() => URL.revokeObjectURL(url), 30000)

    const confirmed = window.confirm(
      'Wurde die verschlüsselte Backup-Datei erfolgreich gespeichert?'
    )

    if (confirmed) {
      const exportedAt = changeBackup.exportedAt || getNowIso()
      writeStoredTimestamp(LAST_ENCRYPTED_EXPORT_STORAGE_KEY, exportedAt)
      setLastEncryptedExportAt(exportedAt)

      setSuccessMessage(`Verschlüsseltes Änderungs-Backup exportiert: ${changeCount} geänderte Einträge.`)
    } else {
      setSuccessMessage(
        'Export wurde nicht als erledigt markiert. Du kannst den verschlüsselten Export erneut versuchen.'
      )
    }
  } catch (e) {
    setError(`Verschlüsselter Export fehlgeschlagen: ${e.message}`)
  }
}

async function handleImportEncryptedChanges(event) {
  const file = event.target.files?.[0]
  event.target.value = ''

  if (!file) return

  setError('')
  setSuccessMessage('')

  try {
    const password = window.prompt('Passwort für verschlüsseltes Änderungs-Backup eingeben:')

    if (!password) {
      setError('Verschlüsselter Import abgebrochen.')
      return
    }

    const encryptedText = await file.text()
    const jsonText = await decryptText(encryptedText, password)
    const incomingBackup = JSON.parse(jsonText)

    if (incomingBackup.type !== 'praxis-doku-change-backup') {
      throw new Error('Diese Datei ist kein Änderungs-Backup.')
    }

    const currentBackup = await exportAllData()
    const mergedBackup = mergeBackupData(currentBackup, incomingBackup)

    await importAllDataReplace(mergedBackup)
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

    const importedMaxModifiedAt = getBackupMaxModifiedAt(incomingBackup)
    if (importedMaxModifiedAt) markDataChanged(importedMaxModifiedAt)

    const changeCount = BACKUP_ARRAY_KEYS.reduce((sum, key) => sum + (incomingBackup[key]?.length || 0), 0)
    setSuccessMessage(`Verschlüsseltes Änderungs-Backup importiert: ${changeCount} Einträge geprüft/übernommen.`)
  } catch (e) {
    setError(`Verschlüsselter Import fehlgeschlagen: ${e.message}`)
  }
}


async function handleExportChangeZip() {
  setError('')
  setSuccessMessage('')

  try {
    const fullBackup = await exportAllData()
    const changeBackup = createChangeBackup(fullBackup, lastEncryptedExportAt)
    const changeCount = BACKUP_ARRAY_KEYS.reduce((sum, key) => sum + (changeBackup[key]?.length || 0), 0)

    if (changeCount === 0) {
  const allDocs = fullBackup.documentationEntries || []
  const newestDoc = [...allDocs].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(
      String(a.updatedAt || a.createdAt || '')
    )
  )[0]

  setSuccessMessage(
    `Diagnose: ${allDocs.length} Doku-Einträge vorhanden. ` +
    `Neuester Doku-Zeitpunkt: ${newestDoc?.updatedAt || newestDoc?.createdAt || 'fehlt'}. ` +
    `Vergleichspunkt: ${lastEncryptedExportAt || 'kein früherer Export'}.`
  )

  return
}

    const json = JSON.stringify(changeBackup, null, 2)
    const zipBlob = createZipWithBackupJson(json)
    const date = new Date().toISOString().slice(0, 10)
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')

    link.href = url
    link.download = `praxis-aenderungen-${date}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()

    window.setTimeout(() => URL.revokeObjectURL(url), 30000)

    const exportedAt = changeBackup.exportedAt || getNowIso()
    writeStoredTimestamp(LAST_ENCRYPTED_EXPORT_STORAGE_KEY, exportedAt)
    setLastEncryptedExportAt(exportedAt)

    setSuccessMessage(`ZIP-Änderungs-Backup exportiert: ${changeCount} geänderte Einträge.`)
  } catch (e) {
    setError(`ZIP-Änderungs-Export fehlgeschlagen: ${e.message}`)
  }
}

async function handleImportChangeZip(event) {
  const file = event.target.files?.[0]
  event.target.value = ''

  if (!file) return

  setError('')
  setSuccessMessage('')

  try {
    const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
    const text = isZip ? await readBackupJsonFromZip(file) : await file.text()
    const incomingBackup = JSON.parse(text)

    if (incomingBackup.type !== 'praxis-doku-change-backup') {
      throw new Error('Diese Datei ist kein Änderungs-Backup.')
    }

    const currentBackup = await exportAllData()
    const mergedBackup = mergeBackupData(currentBackup, incomingBackup)

    await importAllDataReplace(mergedBackup)
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

    const importedMaxModifiedAt = getBackupMaxModifiedAt(incomingBackup)
    if (importedMaxModifiedAt) markDataChanged(importedMaxModifiedAt)

    const changeCount = BACKUP_ARRAY_KEYS.reduce((sum, key) => sum + (incomingBackup[key]?.length || 0), 0)
    setSuccessMessage(`ZIP-Änderungs-Backup importiert: ${changeCount} Einträge geprüft/übernommen.`)
  } catch (e) {
    setError(`ZIP-Änderungs-Import fehlgeschlagen: ${e.message}`)
  }
}









  function readCryptoLabBundle() {
    const raw = window.localStorage.getItem(V2_CRYPTO_LAB_STORAGE_KEY)
    if (!raw) throw new Error('Noch kein Test-Praxisschlüssel angelegt.')
    return JSON.parse(raw)
  }

  async function handleCreateCryptoLab(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (cryptoPassphrase !== cryptoPassphraseConfirm) {
        throw new Error('Die beiden Test-Passphrasen stimmen nicht überein.')
      }

      const bundle = await createPracticeKeyBundle(cryptoPassphrase)
      window.localStorage.setItem(
        V2_CRYPTO_LAB_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          passwordEnvelope: bundle.passwordEnvelope,
          recoveryEnvelope: bundle.recoveryEnvelope,
          createdAt: getNowIso(),
        }),
      )

      cryptoPracticeKeyRef.current = bundle.practiceKey
      setCryptoLabConfigured(true)
      setCryptoUnlocked(true)
      setCryptoRecoveryCode(bundle.recoveryCode)
      setCryptoRecoveryInput('')
      setCryptoPassphrase('')
      setCryptoPassphraseConfirm('')
      setCryptoCipherPreview('')
      setCryptoDecryptedText('')
      setSuccessMessage('Test-Praxisschlüssel erzeugt. Noch wurden keinerlei Patientendaten verschlüsselt oder übertragen.')
    } catch (e) {
      setError(`Verschlüsselungstest: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleUnlockCryptoLab(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      const stored = readCryptoLabBundle()
      const key = await unlockPracticeKey(cryptoPassphrase, stored.passwordEnvelope)
      cryptoPracticeKeyRef.current = key
      setCryptoUnlocked(true)
      setCryptoPassphrase('')
      setSuccessMessage('Test-Praxisschlüssel entsperrt. Er liegt nur im Arbeitsspeicher dieser Sitzung.')
    } catch (e) {
      setError(`Entsperren fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleUnlockCryptoLabRecovery() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      const stored = readCryptoLabBundle()
      const key = await unlockPracticeKeyWithRecovery(
        cryptoRecoveryInput,
        stored.recoveryEnvelope,
      )
      cryptoPracticeKeyRef.current = key
      setCryptoUnlocked(true)
      setSuccessMessage('Test-Praxisschlüssel mit Wiederherstellungsschlüssel entsperrt.')
    } catch (e) {
      setError(`Wiederherstellung fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleCryptoRoundTrip() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const encrypted = await encryptPracticeText(
        cryptoTestText,
        cryptoPracticeKeyRef.current,
      )
      const decrypted = await decryptPracticeText(
        encrypted,
        cryptoPracticeKeyRef.current,
      )

      if (decrypted !== cryptoTestText) {
        throw new Error('Kontrolltest fehlgeschlagen: entschlüsselter Text stimmt nicht überein.')
      }

      const serialized = JSON.stringify(encrypted)
      setCryptoCipherPreview(
        serialized.length > 260 ? `${serialized.slice(0, 260)}…` : serialized,
      )
      setCryptoDecryptedText(decrypted)
      setSuccessMessage('AES-GCM-Test bestanden: Testtext wurde verschlüsselt und unverändert wieder entschlüsselt.')
    } catch (e) {
      setError(`Verschlüsselungstest fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleSaveCryptoLabPatientToSupabase() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Für diesen Test wird eine Internetverbindung benötigt.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const encrypted = await encryptPracticeText(
        JSON.stringify(V2_CRYPTO_LAB_PATIENT),
        cryptoPracticeKeyRef.current,
        V2_CRYPTO_LAB_PATIENT_CONTEXT,
      )

      const row = await saveEncryptedFantasyPatient(encrypted, cloudUser.id)
      const serverPayload = JSON.stringify(row.payload)
      const forbiddenPlaintext = [
        V2_CRYPTO_LAB_PATIENT.firstName,
        V2_CRYPTO_LAB_PATIENT.lastName,
        V2_CRYPTO_LAB_PATIENT.birthDate,
        V2_CRYPTO_LAB_PATIENT.note,
      ]

      if (forbiddenPlaintext.some(value => serverPayload.includes(value))) {
        throw new Error('Sicherheitsprüfung fehlgeschlagen: Klartext wurde im Server-Payload gefunden.')
      }

      setCryptoCloudCipherPreview(
        serverPayload.length > 320 ? `${serverPayload.slice(0, 320)}…` : serverPayload,
      )
      setCryptoCloudPatient(null)
      setCryptoCloudUpdatedAt(row.updated_at || '')
      setSuccessMessage(
        'Fantasiepatient wurde verschlüsselt gespeichert. Der von Supabase zurückgegebene Payload enthält keinen Namen, kein Geburtsdatum und keine Notiz im Klartext.',
      )
    } catch (e) {
      setError(`Supabase-Verschlüsselungstest fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleLoadCryptoLabPatientFromSupabase() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Für diesen Test wird eine Internetverbindung benötigt.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const row = await loadEncryptedFantasyPatient()
      if (!row) throw new Error('Noch kein verschlüsselter Fantasiepatient in Supabase gefunden.')

      const serverPayload = JSON.stringify(row.payload)
      const decryptedJson = await decryptPracticeText(
        row.payload,
        cryptoPracticeKeyRef.current,
        V2_CRYPTO_LAB_PATIENT_CONTEXT,
      )
      const patient = JSON.parse(decryptedJson)

      if (
        patient.firstName !== V2_CRYPTO_LAB_PATIENT.firstName ||
        patient.lastName !== V2_CRYPTO_LAB_PATIENT.lastName ||
        patient.birthDate !== V2_CRYPTO_LAB_PATIENT.birthDate ||
        patient.note !== V2_CRYPTO_LAB_PATIENT.note
      ) {
        throw new Error('Entschlüsselter Fantasiepatient stimmt nicht mit dem erwarteten Testdatensatz überein.')
      }

      setCryptoCloudCipherPreview(
        serverPayload.length > 320 ? `${serverPayload.slice(0, 320)}…` : serverPayload,
      )
      setCryptoCloudPatient(patient)
      setCryptoCloudUpdatedAt(row.updated_at || '')
      setSuccessMessage(
        'Fantasiepatient aus Supabase geladen und erst auf diesem Gerät wieder lesbar gemacht.',
      )
    } catch (e) {
      setError(`Laden/Entschlüsseln fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleSaveEncryptedMiniPractice() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Für diesen Test wird eine Internetverbindung benötigt.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const ids = await getEncryptedMiniPracticeIds(cloudUser.id)
      const patientContext = miniPatientContext(ids.patientId)
      const prescriptionContext = miniPrescriptionContext(ids.prescriptionId, ids.patientId)
      const docContext = miniDocEntryContext(ids.docEntryId, ids.prescriptionId)

      const [patientPayload, prescriptionPayload, docEntryPayload] = await Promise.all([
        encryptPracticeText(
          JSON.stringify(V2_CRYPTO_MINI_PATIENT),
          cryptoPracticeKeyRef.current,
          patientContext,
        ),
        encryptPracticeText(
          JSON.stringify(V2_CRYPTO_MINI_PRESCRIPTION),
          cryptoPracticeKeyRef.current,
          prescriptionContext,
        ),
        encryptPracticeText(
          JSON.stringify(V2_CRYPTO_MINI_DOC_ENTRY),
          cryptoPracticeKeyRef.current,
          docContext,
        ),
      ])

      const saved = await saveEncryptedMiniPractice(
        {
          ...ids,
          patientPayload,
          prescriptionPayload,
          docEntryPayload,
        },
        cloudUser.id,
      )

      const serverText = JSON.stringify([
        saved.patient.payload,
        saved.prescription.payload,
        saved.docEntry.payload,
      ])
      const forbiddenPlaintext = [
        ...Object.values(V2_CRYPTO_MINI_PATIENT),
        ...Object.values(V2_CRYPTO_MINI_PRESCRIPTION),
        ...Object.values(V2_CRYPTO_MINI_DOC_ENTRY),
      ].map(String)

      if (forbiddenPlaintext.some(value => serverText.includes(value))) {
        throw new Error('Sicherheitsprüfung fehlgeschlagen: Klartext wurde in einem Server-Payload gefunden.')
      }

      setCryptoMiniPractice(null)
      setCryptoMiniCipherSummary([
        {
          label: 'Patient',
          id: saved.patient.id,
          parent: '',
          chars: JSON.stringify(saved.patient.payload).length,
        },
        {
          label: 'Verordnung',
          id: saved.prescription.id,
          parent: saved.prescription.patient_id,
          chars: JSON.stringify(saved.prescription.payload).length,
        },
        {
          label: 'Doku',
          id: saved.docEntry.id,
          parent: saved.docEntry.prescription_id,
          chars: JSON.stringify(saved.docEntry.payload).length,
        },
      ])
      setSuccessMessage(
        'Mini-Praxis gespeichert: Patient, Verordnung und Doku liegen als drei getrennte verschlüsselte Datensätze in Supabase.',
      )
    } catch (e) {
      setError(`Mini-Praxis speichern fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleLoadEncryptedMiniPractice() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Für diesen Test wird eine Internetverbindung benötigt.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const rows = await loadEncryptedMiniPractice(cloudUser.id)
      if (!rows) throw new Error('Noch keine verschlüsselte Mini-Praxis gefunden.')

      if (rows.prescription.patient_id !== rows.patient.id) {
        throw new Error('Technische Verknüpfung Patient → Verordnung stimmt nicht.')
      }
      if (rows.docEntry.prescription_id !== rows.prescription.id) {
        throw new Error('Technische Verknüpfung Verordnung → Doku stimmt nicht.')
      }

      const [patientJson, prescriptionJson, docEntryJson] = await Promise.all([
        decryptPracticeText(
          rows.patient.payload,
          cryptoPracticeKeyRef.current,
          miniPatientContext(rows.patient.id),
        ),
        decryptPracticeText(
          rows.prescription.payload,
          cryptoPracticeKeyRef.current,
          miniPrescriptionContext(rows.prescription.id, rows.patient.id),
        ),
        decryptPracticeText(
          rows.docEntry.payload,
          cryptoPracticeKeyRef.current,
          miniDocEntryContext(rows.docEntry.id, rows.prescription.id),
        ),
      ])

      const miniPractice = {
        patient: JSON.parse(patientJson),
        prescription: JSON.parse(prescriptionJson),
        docEntry: JSON.parse(docEntryJson),
      }

      if (
        JSON.stringify(miniPractice.patient) !== JSON.stringify(V2_CRYPTO_MINI_PATIENT) ||
        JSON.stringify(miniPractice.prescription) !== JSON.stringify(V2_CRYPTO_MINI_PRESCRIPTION) ||
        miniPractice.docEntry?.entryDate !== V2_CRYPTO_MINI_DOC_ENTRY.entryDate ||
        !String(miniPractice.docEntry?.text || '').trim()
      ) {
        throw new Error('Entschlüsselte Mini-Praxis stimmt nicht mit der erwarteten Teststruktur überein.')
      }

      setCryptoMiniCipherSummary([
        {
          label: 'Patient',
          id: rows.patient.id,
          parent: '',
          chars: JSON.stringify(rows.patient.payload).length,
        },
        {
          label: 'Verordnung',
          id: rows.prescription.id,
          parent: rows.prescription.patient_id,
          chars: JSON.stringify(rows.prescription.payload).length,
        },
        {
          label: 'Doku',
          id: rows.docEntry.id,
          parent: rows.docEntry.prescription_id,
          chars: JSON.stringify(rows.docEntry.payload).length,
        },
      ])
      setCryptoMiniPractice(miniPractice)
      setSuccessMessage(
        'Mini-Praxis aus Supabase geladen: Drei Chiffretexte wurden erst auf diesem Gerät wieder zu Patient, Verordnung und Doku.',
      )
    } catch (e) {
      setError(`Mini-Praxis laden fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleSaveEncryptedLabPdf() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Für diesen Test wird eine Internetverbindung benötigt.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const miniRows = await loadEncryptedMiniPractice(cloudUser.id)
      if (!miniRows?.docEntry?.id) {
        throw new Error('Bitte zuerst die verschlüsselte Mini-Praxis speichern.')
      }

      const fileId = await getEncryptedLabFileId(cloudUser.id)
      const docEntryId = miniRows.docEntry.id
      const pdfBytes = createCryptoLabPdfBytes()
      const plainHash = await sha256Hex(pdfBytes)
      const metadata = {
        fileName: 'Testbefund_Erika_Probe.pdf',
        mimeType: 'application/pdf',
        originalSize: pdfBytes.byteLength,
        sha256: plainHash,
        title: 'Testbefund Erika Probe',
      }

      const [metadataEnvelope, storageEnvelope] = await Promise.all([
        encryptPracticeText(
          JSON.stringify(metadata),
          cryptoPracticeKeyRef.current,
          miniFileMetadataContext(fileId, docEntryId),
        ),
        encryptPracticeBytes(
          pdfBytes,
          cryptoPracticeKeyRef.current,
          miniFileBytesContext(fileId, docEntryId),
        ),
      ])

      const saved = await saveEncryptedLabFile(
        {
          id: fileId,
          docEntryId,
          metadata: metadataEnvelope,
          storageEnvelope,
        },
        cloudUser.id,
      )

      const returnedCiphertext = JSON.stringify({
        metadata: saved.metadata,
        storageEnvelope,
      })
      const forbidden = [
        'Erika',
        'Probe',
        'Schulter rechts',
        'Testbefund_Erika_Probe.pdf',
        'Testbefund Erika Probe',
      ]
      if (forbidden.some(value => returnedCiphertext.includes(value))) {
        throw new Error('Sicherheitsprüfung fehlgeschlagen: Klartext wurde im verschlüsselten Dateipaket gefunden.')
      }

      if (cryptoLabFileUrl) {
        URL.revokeObjectURL(cryptoLabFileUrl)
        setCryptoLabFileUrl('')
      }
      setCryptoLabFileResult(null)
      setCryptoLabFileCipherInfo({
        id: saved.id,
        storagePath: saved.storage_path,
        encryptedSize: saved.encrypted_size,
        metadataChars: JSON.stringify(saved.metadata).length,
        storageEnvelopeChars: JSON.stringify(storageEnvelope).length,
      })
      setSuccessMessage(
        'Test-PDF verschlüsselt gespeichert: Dateiname, Metadaten und PDF-Inhalt liegen nicht im Klartext bei Supabase.',
      )
    } catch (e) {
      setError(`PDF-Verschlüsselungstest fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleLoadEncryptedLabPdf() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Für diesen Test wird eine Internetverbindung benötigt.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const [fileBundle, miniRows] = await Promise.all([
        loadEncryptedLabFile(cloudUser.id),
        loadEncryptedMiniPractice(cloudUser.id),
      ])

      if (!fileBundle) throw new Error('Noch kein verschlüsseltes Test-PDF im Storage gefunden.')
      if (!miniRows?.docEntry?.id) throw new Error('Die zugehörige Test-Doku fehlt.')
      if (fileBundle.row.doc_entry_id !== miniRows.docEntry.id) {
        throw new Error('Technische Verknüpfung Doku → Datei stimmt nicht.')
      }

      const fileId = fileBundle.row.id
      const docEntryId = fileBundle.row.doc_entry_id
      const [metadataJson, pdfBytes] = await Promise.all([
        decryptPracticeText(
          fileBundle.row.metadata,
          cryptoPracticeKeyRef.current,
          miniFileMetadataContext(fileId, docEntryId),
        ),
        decryptPracticeBytes(
          fileBundle.storageEnvelope,
          cryptoPracticeKeyRef.current,
          miniFileBytesContext(fileId, docEntryId),
        ),
      ])

      const metadata = JSON.parse(metadataJson)
      const actualHash = await sha256Hex(pdfBytes)

      if (metadata.originalSize !== pdfBytes.byteLength) {
        throw new Error('Dateigröße stimmt nach dem Entschlüsseln nicht überein.')
      }
      if (metadata.sha256 !== actualHash) {
        throw new Error('Prüfsumme stimmt nicht: Datei wäre verändert oder beschädigt.')
      }

      const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 8))
      if (!pdfHeader.startsWith('%PDF-1.4')) {
        throw new Error('Die wiederhergestellte Datei ist kein erwartetes Test-PDF.')
      }

      if (cryptoLabFileUrl) URL.revokeObjectURL(cryptoLabFileUrl)
      const objectUrl = URL.createObjectURL(
        new Blob([pdfBytes], { type: metadata.mimeType }),
      )
      setCryptoLabFileUrl(objectUrl)
      setCryptoLabFileResult({
        ...metadata,
        actualHash,
      })
      setCryptoLabFileCipherInfo({
        id: fileBundle.row.id,
        storagePath: fileBundle.row.storage_path,
        encryptedSize: fileBundle.row.encrypted_size,
        metadataChars: JSON.stringify(fileBundle.row.metadata).length,
        storageEnvelopeChars: JSON.stringify(fileBundle.storageEnvelope).length,
      })
      setSuccessMessage(
        'Test-PDF aus dem privaten Storage geladen, lokal entschlüsselt und per SHA-256 bytegenau geprüft.',
      )
    } catch (e) {
      setError(`PDF laden/entschlüsseln fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function refreshCryptoOfflineAudit() {
    const audit = await inspectEncryptedOfflineLabRaw()
    setCryptoOfflineAudit(audit)
    return audit
  }

  async function decryptCryptoOfflineSnapshot(rows) {
    if (!rows) throw new Error('Noch keine verschlüsselte Offline-Kopie vorhanden.')
    if (!cryptoPracticeKeyRef.current) {
      throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
    }

    if (rows.prescription.parentId !== rows.patient.id) {
      throw new Error('Offline-Verknüpfung Patient → Verordnung stimmt nicht.')
    }
    if (rows.docEntry.parentId !== rows.prescription.id) {
      throw new Error('Offline-Verknüpfung Verordnung → Doku stimmt nicht.')
    }

    const [patientJson, prescriptionJson, docEntryJson] = await Promise.all([
      decryptPracticeText(
        rows.patient.payload,
        cryptoPracticeKeyRef.current,
        miniPatientContext(rows.patient.id),
      ),
      decryptPracticeText(
        rows.prescription.payload,
        cryptoPracticeKeyRef.current,
        miniPrescriptionContext(rows.prescription.id, rows.patient.id),
      ),
      decryptPracticeText(
        rows.docEntry.payload,
        cryptoPracticeKeyRef.current,
        miniDocEntryContext(rows.docEntry.id, rows.prescription.id),
      ),
    ])

    return {
      patient: JSON.parse(patientJson),
      prescription: JSON.parse(prescriptionJson),
      docEntry: JSON.parse(docEntryJson),
    }
  }

  async function handleSeedEncryptedOfflineCache() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) {
        throw new Error('Zum ersten Befüllen des Offline-Labors bitte kurz online sein.')
      }

      const rows = await loadEncryptedMiniPractice(cloudUser.id)
      if (!rows) throw new Error('Bitte zuerst die verschlüsselte Mini-Praxis speichern.')

      await clearEncryptedOfflineLab()
      await saveEncryptedOfflineSnapshot(rows)
      const audit = await refreshCryptoOfflineAudit()
      setCryptoOfflinePractice(null)

      if (!audit.safe) {
        throw new Error(`Klartextfund im rohen IndexedDB-Test: ${audit.leaks.join(', ')}`)
      }

      setSuccessMessage(
        'Verschlüsselte Mini-Praxis wurde in eine separate IndexedDB-Arbeitskopie übernommen. Rohdatenprüfung: kein Klartext gefunden.',
      )
    } catch (e) {
      setError(`Offline-Cache vorbereiten fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleLoadEncryptedOfflineCache() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      const rows = await loadEncryptedOfflineSnapshot()
      const practice = await decryptCryptoOfflineSnapshot(rows)
      const audit = await refreshCryptoOfflineAudit()

      if (!audit.safe) {
        throw new Error(`Klartextfund im rohen IndexedDB-Test: ${audit.leaks.join(', ')}`)
      }

      setCryptoOfflinePractice(practice)
      setSuccessMessage(
        'Offline-Kopie aus IndexedDB geladen und erst im Arbeitsspeicher wieder lesbar gemacht.',
      )
    } catch (e) {
      setError(`Offline lesen fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleQueueEncryptedOfflineEdit() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      const rows = await loadEncryptedOfflineSnapshot()
      if (!rows) throw new Error('Bitte zuerst die verschlüsselte Offline-Kopie anlegen.')
      if (!cryptoPracticeKeyRef.current) {
        throw new Error('Bitte den Test-Praxisschlüssel zuerst entsperren.')
      }

      const editedPayload = await encryptPracticeText(
        JSON.stringify(V2_CRYPTO_MINI_DOC_ENTRY_OFFLINE),
        cryptoPracticeKeyRef.current,
        miniDocEntryContext(rows.docEntry.id, rows.prescription.id),
      )

      await queueEncryptedOfflineDocEntry({
        id: rows.docEntry.id,
        prescriptionId: rows.prescription.id,
        payload: editedPayload,
      })

      const updatedRows = await loadEncryptedOfflineSnapshot()
      const practice = await decryptCryptoOfflineSnapshot(updatedRows)
      const audit = await refreshCryptoOfflineAudit()

      if (!audit.safe) {
        throw new Error(`Klartextfund im rohen IndexedDB-Test: ${audit.leaks.join(', ')}`)
      }

      setCryptoOfflinePractice(practice)
      setSuccessMessage(
        'Offline-Doku geändert. Im Cache und in der Outbox liegt weiterhin nur Chiffretext.',
      )
    } catch (e) {
      setError(`Offline-Änderung fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  async function handleSyncEncryptedOfflineOutbox() {
    setError('')
    setSuccessMessage('')
    setCryptoBusy(true)

    try {
      if (!cloudUser) throw new Error('Bitte zuerst bei Supabase anmelden.')
      if (!navigator.onLine) throw new Error('Zum Synchronisieren bitte wieder online gehen.')

      const items = await getEncryptedOfflineOutbox()
      if (items.length === 0) throw new Error('Die verschlüsselte Test-Outbox ist leer.')

      let synced = 0
      for (const item of items) {
        if (item.kind !== 'docEntry') {
          throw new Error(`Unbekannter Test-Outbox-Typ: ${item.kind}`)
        }

        await saveEncryptedMiniDocEntryPayload(
          {
            id: item.entityId,
            prescriptionId: item.parentId,
            payload: item.payload,
          },
          cloudUser.id,
        )
        await removeEncryptedOfflineOutboxItem(item.id)
        synced += 1
      }

      const audit = await refreshCryptoOfflineAudit()
      if (!audit.safe) {
        throw new Error(`Klartextfund im rohen IndexedDB-Test: ${audit.leaks.join(', ')}`)
      }

      setSuccessMessage(
        `${synced} verschlüsselte Offline-Änderung wurde nach Supabase übertragen – ohne die Outbox vorher in Klartext umzuwandeln.`,
      )
    } catch (e) {
      setError(`Verschlüsselte Outbox synchronisieren fehlgeschlagen: ${e.message}`)
    } finally {
      setCryptoBusy(false)
    }
  }

  function handleLockCryptoLab() {
    cryptoPracticeKeyRef.current = null
    setCryptoUnlocked(false)
    setCryptoCipherPreview('')
    setCryptoDecryptedText('')
    setCryptoCloudPatient(null)
    setCryptoMiniPractice(null)
    setCryptoLabFileResult(null)
    setCryptoOfflinePractice(null)
    if (cryptoLabFileUrl) URL.revokeObjectURL(cryptoLabFileUrl)
    setCryptoLabFileUrl('')
    setSuccessMessage('Test-Praxisschlüssel aus dem Arbeitsspeicher entfernt.')
  }

  async function handleResetCryptoLab() {
    if (!window.confirm('Nur den lokalen Verschlüsselungstest zurücksetzen? Es sind keine Patientendaten daran gebunden.')) return

    window.localStorage.removeItem(V2_CRYPTO_LAB_STORAGE_KEY)
    await clearEncryptedOfflineLab()
    cryptoPracticeKeyRef.current = null
    setCryptoLabConfigured(false)
    setCryptoUnlocked(false)
    setCryptoPassphrase('')
    setCryptoPassphraseConfirm('')
    setCryptoRecoveryCode('')
    setCryptoRecoveryInput('')
    setCryptoCipherPreview('')
    setCryptoDecryptedText('')
    setCryptoCloudCipherPreview('')
    setCryptoCloudPatient(null)
    setCryptoCloudUpdatedAt('')
    setCryptoMiniCipherSummary([])
    setCryptoMiniPractice(null)
    setCryptoLabFileCipherInfo(null)
    setCryptoLabFileResult(null)
    setCryptoOfflineAudit(null)
    setCryptoOfflinePractice(null)
    if (cryptoLabFileUrl) URL.revokeObjectURL(cryptoLabFileUrl)
    setCryptoLabFileUrl('')
    setError('')
    setSuccessMessage('Lokaler Verschlüsselungstest wurde zurückgesetzt.')
  }

  async function refreshV3BridgeStatus() {
    if (!cloudUser) return
    const [keyring, counts] = await Promise.all([
      loadV3Keyring(cloudUser.id),
      getV3EncryptedCounts(cloudUser.id),
    ])
    setV3Keyring(keyring)
    setV3Counts(counts)
  }

  async function handleCreateV3PracticeKey(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!cloudUser) {
      setError('Bitte zuerst bei Supabase anmelden.')
      return
    }
    if (v3Keyring) {
      setError('Der echte V3-Praxisschlüssel ist bereits eingerichtet.')
      return
    }
    if (v3Passphrase !== v3PassphraseConfirm) {
      setError('Die beiden Verschlüsselungs-Passphrasen stimmen nicht überein.')
      return
    }

    setV3KeyBusy(true)
    try {
      const bundle = await createProductionPracticeKeyBundle(v3Passphrase)
      v3CandidateBundleRef.current = bundle
      setV3RecoveryCode(bundle.recoveryCode)
      setV3RecoveryDownloaded(false)
      setV3Unlocked(false)
      setSuccessMessage(
        'Echter Praxisschlüssel lokal erzeugt. Noch wurde er nicht aktiviert und noch wurden keine Patientendaten verschlüsselt.',
      )
    } catch (e) {
      setError(`Praxisschlüssel konnte nicht erzeugt werden: ${e.message}`)
    } finally {
      setV3KeyBusy(false)
    }
  }

  function handleDownloadV3RecoveryKey() {
    const code = v3RecoveryCode
    if (!code) {
      setError('Es gibt noch keinen Wiederherstellungsschlüssel zum Speichern.')
      return
    }

    const text = [
      'PhysioOptima – Wiederherstellungsschlüssel V3',
      '',
      'Diesen Schlüssel sicher und getrennt vom Praxisgerät aufbewahren.',
      'Er ersetzt NICHT die tägliche Verschlüsselungs-Passphrase.',
      'Wer diesen Schlüssel besitzt, kann zusammen mit der verschlüsselten Schlüsselhülle die Praxisdaten entschlüsseln.',
      '',
      `Erstellt: ${new Date().toLocaleString('de-DE')}`,
      '',
      code,
      '',
    ].join('\n')

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `PhysioOptima_Wiederherstellungsschluessel_V3_${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setV3RecoveryDownloaded(true)
    setSuccessMessage('Wiederherstellungsschlüssel wurde als Datei bereitgestellt. Bitte sicher aufbewahren.')
  }

  async function handleActivateV3PracticeKey() {
    setError('')
    setSuccessMessage('')

    if (!cloudUser) {
      setError('Bitte zuerst bei Supabase anmelden.')
      return
    }
    if (!v3RecoveryDownloaded) {
      setError('Bitte zuerst den Wiederherstellungsschlüssel als Datei speichern.')
      return
    }

    const bundle = v3CandidateBundleRef.current
    if (!bundle) {
      setError('Der lokal erzeugte Praxisschlüssel ist nicht mehr im Arbeitsspeicher. Bitte neu erzeugen.')
      return
    }

    setV3KeyBusy(true)
    try {
      const saved = await createV3Keyring({
        userId: cloudUser.id,
        passwordEnvelope: bundle.passwordEnvelope,
        recoveryEnvelope: bundle.recoveryEnvelope,
      })

      setV3Keyring(saved)
      v3PracticeKeyRef.current = bundle.practiceKey
      setV3Unlocked(true)
      v3CandidateBundleRef.current = null
      setV3Passphrase('')
      setV3PassphraseConfirm('')
      await refreshV3BridgeStatus()
      setSuccessMessage(
        'V3-Praxisschlüssel aktiviert. Supabase speichert nur die beiden verschlüsselten Schlüsselhüllen – nicht Passphrase und nicht Wiederherstellungscode.',
      )
    } catch (e) {
      setError(`Praxisschlüssel konnte nicht aktiviert werden: ${e.message}`)
    } finally {
      setV3KeyBusy(false)
    }
  }

  async function handleUnlockV3PracticeKey(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')
    if (!v3Keyring) {
      setError('Es ist noch kein V3-Praxisschlüssel eingerichtet.')
      return
    }

    setV3KeyBusy(true)
    try {
      const key = await unlockPracticeKey(v3Passphrase, v3Keyring.password_envelope)
      v3PracticeKeyRef.current = key
      setV3Unlocked(true)
      setV3Passphrase('')
      await refreshV3MirrorOutboxCount()
      if (navigator.onLine) {
        await flushV3MirrorOutbox()
      }
      setSuccessMessage('Echter V3-Praxisschlüssel entsperrt. Er liegt nur im Arbeitsspeicher dieser geöffneten PWA.')
    } catch (e) {
      setError(e.message)
    } finally {
      setV3KeyBusy(false)
    }
  }

  async function handleUnlockV3WithRecovery() {
    setError('')
    setSuccessMessage('')
    if (!v3Keyring) {
      setError('Es ist noch kein V3-Praxisschlüssel eingerichtet.')
      return
    }

    setV3KeyBusy(true)
    try {
      const key = await unlockPracticeKeyWithRecovery(
        v3RecoveryInput,
        v3Keyring.recovery_envelope,
      )
      v3PracticeKeyRef.current = key
      setV3Unlocked(true)
      setV3RecoveryInput('')
      await refreshV3MirrorOutboxCount()
      if (navigator.onLine) {
        await flushV3MirrorOutbox()
      }
      setSuccessMessage('V3-Praxisschlüssel mit Wiederherstellungsschlüssel entsperrt.')
    } catch (e) {
      setError(e.message)
    } finally {
      setV3KeyBusy(false)
    }
  }

  async function handleOpenEncryptedPractice(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!v3Keyring) {
      setError('Für dieses Konto ist noch kein V3-Praxisschlüssel eingerichtet.')
      return
    }
    if (!v3Passphrase) {
      setError('Bitte das Verschlüsselungspasswort eingeben.')
      return
    }

    setV3KeyBusy(true)
    try {
      const key = await unlockPracticeKey(v3Passphrase, v3Keyring.password_envelope)
      v3PracticeKeyRef.current = key
      v3PrimaryModeRef.current = true
      setV3Unlocked(true)
      setV3PrimaryMode(true)
      setV3Passphrase('')
      setSelectedPatient(null)
      setSelectedPrescription(null)
      setPrescriptions([])
      setPatientDocuments([])
      setDocEntries([])
      setDocEntryImageCounts({})
      setDocImages([])
      setLibraryItems([])
      setNav('patients')
      setView('list')
      await loadListData()
      setSuccessMessage('🔓 Verschlüsselte Praxis geöffnet.')
    } catch (e) {
      setError(e.message)
    } finally {
      setV3KeyBusy(false)
    }
  }

  async function handleOpenEncryptedPracticeWithRecovery(event) {
    event.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!v3Keyring) {
      setError('Für dieses Konto ist noch kein V3-Praxisschlüssel eingerichtet.')
      return
    }

    setV3KeyBusy(true)
    try {
      const key = await unlockPracticeKeyWithRecovery(
        v3RecoveryInput,
        v3Keyring.recovery_envelope,
      )
      v3PracticeKeyRef.current = key
      v3PrimaryModeRef.current = true
      setV3Unlocked(true)
      setV3PrimaryMode(true)
      setV3RecoveryInput('')
      setSelectedPatient(null)
      setSelectedPrescription(null)
      setPrescriptions([])
      setPatientDocuments([])
      setDocEntries([])
      setDocEntryImageCounts({})
      setDocImages([])
      setLibraryItems([])
      setNav('patients')
      setView('list')
      await loadListData()
      setSuccessMessage('🔓 Verschlüsselte Praxis mit Wiederherstellungsschlüssel geöffnet.')
    } catch (e) {
      setError(e.message)
    } finally {
      setV3KeyBusy(false)
    }
  }

  function handleLockV3PracticeKey() {
    if (v3ReadModeRef.current) {
      setError('Bitte zuerst den V3-Lesemodus beenden, bevor du den Praxisschlüssel sperrst.')
      return
    }
    if (v3MirrorModeRef.current) {
      setError('Bitte zuerst den V3-Schreibspiegel beenden, bevor du den Praxisschlüssel sperrst.')
      return
    }
    if (v3PrimaryModeRef.current) {
      setError('Bitte zuerst die V3-Hauptbetrieb-Testfahrt beenden, bevor du den Praxisschlüssel sperrst.')
      return
    }

    v3PracticeKeyRef.current = null
    setV3Unlocked(false)
    setV3BridgeVerification(null)
    setSuccessMessage('V3-Praxisschlüssel aus dem Arbeitsspeicher entfernt.')
  }

  function ensureV3MirrorWriteReady({ allowOffline = false } = {}) {
    if (!v3MirrorModeRef.current) return
    if (!v3PracticeKeyRef.current) {
      throw new Error('V3-Schreibspiegel ist aktiv, aber der Praxisschlüssel ist nicht entsperrt.')
    }
    if (!allowOffline && !navigator.onLine) {
      throw new Error(
        'Diese Aktion braucht im V3-Schreibspiegel weiterhin Internet. Offline unterstützt sind Patient, Verordnung und Doku-Text.',
      )
    }
  }

  async function runV3Mirror(label, action) {
    if (!v3MirrorModeRef.current) return true

    try {
      await action()
      const message = `🪞 ${label}: alte Speicherung + verschlüsselter V3-Spiegel geprüft.`
      setV3MirrorLastMessage(message)
      return true
    } catch (e) {
      setV3MirrorLastMessage(`⚠️ ${label}: V3-Spiegel unvollständig.`)
      setError(
        `${label} wurde in der bisherigen Praxis gespeichert, aber der V3-Spiegel ist fehlgeschlagen: ${e.message}`,
      )
      return false
    }
  }

  async function handleStartV3MirrorMode() {
    setError('')
    setSuccessMessage('')

    if (!v3PracticeKeyRef.current || !v3Unlocked) {
      setError('Bitte zuerst den V3-Praxisschlüssel entsperren.')
      return
    }
    if (v3ReadModeRef.current || v3PrimaryModeRef.current) {
      setError('Bitte zuerst den V3-Lesemodus beenden.')
      return
    }
    if (!navigator.onLine) {
      setError('Bitte den Schreibspiegel online starten. Danach darfst du für Patient, Verordnung und Doku-Text offline gehen.')
      return
    }

    v3MirrorModeRef.current = true
    setV3MirrorMode(true)
    setV3MirrorLastMessage('Schreibspiegel bereit – noch wurde nichts verändert.')
    setNav('patients')
    setView('list')
    await refreshV3MirrorOutboxCount()
    await flushOutbox()
    await flushV3MirrorOutbox()
    setSuccessMessage(
      '🪞 V3-Schreibspiegel aktiv. Online wird sofort gespiegelt; offline werden Patient, Verordnung und Doku-Text zusätzlich verschlüsselt in der V3-Outbox vorgemerkt.',
    )
  }

  function handleStopV3MirrorMode() {
    v3MirrorModeRef.current = false
    setV3MirrorMode(false)
    setV3MirrorLastMessage('')
    setSuccessMessage('V3-Schreibspiegel beendet.')
  }

  async function handleStartV3PrimaryMode() {
    setError('')
    setSuccessMessage('')

    if (!v3PracticeKeyRef.current || !v3Unlocked) {
      setError('Bitte zuerst den V3-Praxisschlüssel entsperren.')
      return
    }
    if (v3ReadModeRef.current || v3MirrorModeRef.current) {
      setError('Bitte zuerst V3-Lesemodus bzw. Schreibspiegel beenden.')
      return
    }
    if (!navigator.onLine) {
      setError('Die erste V3-Hauptbetrieb-Testfahrt startet absichtlich nur online.')
      return
    }
    if (outboxCount > 0 || v3MirrorOutboxCount > 0) {
      setError(
        `Bitte zuerst alle wartenden Offline-Änderungen synchronisieren (alt: ${outboxCount}, V3-Spiegel: ${v3MirrorOutboxCount}).`,
      )
      return
    }

    const confirmed = window.confirm(
      'V3-Hauptbetrieb – Testfahrt starten?\n\n' +
      'Ab jetzt liest UND schreibt diese Test-PWA direkt in die verschlüsselten V3-Tabellen. ' +
      'Die alten Klartexttabellen bleiben als eingefrorenes Sicherheitsnetz bestehen und werden NICHT mehr mit aktualisiert.\n\n' +
      'Wichtig: Die normale Produktions-PWA darf während dieser Testfahrt nicht parallel für echte Änderungen benutzt werden.'
    )
    if (!confirmed) return

    v3PrimaryModeRef.current = true
    setV3PrimaryMode(true)
    setSelectedPatient(null)
    setSelectedPrescription(null)
    setPrescriptions([])
    setPatientDocuments([])
    setDocEntries([])
    setDocEntryImageCounts({})
    setDocImages([])
    setLibraryItems([])
    setNav('patients')
    setView('list')

    await loadListData()
    setSuccessMessage(
      '🚗 V3-Hauptbetrieb – Testfahrt aktiv. Lesen und Schreiben gehen direkt über verschlüsseltes V3; alte Klartexttabellen bleiben unverändert.',
    )
  }

  async function handleStopV3PrimaryMode() {
    const confirmed = window.confirm(
      'V3-Hauptbetrieb-Testfahrt beenden?\n\n' +
      'Falls du während der Testfahrt etwas gespeichert hast, können die alten Klartexttabellen absichtlich älter sein als V3.'
    )
    if (!confirmed) return

    v3PrimaryModeRef.current = false
    setV3PrimaryMode(false)
    setSelectedPatient(null)
    setSelectedPrescription(null)
    setPrescriptions([])
    setPatientDocuments([])
    setDocEntries([])
    setDocEntryImageCounts({})
    setDocImages([])
    setLibraryItems([])
    setNav('patients')
    setView('list')
    await loadListData(true)
    setSuccessMessage(
      'V3-Hauptbetrieb-Testfahrt beendet. Achtung: Die alte Ansicht ist nur noch der eingefrorene Sicherheitsstand und kann von V3 abweichen.',
    )
  }

  async function handleEnterV3ReadMode() {
    setError('')
    setSuccessMessage('')

    if (v3MirrorModeRef.current) {
      setError('Bitte zuerst den V3-Schreibspiegel beenden.')
      return
    }

    if (!v3PracticeKeyRef.current || !v3Unlocked) {
      setError('Bitte zuerst den V3-Praxisschlüssel entsperren.')
      return
    }
    if (!v3Counts?.patients) {
      setError('Der verschlüsselte V3-Parallelbestand ist noch leer.')
      return
    }
    if (outboxCount > 0 || v3MirrorOutboxCount > 0) {
      setError(
        `Bitte zuerst die wartenden Offline-Änderungen synchronisieren (alt: ${outboxCount}, V3-Spiegel: ${v3MirrorOutboxCount}).`,
      )
      return
    }

    v3ReadModeRef.current = true
    setV3ReadMode(true)
    setSelectedPatient(null)
    setSelectedPrescription(null)
    setPrescriptions([])
    setPatientDocuments([])
    setDocEntries([])
    setDocEntryImageCounts({})
    setDocImages([])
    setLibraryItems([])
    setNav('patients')
    setView('list')

    await loadListData()
  }

  async function handleExitV3ReadMode() {
    v3ReadModeRef.current = false
    setV3ReadMode(false)
    setSelectedPatient(null)
    setSelectedPrescription(null)
    setPrescriptions([])
    setPatientDocuments([])
    setDocEntries([])
    setDocEntryImageCounts({})
    setDocImages([])
    setLibraryItems([])
    setNav('patients')
    setView('list')
    setSuccessMessage('V3-Lesemodus beendet. Die bisherige Praxisansicht ist wieder aktiv.')
    await loadListData(true)
  }

  async function handleBuildV3ParallelBridge() {
    setError('')
    setSuccessMessage('')
    setV3BridgeVerification(null)

    if (!cloudUser) {
      setError('Bitte zuerst bei Supabase anmelden.')
      return
    }
    if (!v3PracticeKeyRef.current || !v3Unlocked) {
      setError('Bitte zuerst den V3-Praxisschlüssel entsperren.')
      return
    }
    if (!navigator.onLine) {
      setError('Für den Brückenbau wird eine Internetverbindung benötigt.')
      return
    }

    const confirmed = window.confirm(
      'V3-Parallelbestand jetzt aufbauen?\n\n' +
      'Die bisherigen Praxistabellen und Dateien bleiben vollständig bestehen. ' +
      'Es werden ausschließlich zusätzliche verschlüsselte V3-Kopien erzeugt bzw. aktualisiert.\n\n' +
      'Anschließend wird der komplette V3-Bestand wieder entschlüsselt und geprüft.'
    )
    if (!confirmed) return

    setV3BridgeBusy(true)

    try {
      setV3BridgeProgress('Brückenbau startet …')
      const buildResult = await buildV3EncryptedParallelCopy({
        userId: cloudUser.id,
        practiceKey: v3PracticeKeyRef.current,
        onProgress: setV3BridgeProgress,
      })

      await refreshV3BridgeStatus()

      setV3BridgeProgress('V3 geschrieben. Vollständige Gegenprüfung startet …')
      const verification = await verifyV3EncryptedParallelCopy({
        userId: cloudUser.id,
        practiceKey: v3PracticeKeyRef.current,
        onProgress: setV3BridgeProgress,
      })

      setV3BridgeVerification({
        ...verification,
        sourceCounts: buildResult.sourceCounts,
      })
      await refreshV3BridgeStatus()
      setSuccessMessage(
        'V3-Brückenbelag vollständig geprüft: Alle alten Praxisdaten bleiben bestehen; die parallelen V3-Daten lassen sich vollständig entschlüsseln.',
      )
    } catch (e) {
      setError(
        `V3-Brückenbau angehalten: ${e.message} Die alten Praxisdaten wurden nicht verändert. Der Vorgang kann erneut gestartet werden.`,
      )
    } finally {
      setV3BridgeBusy(false)
    }
  }

  function formatByteCount(bytes) {
    const value = Number(bytes || 0)
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleCreateEncryptedCloudBackup() {
    setError('')
    setSuccessMessage('')
    setCloudBackupProgress('')
    setCloudBackupSummary(null)
    setCloudBackupVerification(null)

    if (!cloudUser) {
      setError('Bitte zuerst bei Supabase anmelden.')
      return
    }
    if (cloudBackupPassphrase !== cloudBackupPassphraseConfirm) {
      setError('Die beiden Backup-Passwörter stimmen nicht überein.')
      return
    }
    if (cloudBackupPassphrase.length < 16) {
      setError('Das Backup-Passwort muss mindestens 16 Zeichen lang sein.')
      return
    }

    setCloudBackupBusy(true)

    try {
      const result = await createEncryptedSupabaseBackup(
        cloudUser.id,
        cloudBackupPassphrase,
        setCloudBackupProgress,
      )

      const url = URL.createObjectURL(result.zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)

      setCloudBackupSummary(result.summary)
      setCloudBackupPassphraseConfirm('')
      setSuccessMessage(
        'Verschlüsseltes Supabase-Vollbackup erstellt. Bitte die heruntergeladene ZIP jetzt direkt mit dem Wiederherstellungstest prüfen.',
      )
    } catch (e) {
      setError(`Verschlüsseltes Cloud-Backup fehlgeschlagen: ${e.message}`)
    } finally {
      setCloudBackupBusy(false)
    }
  }

  async function handleVerifyEncryptedCloudBackup(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setSuccessMessage('')
    setCloudBackupVerification(null)
    setCloudBackupVerificationFile(file.name)

    if (!cloudBackupPassphrase) {
      setError('Bitte das Backup-Passwort eingeben, mit dem diese ZIP erstellt wurde.')
      return
    }

    setCloudBackupBusy(true)

    try {
      const result = await verifyEncryptedSupabaseBackup(
        file,
        cloudBackupPassphrase,
        setCloudBackupProgress,
      )

      setCloudBackupVerification(result)
      setSuccessMessage(
        'Wiederherstellungstest bestanden: Datenstruktur, Beziehungen und jede gesicherte Datei wurden lokal entschlüsselt und geprüft. Es wurde nichts nach Supabase zurückgeschrieben.',
      )
    } catch (e) {
      setError(`Wiederherstellungstest fehlgeschlagen: ${e.message}`)
    } finally {
      setCloudBackupBusy(false)
    }
  }

  async function handleSelectMigrationZip(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError('')
    setSuccessMessage('')
    setMigrationProgress('')
    migrationBackupRef.current = null

    try {
      const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip'
      const text = isZip ? await readBackupJsonFromZip(file) : await file.text()
      const backup = JSON.parse(text)
      const inspection = inspectLegacyBackup(backup)

      migrationBackupRef.current = inspection.valid ? backup : null
      setMigrationPreview({
        fileName: file.name,
        valid: inspection.valid,
        counts: inspection.counts,
        blockingIssues: inspection.blockingIssues,
        exportedAt: inspection.exportedAt,
        version: inspection.version,
      })

      if (inspection.valid) {
        setSuccessMessage('Migrations-ZIP geprüft. Noch wurde nichts nach Supabase übertragen.')
      } else {
        setError('Diese ZIP kann noch nicht migriert werden. Bitte die angezeigten Prüfpunkte beachten.')
      }
    } catch (e) {
      setMigrationPreview(null)
      setError(`Migrations-ZIP konnte nicht geprüft werden: ${e.message}`)
    }
  }

  async function handleRunMigration() {
    if (!migrationPreview?.valid || !migrationBackupRef.current) {
      setError('Bitte zuerst ein gültiges Voll-ZIP auswählen und prüfen.')
      return
    }
    if (!cloudUser) {
      setError('Bitte zuerst anmelden.')
      return
    }
    if (!navigator.onLine) {
      setError('Die Migration braucht eine Internetverbindung.')
      return
    }
    if (outboxCount > 0) {
      setError(`Vor der Migration bitte erst die ${outboxCount} wartenden Offline-Änderungen synchronisieren.`)
      return
    }
    if (autoSyncPassword) {
      setError('Bitte die alte automatische Cloud-Synchronisation vor der Migration beenden.')
      return
    }

    const counts = migrationPreview.counts
    const confirmed = window.confirm(
      `Migration starten?\n\n` +
      `${counts.patients} Patienten\n` +
      `${counts.prescriptions} Verordnungen\n` +
      `${counts.documentationEntries} Doku-Einträge\n` +
      `${counts.images} Doku-Bilder\n` +
      `${counts.patientDocuments} Befunde/Dokumente\n` +
      `${counts.libraryItems} Bibliotheksdateien\n\n` +
      'Vorhandene gleiche IDs werden aktualisiert, nicht dupliziert.'
    )
    if (!confirmed) return

    setMigrationBusy(true)
    setError('')
    setSuccessMessage('')
    setMigrationProgress('Migration startet …')

    try {
      const result = await migrateLegacyBackupToSupabase(
        migrationBackupRef.current,
        cloudUser.id,
        setMigrationProgress,
      )

      await loadListData()
      setMigrationProgress('Migration vollständig geprüft.')
      setSuccessMessage(
        `Migration abgeschlossen: ${result.total} Einträge wurden geprüft und nach Supabase übernommen.`
      )
    } catch (e) {
      setError(
        `Migration angehalten: ${e.message} Die gleiche ZIP kann nach der Korrektur erneut gestartet werden.`
      )
    } finally {
      setMigrationBusy(false)
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
      const importedMaxModifiedAt = getBackupMaxModifiedAt(parsed)
      if (importedMaxModifiedAt) markDataChanged(importedMaxModifiedAt)
      setSuccessMessage('Backup erfolgreich importiert. Lokale Daten wurden ersetzt.')
    } catch (e) {
      setError(`Import fehlgeschlagen: ${e.message}`)
    }
  }

  async function handleSavePatient(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccessMessage('')
    patientSaveBusyRef.current = true

    try {
      if (!patientForm.lastName.trim() || !patientForm.firstName.trim() || !patientForm.birthDate) {
        throw new Error('Bitte Name, Vorname und Geburtsdatum ausfüllen.')
      }
      if (!cloudUser) throw new Error('Bitte erneut anmelden.')
      if (patientConflict) throw new Error('Dieser Patient wurde auf einem anderen Gerät geändert. Bitte zuerst den aktuellen Stand laden.')

      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('Die V3-Hauptbetrieb-Testfahrt speichert in dieser Stufe nur online.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const isNewV3 = !selectedPatient && !patientForm.id
        const idV3 = selectedPatient?.id || patientForm.id || crypto.randomUUID()
        const modeV3 = isNewV3 ? 'insert' : 'update'
        const expectedV3 = selectedPatient?.updatedAt || ''
        const candidateV3 = {
          ...patientForm,
          id: idV3,
          lastName: patientForm.lastName.trim(),
          firstName: patientForm.firstName.trim(),
        }

        const { patient: savedV3, conflict: conflictV3 } = await saveV3Patient(
          candidateV3,
          cloudUser.id,
          v3PracticeKeyRef.current,
          expectedV3,
          modeV3,
        )

        if (conflictV3) {
          setPatientConflict(conflictV3)
          setError('V3-Konflikt: Dieser Patient wurde inzwischen auf einem anderen Gerät geändert.')
          return
        }

        await cachePatient(savedV3)
        await refreshV3BridgeStatus()
        setPatientConflict(null)

        if (selectedPatient) {
          await loadPatientDetail(savedV3.id)
        } else {
          setSelectedPatient(null)
          setPatientForm(EMPTY_PATIENT_FORM)
          setView('list')
          await loadListData()
        }

        setSuccessMessage('🚗 V3-Hauptbetrieb: Patient direkt verschlüsselt in V3 gespeichert. Alte Klartexttabelle unverändert.')
        return
      }

      ensureV3MirrorWriteReady({ allowOffline: true })

      const isNew = !selectedPatient && !patientForm.id
      const id = selectedPatient?.id || patientForm.id || crypto.randomUUID()
      const mode = isNew ? 'insert' : 'update'
      const expectedUpdatedAt = selectedPatient?.updatedAt || ''
      const candidate = {
        ...patientForm,
        id,
        lastName: patientForm.lastName.trim(),
        firstName: patientForm.firstName.trim(),
      }

      const saveOffline = async () => {
        const localSaved = localPendingRecord({
          ...candidate,
          createdAt: selectedPatient?.createdAt || patientForm.createdAt || '',
          deletedAt: selectedPatient?.deletedAt || '',
        })

        await cachePatient(localSaved)
        await enqueueOutbox({
          id: `patient:${id}`,
          kind: 'patient',
          entityId: id,
          mode,
          payload: localSaved,
          expectedUpdatedAt,
          userId: cloudUser.id,
        })
        await queueEncryptedV3MirrorOffline('patient', localSaved, '')
        await refreshOutboxCount()

        setPatients(current => {
          const exists = current.some(item => item.id === localSaved.id)
          const next = exists
            ? current.map(item => item.id === localSaved.id ? localSaved : item)
            : [...current, localSaved]
          return next.sort((a, b) =>
            a.lastName.localeCompare(b.lastName, 'de') ||
            a.firstName.localeCompare(b.firstName, 'de')
          )
        })

        setPatientConflict(null)
        setError('')
        setSuccessMessage(v3MirrorModeRef.current ? 'Offline gespeichert – Patient wartet in alter Outbox + verschlüsselter V3-Spiegel-Outbox.' : 'Offline gespeichert – Patient wartet auf Synchronisierung.')

        if (selectedPatient) {
          setSelectedPatient(localSaved)
          setPatientForm(localSaved)
          setView('patientDetail')
        } else {
          setSelectedPatient(null)
          setPatientForm(EMPTY_PATIENT_FORM)
          setView('list')
        }
      }

      if (!navigator.onLine) {
        await saveOffline()
        return
      }

      let result
      try {
        result = await savePatientToSupabase(
          candidate,
          cloudUser.id,
          expectedUpdatedAt,
          mode,
        )
      } catch (e) {
        if (isConnectivityError(e)) {
          await saveOffline()
          return
        }
        throw e
      }

      const { patient: saved, conflict } = result
      if (conflict) {
        setPatientConflict(conflict)
        setError('Dieser Patient wurde inzwischen auf einem anderen Gerät geändert. Deine Eingaben bleiben erhalten.')
        return
      }

      await cachePatient(saved)

      setPatients(current => {
        const exists = current.some(item => item.id === saved.id)
        const next = exists
          ? current.map(item => item.id === saved.id ? saved : item)
          : [...current, saved]
        return next.sort((a, b) =>
          a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de')
        )
      })
      setPatientConflict(null)

      if (selectedPatient) await loadPatientDetail(saved.id)
      else {
        setSelectedPatient(null)
        setPatientForm(EMPTY_PATIENT_FORM)
        setView('list')
      }

      const mirrorOk = await runV3Mirror(
        'Patient',
        () => mirrorV3PatientById(saved.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? 'Patient gespeichert – 🪞 verschlüsselter V3-Spiegel geprüft.'
              : 'Patient gespeichert. Der V3-Spiegel braucht eine erneute Spiegelung.')
          : 'Patient gespeichert und synchronisiert.',
      )
    } catch (e) {
      setError(e.message)
    } finally {
      patientSaveBusyRef.current = false
      setSaving(false)
    }
  }

  function handleLoadPatientConflict() {
    if (!patientConflict) return
    setSelectedPatient(patientConflict)
    setPatientForm(patientConflict)
    setPatientConflict(null)
    setError('')
    setSuccessMessage('Aktueller Stand wurde geladen.')
  }

  async function handleMovePatientToTrash() {
    if (!selectedPatient || !canManageTrash) {
      setError('Der Papierkorb ist nur für die angemeldete Praxisleitung verfügbar.')
      return
    }

    const expectedName = patientLabel(selectedPatient)
    const confirmation = window.prompt(
      `Patient in den Papierkorb verschieben?\n\nVerordnungen, Dokumentationen, Bilder und Befunde bleiben erhalten.\n\nZur Bestätigung bitte genau eingeben:\n${expectedName}`,
    )

    if (confirmation === null) return

    if (confirmation.trim() !== expectedName) {
      setError('Name stimmt nicht überein. Der Patient wurde nicht verschoben.')
      return
    }

    setSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('Der V3-Papierkorb braucht in dieser Stufe Internet.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const { conflict } = await softDeleteV3Patient(
          selectedPatient.id,
          selectedPatient.updatedAt || '',
          v3PracticeKeyRef.current,
        )
        if (conflict) {
          setPatientConflict(conflict)
          throw new Error('V3-Konflikt: Der Patient wurde inzwischen auf einem anderen Gerät geändert.')
        }

        await loadListData()
        setSelectedPatient(null)
        setSelectedPrescription(null)
        setPrescriptions([])
        setPatientDocuments([])
        setDocEntries([])
        setDocEntryImageCounts({})
        setNav('patients')
        setView('list')
        setSuccessMessage(`${expectedName} wurde im verschlüsselten V3-Bestand in den Papierkorb verschoben.`)
        return
      }

      ensureV3MirrorWriteReady()
      const { conflict } = await softDeletePatientInSupabase(selectedPatient.id, selectedPatient.updatedAt || '')
      if (conflict) {
        setPatientConflict(conflict)
        throw new Error('Der Patient wurde inzwischen auf einem anderen Gerät geändert. Bitte neu öffnen und erneut versuchen.')
      }
      await loadListData()
      setSelectedPatient(null)
      setSelectedPrescription(null)
      setPrescriptions([])
      setPatientDocuments([])
      setDocEntries([])
      setDocEntryImageCounts({})
      setNav('patients')
      setView('list')

      const mirrorOk = await runV3Mirror(
        'Papierkorb',
        () => mirrorV3PatientById(selectedPatient.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? `${expectedName} wurde verschoben – 🪞 Löschstatus im V3-Spiegel geprüft.`
              : `${expectedName} wurde verschoben. Der V3-Spiegel braucht eine erneute Spiegelung.`)
          : `${expectedName} wurde in den Papierkorb verschoben. Alle zugehörigen Daten bleiben erhalten.`,
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRestorePatient(patient) {
    if (!canManageTrash) {
      setError('Der Papierkorb ist nur für die angemeldete Praxisleitung verfügbar.')
      return
    }

    setSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('V3-Wiederherstellen braucht in dieser Stufe Internet.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        await restoreV3Patient(patient.id, v3PracticeKeyRef.current)
        await loadListData()
        setSuccessMessage(`${patientLabel(patient)} wurde im verschlüsselten V3-Bestand wiederhergestellt.`)
        return
      }

      ensureV3MirrorWriteReady()
      await restorePatientInSupabase(patient.id)
      await loadListData()

      const mirrorOk = await runV3Mirror(
        'Wiederherstellen',
        () => mirrorV3PatientById(patient.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? `${patientLabel(patient)} wurde wiederhergestellt – 🪞 V3-Status geprüft.`
              : `${patientLabel(patient)} wurde wiederhergestellt. Der V3-Spiegel braucht eine erneute Spiegelung.`)
          : `${patientLabel(patient)} wurde wiederhergestellt.`,
      )
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
    setSuccessMessage('')
    prescriptionSaveBusyRef.current = true

    try {
      if (!prescriptionForm.issueDate || !prescriptionForm.remedy.trim()) {
        throw new Error('Bitte Ausstellungsdatum und Heilmittel ausfüllen.')
      }
      if (!cloudUser) throw new Error('Bitte erneut anmelden.')
      if (prescriptionConflict) {
        throw new Error('Diese Verordnung wurde auf einem anderen Gerät geändert. Bitte zuerst den aktuellen Stand laden.')
      }

      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('Die V3-Hauptbetrieb-Testfahrt speichert in dieser Stufe nur online.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const isNewV3 = !selectedPrescription && !prescriptionForm.id
        const idV3 = selectedPrescription?.id || prescriptionForm.id || crypto.randomUUID()
        const modeV3 = isNewV3 ? 'insert' : 'update'
        const expectedV3 = selectedPrescription?.updatedAt || ''
        const candidateV3 = {
          ...prescriptionForm,
          id: idV3,
          patientId: selectedPatient.id,
          remedy: prescriptionForm.remedy.trim(),
        }

        const { prescription: savedV3, conflict: conflictV3 } = await saveV3Prescription(
          candidateV3,
          selectedPatient.id,
          cloudUser.id,
          v3PracticeKeyRef.current,
          expectedV3,
          modeV3,
        )

        if (conflictV3) {
          setPrescriptionConflict(conflictV3)
          setError('V3-Konflikt: Diese Verordnung wurde inzwischen auf einem anderen Gerät geändert.')
          return
        }

        await cachePrescription(savedV3)
        await refreshV3BridgeStatus()
        setPrescriptionConflict(null)
        setSelectedPrescription(isNewV3 ? null : savedV3)
        setPrescriptionForm(isNewV3 ? EMPTY_PRESCRIPTION_FORM : savedV3)
        setView(isNewV3 ? 'patientDetail' : 'prescriptionDetail')
        setPrescriptions(await listV3PrescriptionsForPatient(selectedPatient.id, v3PracticeKeyRef.current))
        setSuccessMessage('🚗 V3-Hauptbetrieb: Verordnung direkt verschlüsselt in V3 gespeichert. Alte Klartexttabelle unverändert.')
        return
      }

      ensureV3MirrorWriteReady({ allowOffline: true })

      const isNew = !selectedPrescription && !prescriptionForm.id
      const id = selectedPrescription?.id || prescriptionForm.id || crypto.randomUUID()
      const mode = isNew ? 'insert' : 'update'
      const expectedUpdatedAt = selectedPrescription?.updatedAt || ''
      const candidate = {
        ...prescriptionForm,
        id,
        patientId: selectedPatient.id,
        remedy: prescriptionForm.remedy.trim(),
      }

      const saveOffline = async () => {
        const localSaved = localPendingRecord({
          ...candidate,
          createdAt: selectedPrescription?.createdAt || prescriptionForm.createdAt || '',
          deletedAt: selectedPrescription?.deletedAt || '',
        })

        await cachePrescription(localSaved)
        await enqueueOutbox({
          id: `prescription:${id}`,
          kind: 'prescription',
          entityId: id,
          parentId: selectedPatient.id,
          mode,
          payload: localSaved,
          expectedUpdatedAt,
          userId: cloudUser.id,
        })
        await queueEncryptedV3MirrorOffline(
          'prescription',
          localSaved,
          selectedPatient.id,
        )
        await refreshOutboxCount()

        setPrescriptions(current => {
          const exists = current.some(item => item.id === localSaved.id)
          const next = exists
            ? current.map(item => item.id === localSaved.id ? localSaved : item)
            : [...current, localSaved]
          return next.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
        })

        setPrescriptionConflict(null)
        setError('')
        setSuccessMessage(v3MirrorModeRef.current ? 'Offline gespeichert – Verordnung wartet in alter Outbox + verschlüsselter V3-Spiegel-Outbox.' : 'Offline gespeichert – Verordnung wartet auf Synchronisierung.')

        if (selectedPrescription) {
          setSelectedPrescription(localSaved)
          setPrescriptionForm(localSaved)
          setView('prescriptionDetail')
        } else {
          setSelectedPrescription(null)
          setPrescriptionForm(EMPTY_PRESCRIPTION_FORM)
          setView('patientDetail')
        }
      }

      if (!navigator.onLine) {
        await saveOffline()
        return
      }

      let result
      try {
        result = await savePrescriptionToSupabase(
          candidate,
          selectedPatient.id,
          cloudUser.id,
          expectedUpdatedAt,
          mode,
        )
      } catch (e) {
        if (isConnectivityError(e)) {
          await saveOffline()
          return
        }
        throw e
      }

      const { prescription: saved, conflict } = result
      if (conflict) {
        setPrescriptionConflict(conflict)
        setError('Diese Verordnung wurde inzwischen auf einem anderen Gerät geändert. Deine Eingaben bleiben erhalten.')
        return
      }

      await cachePrescription(saved)

      setPrescriptions(current => {
        const exists = current.some(item => item.id === saved.id)
        const next = exists
          ? current.map(item => item.id === saved.id ? saved : item)
          : [...current, saved]
        return next.sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
      })
      setPrescriptionConflict(null)

      if (selectedPrescription) {
        setSelectedPrescription(saved)
        setPrescriptionForm(saved)
        setView('prescriptionDetail')
      } else {
        setPrescriptionForm(EMPTY_PRESCRIPTION_FORM)
        setView('patientDetail')
      }

      const mirrorOk = await runV3Mirror(
        'Verordnung',
        () => mirrorV3PrescriptionById(saved.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? 'Verordnung gespeichert – 🪞 verschlüsselter V3-Spiegel geprüft.'
              : 'Verordnung gespeichert. Der V3-Spiegel braucht eine erneute Spiegelung.')
          : 'Verordnung gespeichert und synchronisiert.',
      )
    } catch (e) {
      setError(e.message)
    } finally {
      prescriptionSaveBusyRef.current = false
      setSaving(false)
    }
  }

  function handleLoadPrescriptionConflict() {
    if (!prescriptionConflict) return
    setSelectedPrescription(prescriptionConflict)
    setPrescriptionForm(prescriptionConflict)
    setPrescriptionConflict(null)
    setError('')
    setSuccessMessage('Aktueller Stand der Verordnung wurde geladen.')
  }

  async function handleSaveDocEntry(event) {
    event.preventDefault()
    if (!selectedPrescription) return setError('Keine Verordnung ausgewählt.')

    setSaving(true)
    setError('')
    setSuccessMessage('')
    docSaveBusyRef.current = true

    try {
      if (!docForm.entryDate || !docForm.text.trim()) throw new Error('Bitte Datum und Text ausfüllen.')
      if (!cloudUser) throw new Error('Bitte erneut anmelden.')
      if (docConflict) {
        throw new Error('Dieser Doku-Eintrag wurde auf einem anderen Gerät geändert. Bitte zuerst den aktuellen Stand laden.')
      }

      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('Die V3-Hauptbetrieb-Testfahrt speichert in dieser Stufe nur online.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const isNewV3 = !docBaseEntry && !docForm.id
        const idV3 = docBaseEntry?.id || docForm.id || crypto.randomUUID()
        const modeV3 = isNewV3 ? 'insert' : 'update'
        const expectedV3 = docBaseEntry?.updatedAt || ''
        const candidateV3 = {
          ...docForm,
          id: idV3,
          prescriptionId: selectedPrescription.id,
          text: docForm.text.trim(),
        }

        const { entry: savedV3, conflict: conflictV3 } = await saveV3DocEntry(
          candidateV3,
          selectedPrescription.id,
          cloudUser.id,
          v3PracticeKeyRef.current,
          expectedV3,
          modeV3,
        )

        if (conflictV3) {
          setDocConflict(conflictV3)
          setError('V3-Konflikt: Dieser Doku-Eintrag wurde inzwischen auf einem anderen Gerät geändert.')
          return
        }

        try {
          await syncV3DocEntryImages(
            savedV3.id,
            docImages,
            cloudUser.id,
            v3PracticeKeyRef.current,
            docImageBaseIds,
          )
        } catch (e) {
          setDocForm(savedV3)
          setDocBaseEntry(savedV3)
          setError(`V3-Doku-Text wurde verschlüsselt gespeichert, aber die Bilder konnten nicht gespeichert werden: ${e.message}`)
          return
        }

        const updatedEntriesV3 = await listV3DocEntriesForPrescription(
          selectedPrescription.id,
          v3PracticeKeyRef.current,
        )
        const countsV3 = await getV3DocEntryImageCountMap(updatedEntriesV3.map(entry => entry.id))
        const imagesV3 = await loadV3DocEntryImages(savedV3.id, v3PracticeKeyRef.current)

        await cacheDocEntry(savedV3)
        await refreshV3BridgeStatus()
        setDocEntries(updatedEntriesV3)
        setDocEntryImageCounts(countsV3)
        setDocImages(imagesV3)
        setDocImageBaseIds(imagesV3.map(image => image.id))
        setDocForm(savedV3)
        setDocBaseEntry(savedV3)
        setDocConflict(null)
        setView('prescriptionDetail')
        setSuccessMessage('🚗 V3-Hauptbetrieb: Doku und Bilder direkt verschlüsselt in V3 gespeichert. Alte Klartexttabellen unverändert.')
        return
      }

      ensureV3MirrorWriteReady({ allowOffline: true })

      const currentImageIds = docImages.map(image => image.id).sort().join('|')
      const baseImageIds = docImageBaseIds.slice().sort().join('|')
      const imagesChanged = currentImageIds !== baseImageIds

      const isNew = !docBaseEntry && !docForm.id
      const id = docBaseEntry?.id || docForm.id || crypto.randomUUID()
      const mode = isNew ? 'insert' : 'update'
      const expectedUpdatedAt = docBaseEntry?.updatedAt || ''
      const candidate = {
        ...docForm,
        id,
        prescriptionId: selectedPrescription.id,
        text: docForm.text.trim(),
      }

      const saveOffline = async () => {
        if (imagesChanged) {
          throw new Error('Doku-Bilder können offline noch nicht geändert werden. Bitte Bildänderungen erst mit Internet speichern.')
        }

        const localSaved = localPendingRecord({
          ...candidate,
          createdAt: docBaseEntry?.createdAt || docForm.createdAt || '',
          deletedAt: docBaseEntry?.deletedAt || '',
        })

        await cacheDocEntry(localSaved)
        await enqueueOutbox({
          id: `docEntry:${id}`,
          kind: 'docEntry',
          entityId: id,
          parentId: selectedPrescription.id,
          mode,
          payload: localSaved,
          expectedUpdatedAt,
          userId: cloudUser.id,
        })
        await queueEncryptedV3MirrorOffline(
          'docEntry',
          localSaved,
          selectedPrescription.id,
        )
        await refreshOutboxCount()

        setDocEntries(current => {
          const exists = current.some(item => item.id === localSaved.id)
          const next = exists
            ? current.map(item => item.id === localSaved.id ? localSaved : item)
            : [...current, localSaved]
          return next.sort((a, b) =>
            (b.entryDate || '').localeCompare(a.entryDate || '') ||
            (b.createdAt || '').localeCompare(a.createdAt || '')
          )
        })

        setDocForm(localSaved)
        setDocBaseEntry(localSaved)
        setDocConflict(null)
        setError('')
        setSuccessMessage(v3MirrorModeRef.current ? 'Offline gespeichert – Doku wartet in alter Outbox + verschlüsselter V3-Spiegel-Outbox.' : 'Offline gespeichert – Doku wartet auf Synchronisierung.')
        setView('prescriptionDetail')
      }

      if (!navigator.onLine) {
        await saveOffline()
        return
      }

      let result
      try {
        result = await saveDocEntryToSupabase(
          candidate,
          selectedPrescription.id,
          cloudUser.id,
          expectedUpdatedAt,
          mode,
        )
      } catch (e) {
        if (isConnectivityError(e)) {
          await saveOffline()
          return
        }
        throw e
      }

      const { entry: saved, conflict } = result
      if (conflict) {
        setDocConflict(conflict)
        setError('Dieser Doku-Eintrag wurde inzwischen auf einem anderen Gerät geändert. Dein Text bleibt erhalten.')
        return
      }

      await cacheDocEntry(saved)

      let syncedImages
      try {
        syncedImages = await syncDocEntryImagesToSupabase(
          saved.id,
          docImages,
          cloudUser.id,
          docImageBaseIds,
        )
      } catch (e) {
        setDocForm(saved)
        setDocBaseEntry(saved)
        setError(`Doku-Text wurde gespeichert, aber die Bilder konnten nicht synchronisiert werden: ${e.message}`)
        return
      }

      const updatedEntries = await listDocEntriesForPrescription(selectedPrescription.id)
      const counts = await getDocEntryImageCountMapFromSupabase(updatedEntries.map(entry => entry.id))

      setDocEntries(updatedEntries)
      setDocEntryImageCounts(counts)
      setDocImages(syncedImages)
      setDocImageBaseIds(syncedImages.map(image => image.id))
      setDocForm(saved)
      setDocBaseEntry(saved)
      setDocConflict(null)
      setView('prescriptionDetail')

      const mirrorOk = await runV3Mirror(
        'Doku + Bilder',
        () => mirrorV3DocEntryById(saved.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? 'Doku gespeichert – 🪞 Text und Bilder im verschlüsselten V3-Spiegel geprüft.'
              : 'Doku gespeichert. Der V3-Spiegel braucht eine erneute Spiegelung.')
          : 'Doku gespeichert und synchronisiert.',
      )
    } catch (e) {
      setError(e.message)
    } finally {
      docSaveBusyRef.current = false
      setSaving(false)
    }
  }

  async function handleLoadDocConflict() {
    if (!docConflict) return
    setDocForm(docConflict)
    setDocBaseEntry(docConflict)
    setDocConflict(null)
    setError('')

    const currentIds = docImages.map(image => image.id).sort().join('|')
    const baseIds = docImageBaseIds.slice().sort().join('|')
    if (currentIds === baseIds) {
      try {
        const images = await loadDocEntryImagesFromSupabase(docConflict.id)
        setDocImages(images)
        setDocImageBaseIds(images.map(image => image.id))
      } catch (e) {
        setError(`Bilder konnten nicht aktualisiert werden: ${e.message}`)
      }
    }

    setSuccessMessage('Aktueller Stand der Doku wurde geladen.')
  }

  async function handleSaveLibraryItem(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      if (libraryCategory === 'archiv') throw new Error('Das Archiv bleibt erstmal leer.')
      if (!libraryForm.title.trim()) throw new Error('Bitte eine kurze Überschrift eintragen.')
      if (!libraryForm.file) throw new Error('Bitte eine Datei auswählen.')
      if (!cloudUser) throw new Error('Bitte erneut anmelden.')

      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('Die V3-Hauptbetrieb-Testfahrt speichert Dateien in dieser Stufe nur online.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const savedV3 = await saveV3LibraryItem(
          {
            ...libraryForm,
            title: libraryForm.title.trim(),
            note: libraryForm.note.trim(),
          },
          libraryCategory,
          cloudUser.id,
          v3PracticeKeyRef.current,
        )

        setLibraryItems(current => {
          const next = [savedV3, ...current.filter(item => item.id !== savedV3.id)]
          return next.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        })
        setLibraryForm({ ...EMPTY_LIBRARY_FORM, category: libraryCategory })
        setView('libraryList')
        await refreshV3BridgeStatus()
        setSuccessMessage('🚗 V3-Hauptbetrieb: Bibliotheksdatei direkt verschlüsselt in V3 gespeichert. Alte Klartexttabelle unverändert.')
        return
      }

      ensureV3MirrorWriteReady()

      const saved = await saveLibraryItemToSupabase(
        {
          ...libraryForm,
          title: libraryForm.title.trim(),
          note: libraryForm.note.trim(),
        },
        libraryCategory,
        cloudUser.id,
      )

      setLibraryItems(current => {
        const exists = current.some(item => item.id === saved.id)
        const next = exists
          ? current.map(item => item.id === saved.id ? saved : item)
          : [saved, ...current]
        return next.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      })

      setLibraryForm({ ...EMPTY_LIBRARY_FORM, category: libraryCategory })
      setView('libraryList')

      const mirrorOk = await runV3Mirror(
        'Bibliothek',
        () => mirrorV3LibraryItemById(saved.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? 'Bibliotheksdatei gespeichert – 🪞 verschlüsselter V3-Spiegel samt Datei geprüft.'
              : 'Bibliotheksdatei gespeichert. Der V3-Spiegel braucht eine erneute Spiegelung.')
          : 'Bibliotheksdatei gespeichert und synchronisiert.',
      )
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
    setSuccessMessage('')
    patientDocumentSaveBusyRef.current = true

    try {
      if (!patientDocumentForm.documentDate) throw new Error('Bitte Datum ausfüllen.')
      if (!patientDocumentForm.title.trim()) throw new Error('Bitte eine kurze Überschrift eintragen.')
      if (!cloudUser) throw new Error('Bitte erneut anmelden.')
      if (patientDocumentConflict) {
        throw new Error('Dieses Dokument wurde auf einem anderen Gerät geändert. Bitte zuerst den aktuellen Stand laden.')
      }

      if (v3PrimaryModeRef.current) {
        if (!navigator.onLine) throw new Error('Die V3-Hauptbetrieb-Testfahrt speichert Dateien in dieser Stufe nur online.')
        if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')

        const { document: savedV3, conflict: conflictV3 } = await saveV3PatientDocument(
          {
            ...patientDocumentForm,
            id: patientDocumentBase?.id || patientDocumentForm.id || '',
            title: patientDocumentForm.title.trim(),
            note: patientDocumentForm.note.trim(),
          },
          selectedPatient.id,
          cloudUser.id,
          v3PracticeKeyRef.current,
          patientDocumentBase?.updatedAt || '',
        )

        if (conflictV3) {
          setPatientDocumentConflict(conflictV3)
          setError('V3-Konflikt: Dieses Dokument wurde inzwischen auf einem anderen Gerät geändert.')
          return
        }

        await reloadPatientDocuments(selectedPatient.id)
        await refreshV3BridgeStatus()
        setPatientDocumentConflict(null)
        setPatientDocumentBase(savedV3)
        setPatientDocumentForm(savedV3)
        setView('patientDetail')
        setSuccessMessage('🚗 V3-Hauptbetrieb: Dokument/Befund direkt verschlüsselt in V3 gespeichert. Alte Klartexttabelle unverändert.')
        return
      }

      ensureV3MirrorWriteReady()

      const { document: saved, conflict } = await savePatientDocumentToSupabase(
        {
          ...patientDocumentForm,
          id: patientDocumentBase?.id || patientDocumentForm.id || '',
          title: patientDocumentForm.title.trim(),
          note: patientDocumentForm.note.trim(),
        },
        selectedPatient.id,
        cloudUser.id,
        patientDocumentBase?.updatedAt || '',
      )

      if (conflict) {
        setPatientDocumentConflict(conflict)
        setError('Dieses Dokument wurde inzwischen auf einem anderen Gerät geändert. Deine Eingaben bleiben erhalten.')
        return
      }

      await reloadPatientDocuments(selectedPatient.id)
      setPatientDocumentConflict(null)
      setPatientDocumentBase(saved)
      setPatientDocumentForm(saved)
      setView('patientDetail')

      const mirrorOk = await runV3Mirror(
        'Dokument/Befund',
        () => mirrorV3PatientDocumentById(saved.id, cloudUser.id, v3PracticeKeyRef.current),
      )
      setSuccessMessage(
        v3MirrorModeRef.current
          ? (mirrorOk
              ? 'Dokument/Befund gespeichert – 🪞 verschlüsselter V3-Spiegel samt Datei geprüft.'
              : 'Dokument/Befund gespeichert. Der V3-Spiegel braucht eine erneute Spiegelung.')
          : 'Dokument/Befund gespeichert und synchronisiert.',
      )
    } catch (e) {
      setError(e.message)
    } finally {
      patientDocumentSaveBusyRef.current = false
      setSaving(false)
    }
  }

  async function handleLoadPatientDocumentConflict() {
    if (!patientDocumentConflict) return
    try {
      const loaded = await loadPatientDocumentFile(patientDocumentConflict)
      setPatientDocumentForm(loaded)
      setPatientDocumentBase(patientDocumentConflict)
      setPatientDocumentConflict(null)
      setError('')
      setSuccessMessage('Aktueller Stand des Dokuments wurde geladen.')
    } catch (e) {
      setError(`Dokument konnte nicht geladen werden: ${e.message}`)
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

  function handleChangeRole(role) {
    setUserRole(role)
    window.localStorage.setItem('pwaUserRole', role)
    setSuccessMessage(`Rolle gespeichert: ${USER_ROLE_LABELS[role]}`)
    setError('')
  }

  function handleChangeUserName(value) {
    setUserName(value)
    window.localStorage.setItem('pwaUserName', value)
  }

  async function handleStaffExportChanges() {
    setError('')
    setSuccessMessage('')

    const name = userName.trim() || 'Mitarbeiter'

    setSuccessMessage(
      `Änderungs-Export für ${name} ist vorbereitet. In der nächsten Stufe werden nur neue Patienten, Verordnungen und Doku-Einträge verschlüsselt an die Praxisleitung übertragen.`
    )
  }

  if (!authReady) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="surface-card stack" style={{ maxWidth: 520, margin: '48px auto' }}>
            <h2 className="section-title">PhysioOptima</h2>
            <p className="muted">Anmeldung wird geprüft ...</p>
          </section>
        </main>
      </div>
    )
  }

  if (!cloudUser) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="surface-card stack" style={{ maxWidth: 520, margin: '48px auto' }}>
            <div className="sidebar-logo-wrap">
              <img src="/logo_kl.gif" alt="Praxis Logo" className="sidebar-logo" />
            </div>
            <h2 className="section-title">Behandlungsdokumentation</h2>
            <p className="muted">Bitte mit deinem Supabase-Benutzerkonto anmelden.</p>
            <form className="stack" onSubmit={handleCloudLogin}>
              <input className="field" type="email" placeholder="E-Mail" value={cloudEmail} onChange={e => setCloudEmail(e.target.value)} required />
              <input className="field" type="password" placeholder="Passwort" value={cloudPassword} onChange={e => setCloudPassword(e.target.value)} required />
              <button className="btn btn-primary" disabled={cloudBusy}>{cloudBusy ? 'Anmeldung ...' : 'Anmelden'}</button>
            </form>
            {error && <p className="error-message">{error}</p>}
          </section>
        </main>
      </div>
    )
  }

  if (!v3KeyringReady) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="surface-card stack" style={{ maxWidth: 520, margin: '48px auto' }}>
            <div className="sidebar-logo-wrap">
              <img src="/logo_kl.gif" alt="Praxis Logo" className="sidebar-logo" />
            </div>
            <h2 className="section-title">Behandlungsdokumentation</h2>
            <p className="muted">Verschlüsselter Praxisschlüssel wird geladen …</p>
          </section>
        </main>
      </div>
    )
  }

  if (!v3Keyring) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="surface-card stack" style={{ maxWidth: 520, margin: '48px auto' }}>
            <div className="sidebar-logo-wrap">
              <img src="/logo_kl.gif" alt="Praxis Logo" className="sidebar-logo" />
            </div>
            <h2 className="section-title">Verschlüsselte Praxis nicht eingerichtet</h2>
            <p className="msg msg-error">
              Für dieses Konto wurde kein V3-Praxisschlüssel gefunden. Die Patientenoberfläche bleibt gesperrt.
            </p>
          </section>
        </main>
      </div>
    )
  }

  if (!v3Unlocked || !v3PrimaryMode) {
    return (
      <div className="app-shell">
        <main className="app-main">
          <section className="surface-card stack" style={{ maxWidth: 520, margin: '48px auto' }}>
            <div className="sidebar-logo-wrap">
              <img src="/logo_kl.gif" alt="Praxis Logo" className="sidebar-logo" />
            </div>

            <h2 className="section-title">Praxisschlüssel entsperren</h2>
            <p className="muted">
              Die Cloud-Anmeldung ist gültig. Jetzt wird nur noch der lokale Schlüssel für die
              verschlüsselte Behandlungsdokumentation benötigt.
            </p>

            <form className="stack" onSubmit={handleOpenEncryptedPractice}>
              <input
                className="field"
                type="password"
                autoComplete="current-password"
                placeholder="Verschlüsselungspasswort"
                value={v3Passphrase}
                onChange={event => setV3Passphrase(event.target.value)}
                required
                autoFocus
              />
              <button className="btn btn-primary" disabled={v3KeyBusy}>
                {v3KeyBusy ? 'Entsperre …' : 'Praxis öffnen'}
              </button>
            </form>

            <details>
              <summary className="muted">Wiederherstellungsschlüssel verwenden</summary>
              <form className="stack" onSubmit={handleOpenEncryptedPracticeWithRecovery} style={{ marginTop: 12 }}>
                <input
                  className="field"
                  placeholder="Wiederherstellungsschlüssel"
                  value={v3RecoveryInput}
                  onChange={event => setV3RecoveryInput(event.target.value)}
                  required
                />
                <button className="btn btn-ghost" disabled={v3KeyBusy}>
                  Mit Wiederherstellungsschlüssel öffnen
                </button>
              </form>
            </details>

            <p className="muted">
              Das Verschlüsselungspasswort wird nicht gespeichert. Der entsperrte Praxisschlüssel
              bleibt nur im Arbeitsspeicher, solange diese PWA geöffnet ist.
            </p>

            {error && <p className="msg msg-error">{error}</p>}
          </section>
        </main>
      </div>
    )
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
              ...(canManageTrash ? [['trash', `Papierkorb (${deletedPatients.length})`, Trash2]] : []),
              ['exercises', 'Übungen', Dumbbell],
              ['library', 'Bibliothek', Library],
              ['backup', 'Backup', CloudUpload],
              ['settings', 'Einstellungen', Settings],
	      ['speech', 'Sprachmodell', FileText],
            ].map(([key, label, Icon]) => (
              <button
                key={key}
                className={`sidebar-item ${nav === key ? 'is-active' : ''}`}
                onClick={() => {
                  setNav(key)
                  setSuccessMessage('')
                  if (key === 'patients') setView('list')
                  if (key === 'trash') setView('trash')
                  if (key === 'backup') setView('backup')
                  if (key === 'library') setView('libraryHome')
                  if (key === 'exercises') setView('list')
                  if (key === 'settings') setView('list')
		  if (key === 'speech') setView('speechModel')
                }}
              >
                <Icon size={16} />
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

            {v3ReadMode && (
              <div className="sync-status sync-status-active">
                <strong>🔒 V3-Lesemodus aktiv</strong>
                <span>
                  Diese Ansicht liest ausschließlich den verschlüsselten V3-Parallelbestand.
                  Patientendaten werden erst auf diesem Gerät entschlüsselt. Bearbeiten und Löschen sind gesperrt.
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleExitV3ReadMode}
                >
                  V3-Lesemodus beenden
                </button>
              </div>
            )}

            {v3PrimaryMode && (
              <div className="sync-status sync-status-active">
                <strong>🚗 V3-Hauptbetrieb – Testfahrt aktiv</strong>
                <span>
                  Diese Test-PWA liest und schreibt direkt gegen die verschlüsselten V3-Tabellen.
                  Die alten Klartexttabellen werden nicht mit aktualisiert.
                </span>
                <span>
                  Für diese erste Testfahrt ist Speichern absichtlich nur online freigegeben.
                  Die normale Produktions-PWA bitte nicht parallel für Änderungen benutzen.
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleStopV3PrimaryMode}
                >
                  V3-Hauptbetrieb-Testfahrt beenden
                </button>
              </div>
            )}

            {v3MirrorMode && (
              <div className="sync-status sync-status-active">
                <strong>🪞 V3-Schreibspiegel aktiv</strong>
                <span>
                  Online: bisherige Praxis speichern → lokal verschlüsseln → V3 schreiben → sofort gegenprüfen.
                </span>
                <span>
                  Offline: Patient, Verordnung und Doku-Text landen zusätzlich als Chiffretext in einer eigenen
                  V3-Spiegel-Outbox. Doku-Bilder, Befunde und Bibliotheksdateien brauchen weiterhin Internet.
                </span>
                <span>
                  Warteschlangen: bisherige Outbox {outboxCount} · verschlüsselte V3-Spiegel-Outbox {v3MirrorOutboxCount}
                </span>
                {v3MirrorOfflineAudit && (
                  <span>
                    Letzte Rohdatenprüfung der V3-Spiegel-Outbox:
                    {' '}{v3MirrorOfflineAudit.leaks.length} Klartextfundstelle(n)
                    {v3MirrorOfflineAudit.safe ? ' – sauber' : ''}
                  </span>
                )}
                {v3MirrorLastMessage && <span>{v3MirrorLastMessage}</span>}
                <span>
                  Brückentest-Hinweis: Die bisherige Offline-Arbeitskopie/alte Outbox existiert noch parallel.
                  Vollständig verschlüsselter Offline-Betrieb wird erst beim späteren V3-Hauptbetrieb aktiviert.
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleStopV3MirrorMode}
                >
                  V3-Schreibspiegel beenden
                </button>
              </div>
            )}

            {nav === 'exercises' && <section className="surface-card stack-lg">
              <h2 className="section-title">Übungen</h2>
              <p className="muted">Dieser Bereich wird später erweitert.</p>
              <div><button className="btn btn-ghost" onClick={goPatients}>Zurück zur Patientenliste</button></div>
            </section>}

	  {nav === 'speech' && view === 'speechModel' && (
  	  <section className="surface-card stack-lg">
    	<h2 className="section-title">Sprachmodell</h2>
    	<p className="muted">
      Testbereich für Wörterbuch, typische Sätze und spätere Spracherkennung.
    	</p>

    <button
      type="button"
      className="btn btn-primary"
      onClick={async () => {
        await loadModel()
        setSuccessMessage('Sprachmodell-Test erfolgreich.')
        setError('')
      }}
    >
      Sprachmodell testen
    </button>
  </section>
)}

            {nav === 'settings' && <section className="surface-card stack-lg">
              <h2 className="section-title">Einstellungen</h2>

              <div className="stack">
                <div>
                  <h3 className="section-subtitle">Rolle auf diesem Gerät</h3>
                  <p className="muted">
                    Diese Einstellung gilt nur lokal für dieses Gerät. Sie ist ein Arbeitsmodus, noch kein echtes Login-System.
                  </p>
                </div>

                <label className="field-label">
                  Benutzername / Kürzel
                  <input
                    className="field"
                    placeholder="z. B. Anna oder Sabine"
                    value={userName}
                    onChange={event => handleChangeUserName(event.target.value)}
                  />
                </label>

                <div className="stack-sm">
                  <button
                    type="button"
                    className={`btn ${isOwner ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => handleChangeRole(USER_ROLES.OWNER)}
                  >
                    Praxisleitung
                  </button>

                  <button
                    type="button"
                    className={`btn ${isStaff ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => handleChangeRole(USER_ROLES.STAFF)}
                  >
                    Mitarbeiter
                  </button>
                </div>

                <p className="muted">
                  Aktuelle Rolle: <strong>{USER_ROLE_LABELS[userRole]}</strong>
                </p>

                {isStaff && (
                  <p className="muted">
                    Mitarbeiter-Modus: Patient anlegen, Verordnung anlegen und Doku schreiben. Backup-Export sendet später nur Änderungen an die Praxisleitung.
                  </p>
                )}

                {isOwner && (
                  <p className="muted">
                    Praxisleitungs-Modus: voller Zugriff inklusive ZIP-Backup, Import, Dokumente/Befunde und Cloud-Testfunktionen.
                  </p>
                )}
              </div>

              <div><button className="btn btn-ghost" onClick={goPatients}>Zurück zur Patientenliste</button></div>
            </section>}

            {nav === 'backup' && view === 'backup' && (
              <section className="surface-card stack-lg">
                <h2 className="section-title">Backup</h2>
                <p className="muted">
                  Hier liegt das vollständige Rettungsboot: ZIP-Backup exportieren oder komplett wieder einspielen.
                </p>

                <div className="backup-card">
                  <h3>Verschlüsselter Cloud-Tresor</h3>
                  {!cloudUser ? (
                    <form className="stack-sm" onSubmit={handleCloudLogin}>
                      <input className="field" type="email" placeholder="Geschäftliche E-Mail" value={cloudEmail} onChange={e => setCloudEmail(e.target.value)} required />
                      <input className="field" type="password" placeholder="Doku-PWA-Passwort" value={cloudPassword} onChange={e => setCloudPassword(e.target.value)} required />
                      <button className="btn btn-primary" disabled={cloudBusy}>Bei Supabase anmelden</button>
                    </form>
                  ) : (
                    <div className="stack-sm">
                      <p className="muted">Angemeldet als <strong>{cloudUser.email}</strong></p>
                      <p className="muted">Cloud-Stand: <strong>{cloudUpdatedAt ? formatDateTime(cloudUpdatedAt) : 'Noch kein Cloud-Backup'}</strong></p>
                      <button className="btn btn-secondary" onClick={handleCloudUpload} disabled={cloudBusy}>Sicher mit Cloud synchronisieren</button>
                      <button className="btn btn-ghost" onClick={handleCloudDownload} disabled={cloudBusy}>Cloud-Daten herunterladen (lokal ersetzen)</button>
                      <div className={`sync-status sync-status-${autoSyncStatus}`}>
                        <strong>Geräte-Synchronisation</strong>
                        <span>{autoSyncMessage}</span>
                      </div>
                      {!autoSyncPassword ? (
                        <button className="btn btn-green" onClick={handleEnableAutoSync} disabled={cloudBusy}>
                          Automatische Synchronisation starten
                        </button>
                      ) : (
                        <button className="btn btn-ghost" onClick={handleDisableAutoSync} disabled={cloudBusy}>
                          Automatische Synchronisation beenden
                        </button>
                      )}
                      <button className="btn btn-ghost" onClick={() => { handleDisableAutoSync(); supabase.auth.signOut() }} disabled={cloudBusy}>Abmelden</button>
                    </div>
                  )}
                  <p className="muted">Das Verschlüsselungspasswort verlässt dieses Gerät nicht. Für automatische Synchronisation bleibt es nur bis zum Schließen der PWA im Arbeitsspeicher.</p>
                </div>

                {isOwner && (
                  <div className="backup-card">
                    <h3>🌉 V3-Brücke: echter Praxisschlüssel</h3>
                    <p>
                      Das ist jetzt nicht mehr das Labor. Dieser Schlüssel soll später die echte verschlüsselte
                      Parallelstruktur öffnen. Die alten Praxistabellen bleiben unverändert, und die neuen V3-Tabellen
                      sind derzeit noch leer.
                    </p>

                    <p className="muted">
                      Schlüsseltechnik: <strong>{V2_CRYPTO_PARAMETERS.algorithm}</strong> ·
                      {' '}{V2_CRYPTO_PARAMETERS.kdf} ·
                      {' '}{V2_CRYPTO_PARAMETERS.iterations.toLocaleString('de-DE')} Ableitungsrunden.
                      Die tägliche Passphrase und der Wiederherstellungscode werden nicht bei Supabase gespeichert.
                    </p>

                    {!v3Keyring ? (
                      <div className="stack-sm">
                        {!v3RecoveryCode ? (
                          <form className="stack-sm" onSubmit={handleCreateV3PracticeKey}>
                            <input
                              className="field"
                              type="password"
                              autoComplete="new-password"
                              placeholder="Echte Verschlüsselungs-Passphrase (mindestens 16 Zeichen)"
                              value={v3Passphrase}
                              onChange={event => setV3Passphrase(event.target.value)}
                              required
                            />
                            <input
                              className="field"
                              type="password"
                              autoComplete="new-password"
                              placeholder="Passphrase wiederholen"
                              value={v3PassphraseConfirm}
                              onChange={event => setV3PassphraseConfirm(event.target.value)}
                              required
                            />
                            <button className="btn btn-green" disabled={v3KeyBusy || !cloudUser}>
                              {v3KeyBusy ? 'Erzeuge …' : 'Echten Praxisschlüssel erzeugen'}
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="sync-status">
                              <strong>Wiederherstellungsschlüssel – einmalig sichern</strong>
                              <span style={{ overflowWrap: 'anywhere' }}>{v3RecoveryCode}</span>
                              <span>
                                Diesen Code nicht hier im Chat schicken. Am besten die Datei auf einem getrennten
                                Datenträger oder an einem anderen sicheren Ort aufbewahren.
                              </span>
                            </div>

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleDownloadV3RecoveryKey}
                              disabled={v3KeyBusy}
                            >
                              Wiederherstellungsschlüssel als .txt speichern
                            </button>

                            <button
                              type="button"
                              className="btn btn-green"
                              onClick={handleActivateV3PracticeKey}
                              disabled={v3KeyBusy || !v3RecoveryDownloaded}
                            >
                              {v3KeyBusy ? 'Aktiviere …' : 'Praxisschlüssel aktivieren'}
                            </button>

                            {!v3RecoveryDownloaded && (
                              <p className="muted">
                                Aktivieren wird erst freigegeben, nachdem die Wiederherstellungsdatei gespeichert wurde.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="stack-sm">
                        <div className="sync-status sync-status-active">
                          <strong>V3-Praxisschlüssel eingerichtet</strong>
                          <span>
                            Schlüsselversion {v3Keyring.crypto_version} · eingerichtet
                            {' '}{formatDateTime(v3Keyring.created_at)}
                          </span>
                          <span>
                            Parallelbestand:
                            {' '}Patienten {v3Counts?.patients ?? 0} ·
                            {' '}Verordnungen {v3Counts?.prescriptions ?? 0} ·
                            {' '}Doku {v3Counts?.docEntries ?? 0} ·
                            {' '}Bilder {v3Counts?.docEntryImages ?? 0} ·
                            {' '}Befunde {v3Counts?.patientDocuments ?? 0} ·
                            {' '}Bibliothek {v3Counts?.libraryItems ?? 0}
                          </span>
                        </div>

                        {!v3Unlocked ? (
                          <>
                            <form className="stack-sm" onSubmit={handleUnlockV3PracticeKey}>
                              <input
                                className="field"
                                type="password"
                                autoComplete="current-password"
                                placeholder="Echte Verschlüsselungs-Passphrase"
                                value={v3Passphrase}
                                onChange={event => setV3Passphrase(event.target.value)}
                                required
                              />
                              <button className="btn btn-secondary" disabled={v3KeyBusy}>
                                {v3KeyBusy ? 'Entsperre …' : 'V3-Praxisschlüssel entsperren'}
                              </button>
                            </form>

                            <input
                              className="field"
                              placeholder="Wiederherstellungsschlüssel nur für Notfall-Test"
                              value={v3RecoveryInput}
                              onChange={event => setV3RecoveryInput(event.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleUnlockV3WithRecovery}
                              disabled={v3KeyBusy || !v3RecoveryInput.trim()}
                            >
                              Mit Wiederherstellungsschlüssel entsperren
                            </button>
                          </>
                        ) : (
                          <>
                            <div className="sync-status sync-status-active">
                              <strong>🔓 V3-Praxisschlüssel entsperrt</strong>
                              <span>
                                Nur im Arbeitsspeicher dieses Geräts.
                                {v3Counts?.patients
                                  ? ' Der verschlüsselte Parallelbestand kann jetzt aktualisiert und geprüft werden.'
                                  : ' Die alte Praxis ist bereit für die verschlüsselte Parallelkopie.'}
                              </span>
                            </div>

                            <button
                              type="button"
                              className="btn btn-green"
                              onClick={handleBuildV3ParallelBridge}
                              disabled={v3BridgeBusy}
                            >
                              {v3BridgeBusy
                                ? 'V3-Brücke wird gebaut …'
                                : 'V3-Parallelbestand bauen / aktualisieren + vollständig prüfen'}
                            </button>

                            {v3BridgeProgress && (
                              <div className="sync-status">
                                <strong>Brückenbau – Status</strong>
                                <span>{v3BridgeProgress}</span>
                              </div>
                            )}

                            {v3BridgeVerification && (
                              <div className="sync-status sync-status-active">
                                <strong>✅ V3-Brückenbelag vollständig geprüft</strong>
                                <span>
                                  Patienten: {v3BridgeVerification.v3Counts.patients} ·
                                  {' '}Verordnungen: {v3BridgeVerification.v3Counts.prescriptions} ·
                                  {' '}Doku: {v3BridgeVerification.v3Counts.docEntries}
                                </span>
                                <span>
                                  Bilder: {v3BridgeVerification.v3Counts.docEntryImages} ·
                                  {' '}Befunde: {v3BridgeVerification.v3Counts.patientDocuments} ·
                                  {' '}Bibliothek: {v3BridgeVerification.v3Counts.libraryItems}
                                </span>
                                <span>
                                  Verschlüsselte Dateien entschlüsselt + SHA-256 geprüft:
                                  {' '}{v3BridgeVerification.verifiedFiles} ·
                                  {' '}{formatByteCount(v3BridgeVerification.verifiedBytes)}
                                </span>
                                {v3BridgeVerification.missingDeletedFiles > 0 && (
                                  <span>
                                    {v3BridgeVerification.missingDeletedFiles} bereits gelöschte Dateireferenz(en)
                                    hatten erwartungsgemäß keine Quelldatei mehr.
                                  </span>
                                )}
                                <span>
                                  Alte Tabellen/Dateien: unverändert vorhanden.
                                </span>
                              </div>
                            )}

                            {!v3ReadMode && !v3MirrorMode && !v3PrimaryMode && (v3Counts?.patients ?? 0) > 0 && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={handleEnterV3ReadMode}
                                  disabled={v3BridgeBusy}
                                >
                                  🔒 V3-Lesemodus starten
                                </button>

                                <button
                                  type="button"
                                  className="btn btn-green"
                                  onClick={handleStartV3MirrorMode}
                                  disabled={v3BridgeBusy}
                                >
                                  🪞 V3-Schreibspiegel starten
                                </button>

                                <button
                                  type="button"
                                  className="btn btn-green"
                                  onClick={handleStartV3PrimaryMode}
                                  disabled={v3BridgeBusy}
                                >
                                  🚗 V3-Hauptbetrieb – Testfahrt starten
                                </button>
                              </>
                            )}

                            {v3MirrorMode && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleStopV3MirrorMode}
                                disabled={v3BridgeBusy}
                              >
                                V3-Schreibspiegel beenden
                              </button>
                            )}

                            {v3PrimaryMode && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleStopV3PrimaryMode}
                                disabled={v3BridgeBusy}
                              >
                                V3-Hauptbetrieb-Testfahrt beenden
                              </button>
                            )}

                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleLockV3PracticeKey}
                              disabled={v3BridgeBusy}
                            >
                              V3-Praxisschlüssel sperren
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isOwner && (
                  <div className="backup-card">
                    <h3>🔐 V2-Verschlüsselungslabor</h3>
                    <p>
                      Rein lokaler Test des zukünftigen Praxisschlüssels. Diese Karte schreibt nichts nach Supabase
                      und verändert keine Patienten-, Doku- oder Dateidaten.
                    </p>

                    <p className="muted">
                      Technik: <strong>{V2_CRYPTO_PARAMETERS.algorithm}</strong> ·
                      {' '}{V2_CRYPTO_PARAMETERS.kdf} ·
                      {' '}{V2_CRYPTO_PARAMETERS.iterations.toLocaleString('de-DE')} Ableitungsrunden
                    </p>

                    {!cryptoLabConfigured ? (
                      <form className="stack-sm" onSubmit={handleCreateCryptoLab}>
                        <input
                          className="field"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Test-Passphrase (mindestens 12 Zeichen)"
                          value={cryptoPassphrase}
                          onChange={event => setCryptoPassphrase(event.target.value)}
                          required
                        />
                        <input
                          className="field"
                          type="password"
                          autoComplete="new-password"
                          placeholder="Test-Passphrase wiederholen"
                          value={cryptoPassphraseConfirm}
                          onChange={event => setCryptoPassphraseConfirm(event.target.value)}
                          required
                        />
                        <button className="btn btn-secondary" disabled={cryptoBusy}>
                          {cryptoBusy ? 'Erzeuge Schlüssel …' : 'Test-Praxisschlüssel erzeugen'}
                        </button>
                        <p className="muted">
                          Bitte hier noch nicht dein endgültiges Praxis-Passwort verwenden. Dies ist nur das Labor.
                        </p>
                      </form>
                    ) : (
                      <div className="stack-sm">
                        {!cryptoUnlocked ? (
                          <>
                            <form className="stack-sm" onSubmit={handleUnlockCryptoLab}>
                              <input
                                className="field"
                                type="password"
                                autoComplete="current-password"
                                placeholder="Test-Passphrase"
                                value={cryptoPassphrase}
                                onChange={event => setCryptoPassphrase(event.target.value)}
                                required
                              />
                              <button className="btn btn-secondary" disabled={cryptoBusy}>
                                {cryptoBusy ? 'Entsperre …' : 'Test-Praxisschlüssel entsperren'}
                              </button>
                            </form>

                            <div className="stack-sm">
                              <input
                                className="field"
                                placeholder="Wiederherstellungsschlüssel"
                                value={cryptoRecoveryInput}
                                onChange={event => setCryptoRecoveryInput(event.target.value)}
                              />
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={handleUnlockCryptoLabRecovery}
                                disabled={cryptoBusy || !cryptoRecoveryInput.trim()}
                              >
                                Mit Wiederherstellungsschlüssel entsperren
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="sync-status sync-status-active">
                              <strong>Test-Praxisschlüssel entsperrt</strong>
                              <span>Der Schlüssel liegt nur im Arbeitsspeicher dieser geöffneten PWA.</span>
                            </div>

                            <textarea
                              className="field"
                              rows="3"
                              value={cryptoTestText}
                              onChange={event => setCryptoTestText(event.target.value)}
                            />

                            <button
                              type="button"
                              className="btn btn-green"
                              onClick={handleCryptoRoundTrip}
                              disabled={cryptoBusy}
                            >
                              {cryptoBusy ? 'Teste …' : 'Testtext verschlüsseln + entschlüsseln'}
                            </button>

                            <div className="sync-status">
                              <strong>Nächster Bohrabschnitt: Fantasiepatient → Supabase</strong>
                              <span>
                                Max Muster · 01.02.1970 · Schulter rechts. Vor dem Upload wird der komplette
                                Datensatz hier im Browser verschlüsselt.
                              </span>
                            </div>

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleSaveCryptoLabPatientToSupabase}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Fantasiepatient verschlüsselt in Supabase speichern
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleLoadCryptoLabPatientFromSupabase}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Aus Supabase laden + lokal entschlüsseln
                            </button>

                            {cryptoCloudCipherPreview && (
                              <div className="sync-status">
                                <strong>Von Supabase zurückgegeben – nur Chiffretext</strong>
                                <span style={{ overflowWrap: 'anywhere' }}>{cryptoCloudCipherPreview}</span>
                                {cryptoCloudUpdatedAt && (
                                  <span>Supabase-Stand: {formatDateTime(cryptoCloudUpdatedAt)}</span>
                                )}
                              </div>
                            )}

                            {cryptoCloudPatient && (
                              <div className="sync-status sync-status-active">
                                <strong>Auf diesem Gerät wieder lesbar</strong>
                                <span>
                                  {cryptoCloudPatient.firstName} {cryptoCloudPatient.lastName} ·
                                  {' '}{formatDate(cryptoCloudPatient.birthDate)} ·
                                  {' '}{cryptoCloudPatient.note}
                                </span>
                              </div>
                            )}

                            <div className="sync-status">
                              <strong>⛏️ Mini-Praxis: drei getrennte Tresorfächer</strong>
                              <span>
                                Patient „Erika Probe“ → Verordnung „MT“ → Doku „Schulter rechts …“.
                                Jeder Inhalt wird separat verschlüsselt; offen bleiben nur zufällige IDs und ihre Verknüpfungen.
                              </span>
                            </div>

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleSaveEncryptedMiniPractice}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Mini-Praxis verschlüsselt speichern
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleLoadEncryptedMiniPractice}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Mini-Praxis laden + lokal entschlüsseln
                            </button>

                            {cryptoMiniCipherSummary.length > 0 && (
                              <div className="sync-status">
                                <strong>Was Supabase technisch sehen darf</strong>
                                {cryptoMiniCipherSummary.map(item => (
                                  <span key={item.label}>
                                    {item.label}: ID {item.id.slice(0, 8)}… ·
                                    {' '}{item.chars} Zeichen Chiffretext
                                    {item.parent ? ` · verknüpft mit ${item.parent.slice(0, 8)}…` : ''}
                                  </span>
                                ))}
                              </div>
                            )}

                            {cryptoMiniPractice && (
                              <div className="sync-status sync-status-active">
                                <strong>Auf deinem Gerät wieder zusammengesetzt</strong>
                                <span>
                                  Patient: {cryptoMiniPractice.patient.firstName} {cryptoMiniPractice.patient.lastName} ·
                                  {' '}{formatDate(cryptoMiniPractice.patient.birthDate)}
                                </span>
                                <span>
                                  Verordnung: {formatDate(cryptoMiniPractice.prescription.issueDate)} ·
                                  {' '}{cryptoMiniPractice.prescription.remedy}
                                </span>
                                <span>
                                  Doku: {formatDate(cryptoMiniPractice.docEntry.entryDate)} ·
                                  {' '}{cryptoMiniPractice.docEntry.text}
                                </span>
                              </div>
                            )}

                            <div className="sync-status">
                              <strong>🌊 Mariannengraben: verschlüsselte Datei im Storage</strong>
                              <span>
                                Ein künstliches PDF mit „Erika Probe / Schulter rechts“ wird als echte PDF-Datei
                                erzeugt. Dateiname, Metadaten und Inhalt werden vor dem Upload getrennt verschlüsselt.
                              </span>
                            </div>

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleSaveEncryptedLabPdf}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Test-PDF verschlüsselt in Storage speichern
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleLoadEncryptedLabPdf}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Test-PDF laden + lokal entschlüsseln
                            </button>

                            {cryptoLabFileCipherInfo && (
                              <div className="sync-status">
                                <strong>Was Supabase von der Datei sieht</strong>
                                <span>
                                  Pfad: {cryptoLabFileCipherInfo.storagePath}
                                </span>
                                <span>
                                  Verschlüsseltes Storage-Paket: {cryptoLabFileCipherInfo.encryptedSize} Bytes ·
                                  {' '}Metadaten-Chiffretext: {cryptoLabFileCipherInfo.metadataChars} Zeichen
                                </span>
                              </div>
                            )}

                            {cryptoLabFileResult && (
                              <div className="sync-status sync-status-active">
                                <strong>Auf deinem Gerät wiederhergestellt</strong>
                                <span>
                                  {cryptoLabFileResult.fileName} ·
                                  {' '}{cryptoLabFileResult.mimeType} ·
                                  {' '}{cryptoLabFileResult.originalSize} Bytes
                                </span>
                                <span>SHA-256-Prüfung: bestanden</span>
                                {cryptoLabFileUrl && (
                                  <a
                                    className="btn btn-ghost"
                                    href={cryptoLabFileUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Entschlüsseltes Test-PDF öffnen
                                  </a>
                                )}
                              </div>
                            )}

                            <div className="sync-status">
                              <strong>🪨 Unter dem Browserboden: verschlüsseltes IndexedDB</strong>
                              <span>
                                Erst einmal online die verschlüsselte Mini-Praxis in eine separate Offline-Arbeitskopie übernehmen.
                                Danach darfst du für den eigentlichen Test sogar WLAN/Mobilfunk ausschalten.
                              </span>
                            </div>

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleSeedEncryptedOfflineCache}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Verschlüsselte Offline-Kopie anlegen
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleLoadEncryptedOfflineCache}
                              disabled={cryptoBusy}
                            >
                              Offline-Kopie laden + lokal entschlüsseln
                            </button>

                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={handleQueueEncryptedOfflineEdit}
                              disabled={cryptoBusy}
                            >
                              Offline-Doku ändern + verschlüsselt in Outbox
                            </button>

                            <button
                              type="button"
                              className="btn btn-green"
                              onClick={handleSyncEncryptedOfflineOutbox}
                              disabled={cryptoBusy || !cloudUser}
                            >
                              Verschlüsselte Outbox nach Supabase senden
                            </button>

                            {cryptoOfflineAudit && (
                              <div className={`sync-status ${cryptoOfflineAudit.safe ? 'sync-status-active' : 'sync-status-error'}`}>
                                <strong>Rohdatenprüfung IndexedDB</strong>
                                <span>
                                  Cache: {cryptoOfflineAudit.cacheCount} Datensätze ·
                                  {' '}Outbox: {cryptoOfflineAudit.outboxCount} ·
                                  {' '}Rohdaten: {cryptoOfflineAudit.rawChars} Zeichen
                                </span>
                                <span>
                                  Klartextfundstellen: {cryptoOfflineAudit.leaks.length}
                                  {cryptoOfflineAudit.safe ? ' – sauber' : ` – ${cryptoOfflineAudit.leaks.join(', ')}`}
                                </span>
                              </div>
                            )}

                            {cryptoOfflinePractice && (
                              <div className="sync-status sync-status-active">
                                <strong>Nur im Arbeitsspeicher wieder lesbar</strong>
                                <span>
                                  {cryptoOfflinePractice.patient.firstName} {cryptoOfflinePractice.patient.lastName} ·
                                  {' '}{formatDate(cryptoOfflinePractice.patient.birthDate)}
                                </span>
                                <span>
                                  {formatDate(cryptoOfflinePractice.prescription.issueDate)} ·
                                  {' '}{cryptoOfflinePractice.prescription.remedy}
                                </span>
                                <span>
                                  {formatDate(cryptoOfflinePractice.docEntry.entryDate)} ·
                                  {' '}{cryptoOfflinePractice.docEntry.text}
                                </span>
                              </div>
                            )}

                            {cryptoCipherPreview && (
                              <div className="sync-status">
                                <strong>So sieht nur der Chiffretext aus</strong>
                                <span style={{ overflowWrap: 'anywhere' }}>{cryptoCipherPreview}</span>
                              </div>
                            )}

                            {cryptoDecryptedText && (
                              <div className="sync-status sync-status-active">
                                <strong>Wieder entschlüsselt</strong>
                                <span>{cryptoDecryptedText}</span>
                              </div>
                            )}

                            <button type="button" className="btn btn-ghost" onClick={handleLockCryptoLab}>
                              Test-Praxisschlüssel sperren
                            </button>
                          </>
                        )}

                        {cryptoRecoveryCode && (
                          <div className="sync-status">
                            <strong>Wiederherstellungsschlüssel – nur für diesen Test</strong>
                            <span style={{ overflowWrap: 'anywhere' }}>{cryptoRecoveryCode}</span>
                            <span>
                              Er wird nur direkt nach dem Erzeugen angezeigt. Für den späteren echten Schlüssel
                              bauen wir dafür einen sicheren Datei-/Druck-Export.
                            </span>
                          </div>
                        )}

                        <button type="button" className="btn btn-ghost" onClick={handleResetCryptoLab}>
                          Verschlüsselungstest zurücksetzen
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isOwner && (
                  <div className="backup-card">
                    <h3>🔐 Vollständiges verschlüsseltes Supabase-Backup</h3>
                    <p>
                      Liest den aktuellen Praxisbestand direkt aus Supabase einschließlich Bilder, Befunde und
                      Bibliotheksdateien. Alles wird erst hier im Browser mit einem eigenen Backup-Passwort
                      verschlüsselt und anschließend als ZIP gespeichert.
                    </p>

                    <div className="stack-sm">
                      <input
                        className="field"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Backup-Passwort (mindestens 16 Zeichen)"
                        value={cloudBackupPassphrase}
                        onChange={event => setCloudBackupPassphrase(event.target.value)}
                      />
                      <input
                        className="field"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Backup-Passwort wiederholen"
                        value={cloudBackupPassphraseConfirm}
                        onChange={event => setCloudBackupPassphraseConfirm(event.target.value)}
                      />

                      <button
                        type="button"
                        className="btn btn-green"
                        onClick={handleCreateEncryptedCloudBackup}
                        disabled={cloudBackupBusy || !cloudUser}
                      >
                        {cloudBackupBusy ? 'Backup läuft …' : 'Verschlüsseltes Supabase-Vollbackup erstellen'}
                      </button>

                      <p className="muted">
                        Das Backup-Passwort wird nicht gespeichert und nicht an Supabase übertragen.
                        Bitte nicht hier im Chat mitteilen. Ohne dieses Passwort ist die ZIP später nicht lesbar.
                      </p>

                      {cloudBackupProgress && (
                        <div className="sync-status">
                          <strong>Status</strong>
                          <span>{cloudBackupProgress}</span>
                        </div>
                      )}

                      {cloudBackupSummary && (
                        <div className="sync-status sync-status-active">
                          <strong>Backup erstellt</strong>
                          <span>
                            Patienten: {cloudBackupSummary.counts.patients} ·
                            {' '}Verordnungen: {cloudBackupSummary.counts.prescriptions} ·
                            {' '}Doku: {cloudBackupSummary.counts.docEntries}
                          </span>
                          <span>
                            Doku-Bilder: {cloudBackupSummary.counts.docEntryImages} ·
                            {' '}Befunde: {cloudBackupSummary.counts.patientDocuments} ·
                            {' '}Bibliothek: {cloudBackupSummary.counts.libraryItems}
                          </span>
                          <span>
                            Dateieinträge: {cloudBackupSummary.fileCount} ·
                            {' '}Dateidaten: {formatByteCount(cloudBackupSummary.totalPlainFileBytes)} ·
                            {' '}ZIP: {formatByteCount(cloudBackupSummary.zipBytes)}
                          </span>
                          {cloudBackupSummary.missingDeletedFiles > 0 && (
                            <span>
                              Hinweis: {cloudBackupSummary.missingDeletedFiles} bereits gelöschte Dateireferenz(en)
                              hatten erwartungsgemäß keine Datei mehr im Storage.
                            </span>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => encryptedCloudBackupInputRef.current?.click()}
                        disabled={cloudBackupBusy}
                      >
                        Heruntergeladene ZIP vollständig prüfen
                      </button>

                      <input
                        ref={encryptedCloudBackupInputRef}
                        type="file"
                        accept=".zip,application/zip"
                        className="hidden"
                        onChange={handleVerifyEncryptedCloudBackup}
                      />

                      {cloudBackupVerification && (
                        <div className="sync-status sync-status-active">
                          <strong>✅ Wiederherstellungstest bestanden</strong>
                          <span>{cloudBackupVerificationFile}</span>
                          <span>
                            Patienten: {cloudBackupVerification.counts.patients} ·
                            {' '}Verordnungen: {cloudBackupVerification.counts.prescriptions} ·
                            {' '}Doku: {cloudBackupVerification.counts.docEntries}
                          </span>
                          <span>
                            Dateien geprüft: {cloudBackupVerification.verifiedFiles} ·
                            {' '}geprüfte Dateidaten: {formatByteCount(cloudBackupVerification.verifiedBytes)}
                          </span>
                          <span>
                            Dabei wurden keinerlei Tabellen oder Dateien in Supabase verändert.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isOwner && (
                  <div className="backup-card">
                    <h3>Einmalige Migration: altes ZIP → Supabase</h3>
                    <p>
                      Prüft ein vorhandenes vollständiges ZIP-Backup und übernimmt danach Patienten, Verordnungen,
                      Doku, Bilder, Befunde und Bibliothek in die neue Supabase-Struktur.
                    </p>

                    <div className="stack-sm">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => migrationInputRef.current?.click()}
                        disabled={migrationBusy}
                      >
                        Altes Voll-ZIP auswählen und prüfen
                      </button>

                      <input
                        ref={migrationInputRef}
                        type="file"
                        accept=".json,.zip,application/json,application/zip"
                        className="hidden"
                        onChange={handleSelectMigrationZip}
                      />

                      {migrationPreview && (
                        <div className="sync-status">
                          <strong>{migrationPreview.valid ? 'ZIP-Prüfung bestanden' : 'ZIP-Prüfung nicht bestanden'}</strong>
                          <span>{migrationPreview.fileName}</span>
                          <span>
                            Patienten: {migrationPreview.counts?.patients || 0} ·
                            {' '}Verordnungen: {migrationPreview.counts?.prescriptions || 0} ·
                            {' '}Doku: {migrationPreview.counts?.documentationEntries || 0}
                          </span>
                          <span>
                            Bilder: {migrationPreview.counts?.images || 0} ·
                            {' '}Befunde: {migrationPreview.counts?.patientDocuments || 0} ·
                            {' '}Bibliothek: {migrationPreview.counts?.libraryItems || 0}
                          </span>

                          {migrationPreview.blockingIssues?.map((issue, index) => (
                            <span key={index}>⚠️ {issue}</span>
                          ))}
                        </div>
                      )}

                      {migrationProgress && (
                        <p className="muted"><strong>Status:</strong> {migrationProgress}</p>
                      )}

                      {migrationPreview?.valid && (
                        <button
                          type="button"
                          className="btn btn-green"
                          onClick={handleRunMigration}
                          disabled={migrationBusy}
                        >
                          {migrationBusy ? 'Migration läuft …' : 'Migration nach Supabase starten'}
                        </button>
                      )}
                    </div>

                    <p className="muted">
                      Für den Test bitte nur ein Backup mit Fantasie-/Testdaten verwenden. Das echte Praxis-Backup bleibt
                      bis zur Sicherheits-Endrunde unangetastet.
                    </p>
                  </div>
                )}

                <div className="backup-card">
                  <h3>Komplettes ZIP-Backup</h3>
                  <p>
                    Exportiert alle lokalen Daten vollständig: Patienten, Verordnungen, Doku, Bilder, Dokumente/Befunde und Bibliothek.
                  </p>

                  <div className="stack-sm">
                    <button className="btn btn-secondary" onClick={handleExportBackup}>
                      ZIP-Backup exportieren
                    </button>

                    <button className="btn btn-ghost" onClick={() => importInputRef.current?.click()}>
                      ZIP-Backup importieren
                    </button>

                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".json,.zip,application/json,application/zip"
                      className="hidden"
                      onChange={handleImportFile}
                    />
                  </div>
                </div>

                <div className="backup-card">
                  <h3>ZIP-Änderungs-Backup</h3>
                  <p>
                    Tablet-freundlicher Änderungs-Export ohne Verschlüsselung. Exportiert nur neue oder geänderte Einträge seit dem letzten Änderungs-Export.
                  </p>

                  <p className="muted">
                    Letzte Änderung: <strong>{formatDateTime(lastModifiedAt)}</strong>
                  </p>

                  <p className="muted">
                    Letzter Änderungs-Export: <strong>{formatDateTime(lastEncryptedExportAt)}</strong>
                  </p>

                  <div className="stack-sm">
                    <button className="btn btn-secondary" onClick={handleExportChangeZip}>
                      ZIP-Änderungen exportieren
                    </button>

                    <button className="btn btn-ghost" onClick={() => changeZipImportRef.current?.click()}>
                      ZIP-Änderungen importieren
                    </button>

                    <input
                      ref={changeZipImportRef}
                      type="file"
                      accept=".json,.zip,application/json,application/zip"
                      className="hidden"
                      onChange={handleImportChangeZip}
                    />
                  </div>
                </div>

                <div><button className="btn btn-ghost" onClick={goPatients}>Zurück zur Patientenliste</button></div>
              </section>
            )}

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

                  {isOwner && !v3ReadMode && (
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
                  )}
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
  			onOpen={async () => {
          try {
            const loaded = (v3ReadModeRef.current || v3PrimaryModeRef.current)
              ? await loadV3LibraryItemFile(item, v3PracticeKeyRef.current)
              : await loadLibraryItemFile(item)
            openStoredFile(loaded.file)
          } catch (e) {
            setError(`Datei konnte nicht geladen werden: ${e.message}`)
          }
        }}
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

            {nav === 'patients' && view === 'list' && (
              <section className="list-layout">
                <article className="surface-card">
                  <h2 className="section-title">Patientenliste</h2>

                  <div className="patient-actions">
                    <div className="search-row">
                      <div className="search-wrap">
                        <Search size={16} className="search-icon" />
                        <input
                          className="search-input"
                          placeholder="Patient suchen"
                          value={query}
                          onChange={event => setQuery(event.target.value)}
                        />
                      </div>
                      <button type="button" className="btn btn-search" aria-label="Patient suchen">
                        <Search size={16} />
                      </button>
                    </div>

                    {!v3ReadMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setPatientForm(EMPTY_PATIENT_FORM)
                          setSelectedPatient(null)
                          setPatientConflict(null)
                          setView('patientEdit')
                        }}
                        className="btn btn-primary add-patient-btn"
                      >
                        <Plus size={18} />
                        Patient hinzufügen
                      </button>
                    )}
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
                    <p>
                      Backups und Änderungs-Exporte findest du jetzt gesammelt im Menüpunkt Backup.
                    </p>

                    <p className="muted">
                      Letzte Änderung: <strong>{formatDateTime(lastModifiedAt)}</strong>
                    </p>

                    <button className="btn btn-ghost" onClick={() => { setNav('backup'); setView('backup') }}>
                      Zum Backup-Bereich
                    </button>
                  </div>
                </article>
              </section>
            )}

            {nav === 'trash' && view === 'trash' && canManageTrash && (
              <section className="surface-card stack-lg">
                <div>
                  <h2 className="section-title">Papierkorb</h2>
                  <p className="muted">
                    Hier wurde noch nichts endgültig gelöscht. Verordnungen, Dokumentationen, Bilder und Befunde bleiben vollständig erhalten.
                  </p>
                </div>

                <button className="btn btn-ghost-inline" onClick={goPatients}>
                  <ArrowLeft size={16} />
                  Zurück zur Patientenliste
                </button>

                <div className="stack">
                  {deletedPatients.length === 0 ? (
                    <p className="muted">Der Papierkorb ist leer.</p>
                  ) : (
                    deletedPatients.map(patient => (
                      <article key={patient.id} className="trash-patient-card">
                        <div>
                          <p className="trash-patient-name">{patient.lastName}, {patient.firstName}</p>
                          <p className="muted">Geboren: {formatDate(patient.birthDate)}</p>
                          <p className="muted">Verschoben: {formatDateTime(patient.deletedAt)}</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => handleRestorePatient(patient)}
                          disabled={saving}
                        >
                          <RotateCcw size={15} />
                          Wiederherstellen
                        </button>
                      </article>
                    ))
                  )}
                </div>

                <div className="trash-safety-note">
                  Endgültiges Löschen ist absichtlich noch nicht freigeschaltet.
                </div>
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

                    {!v3ReadMode && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setPatientForm(selectedPatient)
                          setPatientConflict(null)
                          setView('patientEdit')
                        }}
                      >
                        <Edit3 size={14} />
                        Bearbeiten
                      </button>
                    )}
                  </div>
                </article>

                {isOwner && (
                  <article className="surface-card card-patient-documents">
                    <div className="row-between prescription-header">
                      <h3 className="section-subtitle">Dokumente / Befunde</h3>
                      {!v3ReadMode && (
                        <button
                          className="btn btn-green"
                          onClick={() => {
                            setPatientDocumentForm({
                              ...EMPTY_PATIENT_DOCUMENT_FORM,
                              documentDate: todayIso(),
                            })
                            setPatientDocumentBase(null)
                            setPatientDocumentConflict(null)
                            setView('patientDocumentEdit')
                          }}
                        >
                          <Plus size={14} />
                          Dokument
                        </button>
                      )}
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
                            onOpen={async () => {
  try {
    if (v3ReadModeRef.current) {
      if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
      const loaded = await loadV3PatientDocumentFile(item, v3PracticeKeyRef.current)
      openStoredFile(loaded.file)
      return
    }

    if (v3PrimaryModeRef.current) {
      if (!v3PracticeKeyRef.current) throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
      const loaded = await loadV3PatientDocumentFile(item, v3PracticeKeyRef.current)
      setPatientDocumentForm(loaded)
      setPatientDocumentBase(item)
      setPatientDocumentConflict(null)
      setView('patientDocumentEdit')
      return
    }

    const loaded = await loadPatientDocumentFile(item)
    setPatientDocumentForm(loaded)
    setPatientDocumentBase(item)
    setPatientDocumentConflict(null)
    setView('patientDocumentEdit')
  } catch (e) {
    setError(`Dokument konnte nicht geladen werden: ${e.message}`)
  }
}}
                          />
                        ))
                      )}
                    </div>
                  </article>
                )}
 <article className="surface-card">
                  <div className="row-between prescription-header">
                    <h3 className="section-subtitle">Verordnungen</h3>
                    {!v3ReadMode && (
                      <button
                        className="btn btn-green"
                        onClick={() => {
                          setPrescriptionForm(EMPTY_PRESCRIPTION_FORM)
                          setSelectedPrescription(null)
                          setPrescriptionConflict(null)
                          setView('prescriptionEdit')
                        }}
                      >
                        <Plus size={16} />
                        Verordnung
                      </button>
                    )}
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
                        <Printer size={14} />
                      </button>
{!v3ReadMode && (
  <button
    type="button"
    className="btn btn-ghost"
    onClick={() => {
      setPrescriptionForm(selectedPrescription)
      setPrescriptionConflict(null)
      setView('prescriptionEdit')
    }}
  >
    <Edit3 size={14} />
    Bearbeiten
  </button>
)}
                    </div>
                  </article>

                  {!v3ReadMode && (
                    <button
                      className="btn btn-green full"
                      onClick={() => {
                        setDocForm(EMPTY_DOC_FORM)
                        setDocBaseEntry(null)
                        setDocConflict(null)
                        setDocImages([])
                        setDocImageBaseIds([])
                        setView('docEdit')
                      }}
                    >
                      <Plus size={16} />
                      Doku
                    </button>
                  )}

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
                            try {
                              setDocForm(value)
                              setDocBaseEntry(value)
                              setDocConflict(null)

                              if (v3ReadModeRef.current) {
                                if (!v3PracticeKeyRef.current) {
                                  throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
                                }
                                const images = await loadV3DocEntryImages(
                                  value.id,
                                  v3PracticeKeyRef.current,
                                )
                                setDocImages(images)
                                setDocImageBaseIds([])
                                setView('v3DocRead')
                                return
                              }

                              if (v3PrimaryModeRef.current) {
                                if (!v3PracticeKeyRef.current) {
                                  throw new Error('V3-Praxisschlüssel ist nicht entsperrt.')
                                }
                                const images = await loadV3DocEntryImages(
                                  value.id,
                                  v3PracticeKeyRef.current,
                                )
                                setDocImages(images)
                                setDocImageBaseIds(images.map(image => image.id))
                                setView('docEdit')
                                return
                              }

                              const images = await loadDocEntryImagesFromSupabase(value.id)
                              setDocImages(images)
                              setDocImageBaseIds(images.map(image => image.id))
                              setView('docEdit')
                            } catch (e) {
                              setError(`Doku konnte nicht geöffnet werden: ${e.message}`)
                            }
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

            {view === 'v3DocRead' && v3ReadMode && selectedPrescription && (
              <section className="stack">
                <button
                  type="button"
                  className="btn btn-ghost-inline"
                  onClick={() => setView('prescriptionDetail')}
                >
                  <ArrowLeft size={16} />
                  Zurück zur Verordnung
                </button>

                <article className="surface-card stack">
                  <div>
                    <p className="muted">{formatDate(docForm.entryDate)}</p>
                    <h2 className="section-title">Dokumentation – nur lesen</h2>
                  </div>

                  <p className="pre">{docForm.text || 'Ohne Text'}</p>

                  {docImages.length > 0 && (
                    <div className="stack">
                      <h3 className="section-subtitle">Bilder</h3>
                      {docImages.map(image => (
                        <div key={image.id} className="sync-status">
                          <strong>{image.fileName || 'Bild'}</strong>
                          {image.dataUrl && (
                            <img
                              src={image.dataUrl}
                              alt={image.fileName || 'Doku-Bild'}
                              style={{ width: '100%', height: 'auto', borderRadius: 12 }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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

                  {patientConflict && (
                    <div className="sync-conflict-box">
                      <strong>Änderung auf einem anderen Gerät erkannt.</strong>
                      <p>Deine offenen Eingaben wurden nicht überschrieben.</p>
                      <p>
                        Aktueller Stand: {patientConflict.lastName}, {patientConflict.firstName}
                        {' · '}{formatDate(patientConflict.birthDate)}
                      </p>
                      <button type="button" className="btn btn-ghost" onClick={handleLoadPatientConflict}>
                        Aktuellen Stand laden
                      </button>
                    </div>
                  )}

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

                 <DateInput
  		value={patientForm.birthDate}
  		onChange={value => setPatientForm(prev => ({ ...prev, birthDate: value }))}
		/>

                  <button className="btn btn-primary" disabled={saving || Boolean(patientConflict)}>
                    <Save size={16} />
                    {saving ? 'Speichern...' : 'Speichern'}
                  </button>

                  {selectedPatient && canManageTrash && (
                    <div className="trash-action-box">
                      <p>
                        Der Patient wird nur aus der aktiven Liste entfernt. Alle zugehörigen Daten bleiben wiederherstellbar.
                      </p>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={handleMovePatientToTrash}
                        disabled={saving}
                      >
                        <Trash2 size={16} />
                        In den Papierkorb verschieben
                      </button>
                    </div>
                  )}

                  {selectedPatient && isOwner && !cloudUser && (
                    <p className="muted trash-login-note">
                      Für den Papierkorb bitte zuerst im Bereich Backup mit deinem Supabase-Konto anmelden.
                    </p>
                  )}
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

                  <h2 className="section-title">{patientDocumentBase ? 'Dokument / Befund bearbeiten' : 'Neues Dokument / neuer Befund'}</h2>

                  {patientDocumentConflict && (
                    <div className="sync-conflict-box">
                      <strong>Änderung auf einem anderen Gerät erkannt.</strong>
                      <p>Deine offenen Eingaben wurden nicht überschrieben.</p>
                      <p>
                        Aktueller Stand: {formatDate(patientDocumentConflict.documentDate)} · {patientDocumentConflict.title}
                      </p>
                      <button type="button" className="btn btn-ghost" onClick={handleLoadPatientDocumentConflict}>
                        Aktuellen Stand laden
                      </button>
                    </div>
                  )}

              <DateInput
  		value={patientDocumentForm.documentDate}
 		 onChange={value =>
  		  setPatientDocumentForm(prev => ({
   		   ...prev,
   		   documentDate: value,
   		 }))
 		 }
		/>

		<input
  		className="field"
  		placeholder="Kurze Überschrift, z. B. MRT Schulter rechts"
 		 value={patientDocumentForm.title}
 		 onChange={event =>
  		  setPatientDocumentForm(prev => ({
   		   ...prev,
    		  title: event.target.value,
   		 }))
 		 }
		/>

<textarea
  className="field library-note"
  placeholder="Notiz optional"
  value={patientDocumentForm.note}
  onChange={event =>
    setPatientDocumentForm(prev => ({
      ...prev,
      note: event.target.value,
    }))
  }
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

{patientDocumentForm.file && (
  <div className="image-card">
    {patientDocumentForm.file.mimeType?.startsWith('image/') ? (
      <img
        src={patientDocumentForm.file.dataUrl}
        alt={patientDocumentForm.file.fileName}
        className="image-preview"
        onClick={() =>
          setFullscreenImage(patientDocumentForm.file.dataUrl)
        }
      />
    ) : (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => openStoredFile(patientDocumentForm.file)}
      >
        <FileText size={20} />
        PDF öffnen
      </button>
    )}

    <p className="image-name">
      {patientDocumentForm.file.fileName}
    </p>

    <button
      type="button"
      className="btn btn-danger"
      onClick={() =>
        setPatientDocumentForm(prev => ({
          ...prev,
          file: null,
        }))
      }
    >
      Datei entfernen
    </button>
  </div>
)}


                  <div className="row-end">
                    <button type="button" className="btn btn-ghost" onClick={() => setView('patientDetail')}>Abbrechen</button>
                    <button className="btn btn-primary" disabled={saving || Boolean(patientDocumentConflict)}>
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

                  {prescriptionConflict && (
                    <div className="sync-conflict-box">
                      <strong>Änderung auf einem anderen Gerät erkannt.</strong>
                      <p>Deine offenen Eingaben wurden nicht überschrieben.</p>
                      <p>
                        Aktueller Stand: {formatDate(prescriptionConflict.issueDate)} · {prescriptionConflict.remedy}
                      </p>
                      <button type="button" className="btn btn-ghost" onClick={handleLoadPrescriptionConflict}>
                        Aktuellen Stand laden
                      </button>
                    </div>
                  )}

                 <DateInput
  			value={prescriptionForm.issueDate}
  			onChange={value => setPrescriptionForm(prev => ({ ...prev, issueDate: value }))}
		 />

                  <input
                    className="field"
                    placeholder="Heilmittel"
                    value={prescriptionForm.remedy}
                    onChange={event => setPrescriptionForm(prev => ({ ...prev, remedy: event.target.value }))}
                  />

                  <button className="btn btn-primary" disabled={saving || Boolean(prescriptionConflict)}>
                    <Save size={16} />
                    {saving ? 'Speichern...' : 'Speichern'}
                  </button>
                </form>
              </section>
            )}

           {view === 'docEdit' && selectedPrescription && (
  <DocumentationEditor
    docForm={docForm}
    setDocForm={setDocForm}
    docTextareaRef={docTextareaRef}
    handleSaveDocEntry={handleSaveDocEntry}
    setView={setView}
    toolbarInserts={TOOLBAR_INSERTS}
    insertSymbolText={insertSymbolText}
    isOwner={isOwner}
    docImages={docImages}
    handleImageUpload={handleImageUpload}
    setFullscreenImage={setFullscreenImage}
    handleRemoveImage={handleRemoveImage}
    saving={saving}
    conflict={docConflict}
    onLoadConflict={handleLoadDocConflict}
  />
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
