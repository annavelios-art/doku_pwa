import { supabase } from './supabase'
import {
  decryptBytesWithPassphrase,
  encryptBytesWithPassphrase,
  sha256Hex,
} from './v2Crypto'

const BUCKET = 'doku-vault'
const BACKUP_FILE_NAME = 'physiooptima-backup.enc.json'
const BACKUP_CONTEXT = 'physiooptima:v2:full-supabase-backup'
const WRAPPER_FORMAT = 'physiooptima-encrypted-supabase-backup'
const PAYLOAD_FORMAT = 'physiooptima-supabase-backup-payload'
const VERSION = 1

const TABLE_SPECS = [
  {
    key: 'patients',
    table: 'patients',
    select: 'id,first_name,last_name,birth_date,created_by,created_at,updated_at,deleted_at',
  },
  {
    key: 'prescriptions',
    table: 'prescriptions',
    select: 'id,patient_id,prescription_date,remedy,created_by,created_at,updated_at,deleted_at',
  },
  {
    key: 'docEntries',
    table: 'doc_entries',
    select: 'id,prescription_id,entry_date,text,created_by,created_at,updated_at,deleted_at',
  },
  {
    key: 'docEntryImages',
    table: 'doc_entry_images',
    select: 'id,doc_entry_id,file_name,mime_type,storage_path,created_by,created_at,updated_at,deleted_at',
  },
  {
    key: 'patientDocuments',
    table: 'patient_documents',
    select: 'id,patient_id,document_date,title,note,file_name,mime_type,storage_path,created_by,created_at,updated_at,deleted_at',
  },
  {
    key: 'libraryItems',
    table: 'library_items',
    select: 'id,category,title,description,file_name,mime_type,storage_path,created_by,created_at,updated_at,deleted_at',
  },
]

const FILE_SPECS = [
  { tableKey: 'docEntryImages', sourceTable: 'doc_entry_images' },
  { tableKey: 'patientDocuments', sourceTable: 'patient_documents' },
  { tableKey: 'libraryItems', sourceTable: 'library_items' },
]

function countMap(tables) {
  return {
    patients: tables.patients?.length || 0,
    prescriptions: tables.prescriptions?.length || 0,
    docEntries: tables.docEntries?.length || 0,
    docEntryImages: tables.docEntryImages?.length || 0,
    patientDocuments: tables.patientDocuments?.length || 0,
    libraryItems: tables.libraryItems?.length || 0,
  }
}

function assertCounts(expected, actual) {
  for (const key of Object.keys(actual)) {
    if ((expected?.[key] ?? -1) !== actual[key]) {
      throw new Error(`Backup-Prüfung: Anzahl ${key} stimmt nicht (${expected?.[key]} ≠ ${actual[key]}).`)
    }
  }
}

