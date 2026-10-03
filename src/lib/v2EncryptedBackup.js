import { supabase } from './supabase'
import {
  createBackupPassphraseKey,
  decryptBackupBytesRaw,
  encryptBackupBytesRaw,
  sha256Hex,
  unlockBackupPassphraseKey,
} from './v2Crypto'

const BUCKET = 'doku-vault'
const HEADER_ENTRY = 'header.json'
const MANIFEST_ENTRY = 'manifest.bin'
const HEADER_FORMAT = 'physiooptima-encrypted-supabase-backup'
const MANIFEST_FORMAT = 'physiooptima-supabase-backup-manifest'
const VERSION = 2

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

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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
      throw new Error(
        `Backup-Prüfung: Anzahl ${key} stimmt nicht (${expected?.[key]} ≠ ${actual[key]}).`,
      )
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

let crcTable = null

function getCrcTable() {
  if (crcTable) return crcTable

  crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    crcTable[i] = c >>> 0
  }

  return crcTable
}

function crc32(bytes) {
  const table = getCrcTable()
  let crc = 0xffffffff

  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function localZipHeader(nameBytes, dataLength, crc) {
  const bytes = new Uint8Array(30 + nameBytes.length)
  const view = new DataView(bytes.buffer)
  let offset = 0

  const u16 = value => { view.setUint16(offset, value, true); offset += 2 }
  const u32 = value => { view.setUint32(offset, value, true); offset += 4 }

  u32(0x04034b50)
  u16(20)
  u16(0)
  u16(0)
  u16(0)
  u16(0)
  u32(crc)
  u32(dataLength)
  u32(dataLength)
  u16(nameBytes.length)
  u16(0)
  bytes.set(nameBytes, offset)

  return bytes
}

function centralZipHeader(entry) {
  const nameBytes = encoder.encode(entry.name)
  const bytes = new Uint8Array(46 + nameBytes.length)
  const view = new DataView(bytes.buffer)
  let offset = 0

  const u16 = value => { view.setUint16(offset, value, true); offset += 2 }
  const u32 = value => { view.setUint32(offset, value, true); offset += 4 }

  u32(0x02014b50)
  u16(20)
  u16(20)
  u16(0)
  u16(0)
  u16(0)
  u16(0)
  u32(entry.crc)
  u32(entry.size)
  u32(entry.size)
  u16(nameBytes.length)
  u16(0)
  u16(0)
  u16(0)
  u16(0)
  u32(0)
  u32(entry.offset)
  bytes.set(nameBytes, offset)

  return bytes
}

export class StoredZipBuilder {
  constructor() {
    this.parts = []
    this.entries = []
    this.offset = 0
  }

  add(name, dataInput) {
    const data = dataInput instanceof Uint8Array
      ? dataInput
      : new Uint8Array(dataInput)
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)
    const header = localZipHeader(nameBytes, data.byteLength, crc)
    const entryOffset = this.offset

    this.parts.push(header)
    this.parts.push(new Blob([data], { type: 'application/octet-stream' }))
    this.offset += header.byteLength + data.byteLength

    this.entries.push({
      name,
      crc,
      size: data.byteLength,
      offset: entryOffset,
    })
  }

  finish() {
    const centralStart = this.offset
    let centralSize = 0
    const centralParts = []

    for (const entry of this.entries) {
      const header = centralZipHeader(entry)
      centralParts.push(header)
      centralSize += header.byteLength
    }

    const end = new Uint8Array(22)
    const view = new DataView(end.buffer)
    let offset = 0
    const u16 = value => { view.setUint16(offset, value, true); offset += 2 }
    const u32 = value => { view.setUint32(offset, value, true); offset += 4 }

    u32(0x06054b50)
    u16(0)
    u16(0)
    u16(this.entries.length)
    u16(this.entries.length)
    u32(centralSize)
    u32(centralStart)
    u16(0)

    return new Blob(
      [...this.parts, ...centralParts, end],
      { type: 'application/zip' },
    )
  }
}

async function readSliceBytes(blob, start, length) {
  return new Uint8Array(
    await blob.slice(start, start + length).arrayBuffer(),
  )
}

async function readUint32At(blob, offset) {
  const bytes = await readSliceBytes(blob, offset, 4)
  if (bytes.byteLength < 4) return null
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
}

export async function indexStoredZip(file) {
  const entries = new Map()
  let offset = 0

  while (offset + 4 <= file.size) {
    const signature = await readUint32At(file, offset)
    if (signature === 0x02014b50 || signature === 0x06054b50 || signature === null) break
    if (signature !== 0x04034b50) {
      throw new Error('ZIP-Struktur ist unbekannt oder beschädigt.')
    }

    const header = await readSliceBytes(file, offset, 30)
    if (header.byteLength !== 30) throw new Error('ZIP-Kopf ist unvollständig.')
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)

    const compressionMethod = view.getUint16(8, true)
    const compressedSize = view.getUint32(18, true)
    const uncompressedSize = view.getUint32(22, true)
    const fileNameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)

    if (compressionMethod !== 0 || compressedSize !== uncompressedSize) {
      throw new Error('Backup-ZIP verwendet eine nicht unterstützte Kompression.')
    }

    const nameBytes = await readSliceBytes(file, offset + 30, fileNameLength)
    const name = decoder.decode(nameBytes)
    const dataStart = offset + 30 + fileNameLength + extraLength
    const dataEnd = dataStart + compressedSize

    if (dataEnd > file.size) {
      throw new Error('Backup-ZIP ist unvollständig.')
    }

    entries.set(name, {
      name,
      start: dataStart,
      size: compressedSize,
    })

    offset = dataEnd
  }

  return entries
}

export async function readIndexedEntry(file, entries, name) {
  const entry = entries.get(name)
  if (!entry) throw new Error(`Backup-ZIP enthält ${name} nicht.`)
  return readSliceBytes(file, entry.start, entry.size)
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

function fileAad(backupId, index) {
  return `physiooptima:v2:backup:${backupId}:file:${index}`
}

function manifestAad(backupId) {
  return `physiooptima:v2:backup:${backupId}:manifest`
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export async function createEncryptedSupabaseBackup(userId, passphrase, onProgress) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!navigator.onLine) throw new Error('Für das Cloud-Backup wird eine Internetverbindung benötigt.')

  onProgress?.('Lese vollständigen Supabase-Datenbestand …')
  const tables = await fetchTables(userId, onProgress)
  assertRelations(tables)

  const refs = collectFileReferences(tables)
  const counts = countMap(tables)
  const backupId = crypto.randomUUID()
  const exportedAt = new Date().toISOString()

  onProgress?.('Leite lokalen Backup-Schlüssel ab …')
  const { key, kdf } = await createBackupPassphraseKey(passphrase)
  const zip = new StoredZipBuilder()
  const fileManifest = []
  let totalPlainFileBytes = 0
  let missingDeletedFiles = 0
  let encryptedFiles = 0

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]
    onProgress?.(`Datei ${i + 1}/${refs.length}: laden und einzeln verschlüsseln …`)

    const { data, error } = await supabase.storage.from(BUCKET).download(ref.storagePath)

    if (error) {
      if (ref.deletedAt) {
        missingDeletedFiles += 1
        fileManifest.push({
          ...ref,
          missing: true,
          size: 0,
          sha256: '',
          entryName: '',
          iv: '',
          aad: '',
        })
        continue
      }

      throw new Error(
        `Aktive Datei konnte nicht gesichert werden (${ref.sourceTable}, ${ref.rowId}): ${error.message}`,
      )
    }

    const plainBytes = new Uint8Array(await data.arrayBuffer())
    const sha256 = await sha256Hex(plainBytes)
    const aad = fileAad(backupId, i)
    const encrypted = await encryptBackupBytesRaw(plainBytes, key, aad)
    const entryName = `files/${String(i + 1).padStart(4, '0')}.bin`

    zip.add(entryName, encrypted.data)

    totalPlainFileBytes += plainBytes.byteLength
    encryptedFiles += 1
    fileManifest.push({
      ...ref,
      missing: false,
      size: plainBytes.byteLength,
      sha256,
      entryName,
      iv: encrypted.iv,
      aad,
    })

    await yieldToBrowser()
  }

  const manifest = {
    format: MANIFEST_FORMAT,
    version: VERSION,
    backupId,
    exportedAt,
    sourceOwnerId: userId,
    counts,
    fileCount: fileManifest.length,
    encryptedFiles,
    missingDeletedFiles,
    totalPlainFileBytes,
    tables,
    files: fileManifest,
  }

  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  const manifestContext = manifestAad(backupId)

  onProgress?.('Verschlüssele Manifest …')
  const encryptedManifest = await encryptBackupBytesRaw(
    manifestBytes,
    key,
    manifestContext,
  )
  zip.add(MANIFEST_ENTRY, encryptedManifest.data)

  const header = {
    format: HEADER_FORMAT,
    version: VERSION,
    backupId,
    kdf,
    manifest: {
      entryName: MANIFEST_ENTRY,
      iv: encryptedManifest.iv,
      aad: manifestContext,
    },
  }
  zip.add(HEADER_ENTRY, encoder.encode(JSON.stringify(header)))

  onProgress?.('Baue speicherschonendes ZIP …')
  const zipBlob = zip.finish()

  onProgress?.('Verschlüsseltes ZIP ist fertig.')

  return {
    zipBlob,
    fileName: makeBackupFileName(),
    summary: {
      counts,
      fileCount: fileManifest.length,
      encryptedFiles,
      missingDeletedFiles,
      totalPlainFileBytes,
      zipBytes: zipBlob.size,
      exportedAt,
    },
  }
}