function assertRelations(tables) {
  const patientIds = new Set((tables.patients || []).map(row => row.id))
  const prescriptionIds = new Set((tables.prescriptions || []).map(row => row.id))
  const docEntryIds = new Set((tables.docEntries || []).map(row => row.id))

  for (const row of tables.prescriptions || []) {
    if (!patientIds.has(row.patient_id)) {
      throw new Error(`Backup-Prüfung: Verordnung ${row.id} verweist auf fehlenden Patienten.`)
    }
  }

  for (const row of tables.docEntries || []) {
    if (!prescriptionIds.has(row.prescription_id)) {
      throw new Error(`Backup-Prüfung: Doku ${row.id} verweist auf fehlende Verordnung.`)
    }
  }

  for (const row of tables.docEntryImages || []) {
    if (!docEntryIds.has(row.doc_entry_id)) {
      throw new Error(`Backup-Prüfung: Doku-Bild ${row.id} verweist auf fehlende Doku.`)
    }
  }

  for (const row of tables.patientDocuments || []) {
    if (!patientIds.has(row.patient_id)) {
      throw new Error(`Backup-Prüfung: Befund ${row.id} verweist auf fehlenden Patienten.`)
    }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      const comma = value.indexOf(',')
      if (comma < 0) {
        reject(new Error('Datei konnte nicht für das Backup kodiert werden.'))
        return
      }
      resolve(value.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht für das Backup gelesen werden.'))
    reader.readAsDataURL(blob)
  })
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function fetchTables(userId, onProgress) {
  const tables = {}

  for (let i = 0; i < TABLE_SPECS.length; i += 1) {
    const spec = TABLE_SPECS[i]
    onProgress?.(`Lese Tabelle ${i + 1}/${TABLE_SPECS.length}: ${spec.table} …`)

    const { data, error } = await supabase
      .from(spec.table)
      .select(spec.select)
      .eq('created_by', userId)

    if (error) throw error
    tables[spec.key] = data || []
  }

  return tables
}

function collectFileReferences(tables) {
  const refs = []

  for (const spec of FILE_SPECS) {
    for (const row of tables[spec.tableKey] || []) {
      if (!row.storage_path) continue
      refs.push({
        sourceTable: spec.sourceTable,
        rowId: row.id,
        storagePath: row.storage_path,
        fileName: row.file_name || '',
        mimeType: row.mime_type || 'application/octet-stream',
        deletedAt: row.deleted_at || '',
      })
    }
  }

  return refs
}

async function downloadFiles(refs, onProgress) {
  const files = []
  let totalPlainBytes = 0
  let missingDeletedFiles = 0

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]
    onProgress?.(`Sichere Datei ${i + 1}/${refs.length} …`)

    const { data, error } = await supabase.storage.from(BUCKET).download(ref.storagePath)

    if (error) {
      if (ref.deletedAt) {
        missingDeletedFiles += 1
        files.push({
          ...ref,
          missing: true,
          size: 0,
          sha256: '',
          dataBase64: '',
        })
        continue
      }

      throw new Error(
        `Aktive Datei konnte nicht gesichert werden (${ref.sourceTable}, ${ref.rowId}): ${error.message}`,
      )
    }

    const bytes = new Uint8Array(await data.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    const dataBase64 = await blobToBase64(new Blob([bytes], { type: 'application/octet-stream' }))
    totalPlainBytes += bytes.byteLength

    files.push({
      ...ref,
      missing: false,
      size: bytes.byteLength,
      sha256,
      dataBase64,
    })
  }

  return { files, totalPlainBytes, missingDeletedFiles }
}

function makeZip(fileName, bytesInput) {
  const fileNameBytes = new TextEncoder().encode(fileName)
  const dataBytes = bytesInput instanceof Uint8Array
    ? bytesInput
    : new Uint8Array(bytesInput)

  const table = new Uint32Array(256).map((_, i) => {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })

  let crc = 0xffffffff
  for (let i = 0; i < dataBytes.length; i += 1) {
    crc = table[(crc ^ dataBytes[i]) & 0xff] ^ (crc >>> 8)
  }
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

async function readZipSingleFile(file) {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  if (bytes.length < 30 || view.getUint32(0, true) !== 0x04034b50) {
    throw new Error('Die Datei ist kein unterstütztes ZIP-Backup.')
  }

  const compressionMethod = view.getUint16(8, true)
  const compressedSize = view.getUint32(18, true)
  const fileNameLength = view.getUint16(26, true)
  const extraLength = view.getUint16(28, true)
  const fileNameStart = 30
  const fileNameEnd = fileNameStart + fileNameLength
  const fileName = new TextDecoder().decode(bytes.slice(fileNameStart, fileNameEnd))
  const dataStart = fileNameEnd + extraLength
  const dataEnd = dataStart + compressedSize

  if (fileName !== BACKUP_FILE_NAME) {
    throw new Error('ZIP enthält kein PhysioOptima-Vollbackup.')
  }
  if (compressionMethod !== 0) {
    throw new Error('Dieses Backup verwendet eine nicht unterstützte ZIP-Kompression.')
  }
  if (dataEnd > bytes.length) {
    throw new Error('ZIP ist unvollständig oder beschädigt.')
  }

  return bytes.slice(dataStart, dataEnd)
}

function makeBackupFileName(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    'PhysioOptima_Supabase_Backup_',
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    '.zip',
  ].join('')
}