export async function verifyEncryptedSupabaseBackup(file, passphrase, onProgress) {
  onProgress?.('Indexiere ZIP ohne es komplett in den Arbeitsspeicher zu laden …')
  const entries = await indexStoredZip(file)

  const headerBytes = await readIndexedEntry(file, entries, HEADER_ENTRY)
  let header
  try {
    header = JSON.parse(decoder.decode(headerBytes))
  } catch {
    throw new Error('Backup-Kopf ist beschädigt.')
  }

  if (header.format !== HEADER_FORMAT || header.version !== VERSION) {
    throw new Error('Unbekanntes oder veraltetes PhysioOptima-Backupformat.')
  }

  onProgress?.('Leite Backup-Schlüssel ab …')
  const key = await unlockBackupPassphraseKey(passphrase, header.kdf)

  const encryptedManifest = await readIndexedEntry(
    file,
    entries,
    header.manifest?.entryName || MANIFEST_ENTRY,
  )

  onProgress?.('Entschlüssele kleines Manifest …')
  const manifestBytes = await decryptBackupBytesRaw(
    encryptedManifest,
    key,
    header.manifest?.iv,
    header.manifest?.aad,
  )

  let manifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes))
  } catch {
    throw new Error('Entschlüsseltes Backup-Manifest ist beschädigt.')
  }

  if (
    manifest.format !== MANIFEST_FORMAT ||
    manifest.version !== VERSION ||
    manifest.backupId !== header.backupId
  ) {
    throw new Error('Entschlüsseltes Backup-Manifest hat ein unbekanntes Format.')
  }

  const counts = countMap(manifest.tables || {})
  assertCounts(manifest.counts, counts)
  assertRelations(manifest.tables || {})

  let verifiedFiles = 0
  let missingDeletedFiles = 0
  let verifiedBytes = 0

  for (let i = 0; i < (manifest.files || []).length; i += 1) {
    const item = manifest.files[i]
    onProgress?.(`Prüfe Datei ${i + 1}/${manifest.files.length} einzeln …`)

    if (item.missing) {
      if (!item.deletedAt) {
        throw new Error(
          `Backup enthält eine fehlende aktive Datei: ${item.sourceTable}/${item.rowId}`,
        )
      }
      missingDeletedFiles += 1
      continue
    }

    const encryptedBytes = await readIndexedEntry(file, entries, item.entryName)
    const plainBytes = await decryptBackupBytesRaw(
      encryptedBytes,
      key,
      item.iv,
      item.aad,
    )

    if (plainBytes.byteLength !== item.size) {
      throw new Error(`Dateigröße stimmt nicht: ${item.sourceTable}/${item.rowId}`)
    }

    const hash = await sha256Hex(plainBytes)
    if (hash !== item.sha256) {
      throw new Error(`Datei-Prüfsumme stimmt nicht: ${item.sourceTable}/${item.rowId}`)
    }

    verifiedFiles += 1
    verifiedBytes += plainBytes.byteLength

    await yieldToBrowser()
  }

  if ((manifest.files || []).length !== manifest.fileCount) {
    throw new Error('Anzahl der Dateieinträge stimmt nicht mit dem Manifest überein.')
  }
  if (verifiedFiles !== manifest.encryptedFiles) {
    throw new Error('Anzahl der geprüften Dateien stimmt nicht mit dem Manifest überein.')
  }
  if (missingDeletedFiles !== manifest.missingDeletedFiles) {
    throw new Error('Anzahl fehlender gelöschter Dateien stimmt nicht überein.')
  }
  if (verifiedBytes !== manifest.totalPlainFileBytes) {
    throw new Error('Gesamtgröße der geprüften Dateien stimmt nicht überein.')
  }

  onProgress?.('Wiederherstellungstest bestanden.')

  return {
    counts,
    fileCount: manifest.fileCount,
    verifiedFiles,
    missingDeletedFiles,
    verifiedBytes,
    exportedAt: manifest.exportedAt || '',
    sourceOwnerId: manifest.sourceOwnerId || '',
  }
}