export async function createEncryptedSupabaseBackup(userId, passphrase, onProgress) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!navigator.onLine) throw new Error('Für das Cloud-Backup wird eine Internetverbindung benötigt.')

  onProgress?.('Lese vollständigen Supabase-Datenbestand …')
  const tables = await fetchTables(userId, onProgress)
  assertRelations(tables)

  const refs = collectFileReferences(tables)
  const {
    files,
    totalPlainBytes,
    missingDeletedFiles,
  } = await downloadFiles(refs, onProgress)

  const counts = countMap(tables)
  const exportedAt = new Date().toISOString()
  const payload = {
    format: PAYLOAD_FORMAT,
    version: VERSION,
    exportedAt,
    sourceOwnerId: userId,
    manifest: {
      counts,
      fileCount: files.length,
      missingDeletedFiles,
      totalPlainFileBytes: totalPlainBytes,
    },
    tables,
    files,
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))

  onProgress?.('Verschlüssele vollständiges Backup lokal im Browser …')
  const encrypted = await encryptBytesWithPassphrase(
    payloadBytes,
    passphrase,
    BACKUP_CONTEXT,
  )

  const wrapper = {
    format: WRAPPER_FORMAT,
    version: VERSION,
    encryption: encrypted,
  }

  const wrapperBytes = new TextEncoder().encode(JSON.stringify(wrapper))
  const zipBlob = makeZip(BACKUP_FILE_NAME, wrapperBytes)

  onProgress?.('Verschlüsseltes ZIP ist fertig.')

  return {
    zipBlob,
    fileName: makeBackupFileName(),
    summary: {
      counts,
      fileCount: files.length,
      missingDeletedFiles,
      totalPlainFileBytes: totalPlainBytes,
      zipBytes: zipBlob.size,
      exportedAt,
    },
  }
}

export async function verifyEncryptedSupabaseBackup(file, passphrase, onProgress) {
  onProgress?.('Öffne verschlüsseltes ZIP …')
  const wrapperBytes = await readZipSingleFile(file)
  const wrapper = JSON.parse(new TextDecoder().decode(wrapperBytes))

  if (wrapper.format !== WRAPPER_FORMAT || wrapper.version !== VERSION) {
    throw new Error('Unbekanntes oder veraltetes PhysioOptima-Backupformat.')
  }

  onProgress?.('Entschlüssele Backup lokal im Browser …')
  const payloadBytes = await decryptBytesWithPassphrase(
    wrapper.encryption,
    passphrase,
    BACKUP_CONTEXT,
  )
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes))
  if (payload.format !== PAYLOAD_FORMAT || payload.version !== VERSION) {
    throw new Error('Entschlüsselter Backup-Inhalt hat ein unbekanntes Format.')
  }

  const counts = countMap(payload.tables || {})
  assertCounts(payload.manifest?.counts, counts)
  assertRelations(payload.tables || {})

  let verifiedFiles = 0
  let missingDeletedFiles = 0
  let verifiedBytes = 0

  for (let i = 0; i < (payload.files || []).length; i += 1) {
    const item = payload.files[i]
    onProgress?.(`Prüfe gesicherte Datei ${i + 1}/${payload.files.length} …`)

    if (item.missing) {
      if (!item.deletedAt) {
        throw new Error(`Backup enthält eine fehlende aktive Datei: ${item.sourceTable}/${item.rowId}`)
      }
      missingDeletedFiles += 1
      continue
    }

    const bytes = base64ToBytes(item.dataBase64)
    if (bytes.byteLength !== item.size) {
      throw new Error(`Dateigröße stimmt nicht: ${item.sourceTable}/${item.rowId}`)
    }

    const hash = await sha256Hex(bytes)
    if (hash !== item.sha256) {
      throw new Error(`Datei-Prüfsumme stimmt nicht: ${item.sourceTable}/${item.rowId}`)
    }

    verifiedFiles += 1
    verifiedBytes += bytes.byteLength
  }

  if ((payload.files || []).length !== (payload.manifest?.fileCount ?? -1)) {
    throw new Error('Anzahl der Dateieinträge stimmt nicht mit dem verschlüsselten Manifest überein.')
  }
  if (missingDeletedFiles !== (payload.manifest?.missingDeletedFiles || 0)) {
    throw new Error('Anzahl fehlender gelöschter Dateien stimmt nicht überein.')
  }
  if (verifiedBytes !== (payload.manifest?.totalPlainFileBytes || 0)) {
    throw new Error('Gesamtgröße der gesicherten Dateien stimmt nicht überein.')
  }

  onProgress?.('Wiederherstellungstest bestanden.')

  return {
    counts,
    fileCount: payload.files?.length || 0,
    verifiedFiles,
    missingDeletedFiles,
    verifiedBytes,
    exportedAt: payload.exportedAt || '',
    sourceOwnerId: payload.sourceOwnerId || '',
  }
}
