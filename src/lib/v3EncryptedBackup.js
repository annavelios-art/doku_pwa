import { supabase } from './supabase'
import {
  createBackupPassphraseKey,
  decryptBackupBytesRaw,
  encryptBackupBytesRaw,
  sha256Hex,
  unlockBackupPassphraseKey,
} from './v2Crypto'
import {
  StoredZipBuilder,
  indexStoredZip,
  readIndexedEntry,
} from './v2EncryptedBackup'

const BUCKET = 'doku-vault'
const VERSION = 1
const HEADER_FORMAT = 'physiooptima:v3-backup:header'
const MANIFEST_FORMAT = 'physiooptima:v3-backup:manifest'
const HEADER_ENTRY = 'header.json'
const MANIFEST_ENTRY = 'manifest.bin'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const TABLES = [
  ['patients', 'v3_patients', 'id,created_by,payload,created_at,updated_at,deleted_at'],
  ['prescriptions', 'v3_prescriptions', 'id,created_by,patient_id,payload,created_at,updated_at,deleted_at'],
  ['docEntries', 'v3_doc_entries', 'id,created_by,prescription_id,payload,created_at,updated_at,deleted_at'],
  ['docEntryImages', 'v3_doc_entry_images', 'id,created_by,doc_entry_id,metadata,storage_path,encrypted_size,created_at,updated_at,deleted_at'],
  ['patientDocuments', 'v3_patient_documents', 'id,created_by,patient_id,metadata,storage_path,encrypted_size,created_at,updated_at,deleted_at'],
  ['libraryItems', 'v3_library_items', 'id,created_by,payload,storage_path,encrypted_size,created_at,updated_at,deleted_at'],
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

function assertRelations(tables) {
  const patientIds = new Set((tables.patients || []).map(row => row.id))
  const prescriptionIds = new Set((tables.prescriptions || []).map(row => row.id))
  const docIds = new Set((tables.docEntries || []).map(row => row.id))

  for (const row of tables.prescriptions || []) {
    if (!patientIds.has(row.patient_id)) {
      throw new Error(`V3-Backup: Verordnung ${row.id} verweist auf fehlenden Patienten.`)
    }
  }

  for (const row of tables.docEntries || []) {
    if (!prescriptionIds.has(row.prescription_id)) {
      throw new Error(`V3-Backup: Doku ${row.id} verweist auf fehlende Verordnung.`)
    }
  }

  for (const row of tables.docEntryImages || []) {
    if (!docIds.has(row.doc_entry_id)) {
      throw new Error(`V3-Backup: Doku-Bild ${row.id} verweist auf fehlende Doku.`)
    }
  }

  for (const row of tables.patientDocuments || []) {
    if (!patientIds.has(row.patient_id)) {
      throw new Error(`V3-Backup: Befund ${row.id} verweist auf fehlenden Patienten.`)
    }
  }
}

async function fetchV3Tables(userId, onProgress) {
  const tables = {}

  for (const [key, table, select] of TABLES) {
    onProgress?.(`Lese ${table} …`)
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq('created_by', userId)

    if (error) throw error
    tables[key] = data || []
  }

  const { data: keyring, error: keyringError } = await supabase
    .from('v3_keyring')
    .select('owner_id,crypto_version,password_envelope,recovery_envelope,created_at,updated_at')
    .eq('owner_id', userId)
    .single()

  if (keyringError) throw keyringError
  if (!keyring) throw new Error('V3-Backup: Praxisschlüssel-Keyring fehlt.')

  return { tables, keyring }
}

function collectFileReferences(tables) {
  const refs = []

  for (const row of tables.docEntryImages || []) {
    if (!row.storage_path) continue
    refs.push({
      sourceTable: 'v3_doc_entry_images',
      rowId: row.id,
      storagePath: row.storage_path,
      deletedAt: row.deleted_at || '',
    })
  }

  for (const row of tables.patientDocuments || []) {
    if (!row.storage_path) continue
    refs.push({
      sourceTable: 'v3_patient_documents',
      rowId: row.id,
      storagePath: row.storage_path,
      deletedAt: row.deleted_at || '',
    })
  }

  for (const row of tables.libraryItems || []) {
    if (!row.storage_path) continue
    refs.push({
      sourceTable: 'v3_library_items',
      rowId: row.id,
      storagePath: row.storage_path,
      deletedAt: row.deleted_at || '',
    })
  }

  return refs
}

function makeFileName(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    'PhysioOptima_V3_Backup_',
    date.getFullYear(), '-',
    pad(date.getMonth() + 1), '-',
    pad(date.getDate()), '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    '.zip',
  ].join('')
}

function fileAad(backupId, index) {
  return `physiooptima:v3-backup:${backupId}:file:${index}`
}

function manifestAad(backupId) {
  return `physiooptima:v3-backup:${backupId}:manifest`
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export async function createEncryptedV3Backup(userId, passphrase, onProgress) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!navigator.onLine) throw new Error('Für das V3-Backup wird eine Internetverbindung benötigt.')

  const { tables, keyring } = await fetchV3Tables(userId, onProgress)
  assertRelations(tables)

  const counts = countMap(tables)
  const refs = collectFileReferences(tables)
  const backupId = crypto.randomUUID()
  const exportedAt = new Date().toISOString()

  onProgress?.('Leite lokalen Backup-Schlüssel ab …')
  const { key, kdf } = await createBackupPassphraseKey(passphrase)
  const zip = new StoredZipBuilder()
  const files = []
  let verifiedSourceFiles = 0
  let missingDeletedFiles = 0
  let totalSourceCipherBytes = 0

  for (let i = 0; i < refs.length; i += 1) {
    const ref = refs[i]
    onProgress?.(`V3-Datei ${i + 1}/${refs.length}: sichern …`)

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .download(ref.storagePath)

    if (error) {
      if (ref.deletedAt) {
        missingDeletedFiles += 1
        files.push({
          ...ref,
          missing: true,
          sourceCipherSize: 0,
          sourceCipherSha256: '',
          entryName: '',
          iv: '',
          aad: '',
        })
        continue
      }

      throw new Error(
        `Aktive V3-Datei konnte nicht gesichert werden (${ref.sourceTable}, ${ref.rowId}): ${error.message}`,
      )
    }

    const sourceCipherBytes = new Uint8Array(await data.arrayBuffer())
    const sourceCipherSha256 = await sha256Hex(sourceCipherBytes)
    const aad = fileAad(backupId, i)
    const encrypted = await encryptBackupBytesRaw(sourceCipherBytes, key, aad)
    const entryName = `files/${String(i + 1).padStart(4, '0')}.bin`

    zip.add(entryName, encrypted.data)

    files.push({
      ...ref,
      missing: false,
      sourceCipherSize: sourceCipherBytes.byteLength,
      sourceCipherSha256,
      entryName,
      iv: encrypted.iv,
      aad,
    })

    verifiedSourceFiles += 1
    totalSourceCipherBytes += sourceCipherBytes.byteLength
    await yieldToBrowser()
  }

  const manifest = {
    format: MANIFEST_FORMAT,
    version: VERSION,
    backupId,
    exportedAt,
    sourceOwnerId: userId,
    counts,
    keyring,
    tables,
    fileCount: files.length,
    backedUpFiles: verifiedSourceFiles,
    missingDeletedFiles,
    totalSourceCipherBytes,
    files,
  }

  onProgress?.('Verschlüssele V3-Manifest …')
  const manifestBytes = encoder.encode(JSON.stringify(manifest))
  const manifestContext = manifestAad(backupId)
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

  onProgress?.('Baue V3-Backup-ZIP …')
  const zipBlob = zip.finish()

  onProgress?.('V3-Backup ist fertig.')

  return {
    zipBlob,
    fileName: makeFileName(),
    summary: {
      counts,
      fileCount: files.length,
      backedUpFiles: verifiedSourceFiles,
      missingDeletedFiles,
      totalSourceCipherBytes,
      zipBytes: zipBlob.size,
      exportedAt,
    },
  }
}

export async function verifyEncryptedV3Backup(file, passphrase, onProgress) {
  onProgress?.('Indexiere V3-Backup-ZIP …')
  const entries = await indexStoredZip(file)

  const headerBytes = await readIndexedEntry(file, entries, HEADER_ENTRY)
  let header
  try {
    header = JSON.parse(decoder.decode(headerBytes))
  } catch {
    throw new Error('V3-Backup-Kopf ist beschädigt.')
  }

  if (header.format !== HEADER_FORMAT || header.version !== VERSION) {
    throw new Error('Unbekanntes oder veraltetes V3-Backupformat.')
  }

  onProgress?.('Leite Backup-Schlüssel ab …')
  const key = await unlockBackupPassphraseKey(passphrase, header.kdf)

  const encryptedManifest = await readIndexedEntry(
    file,
    entries,
    header.manifest?.entryName || MANIFEST_ENTRY,
  )

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
    throw new Error('V3-Backup-Manifest ist beschädigt oder das Passwort ist falsch.')
  }

  if (manifest.format !== MANIFEST_FORMAT || manifest.version !== VERSION) {
    throw new Error('V3-Backup-Manifest hat ein unbekanntes Format.')
  }

  if (!manifest.keyring?.password_envelope || !manifest.keyring?.recovery_envelope) {
    throw new Error('V3-Backup enthält keinen vollständigen Praxisschlüssel-Keyring.')
  }

  assertRelations(manifest.tables || {})
  const actualCounts = countMap(manifest.tables || {})
  for (const [keyName, expected] of Object.entries(manifest.counts || {})) {
    if (actualCounts[keyName] !== expected) {
      throw new Error(`V3-Backup-Prüfung: Anzahl ${keyName} stimmt nicht.`)
    }
  }

  let verifiedFiles = 0
  let verifiedBytes = 0
  let missingDeletedFiles = 0

  for (let i = 0; i < (manifest.files || []).length; i += 1) {
    const ref = manifest.files[i]
    onProgress?.(`Prüfe V3-Datei ${i + 1}/${manifest.files.length} …`)

    if (ref.missing) {
      if (!ref.deletedAt) {
        throw new Error(`V3-Backup: aktive Datei ${ref.rowId} fehlt im Backup.`)
      }
      missingDeletedFiles += 1
      continue
    }

    const encryptedBackupBytes = await readIndexedEntry(
      file,
      entries,
      ref.entryName,
    )

    const sourceCipherBytes = await decryptBackupBytesRaw(
      encryptedBackupBytes,
      key,
      ref.iv,
      ref.aad,
    )

    if (sourceCipherBytes.byteLength !== Number(ref.sourceCipherSize || 0)) {
      throw new Error(`V3-Backup: Dateigröße stimmt nicht für ${ref.rowId}.`)
    }

    const hash = await sha256Hex(sourceCipherBytes)
    if (hash !== ref.sourceCipherSha256) {
      throw new Error(`V3-Backup: SHA-256 stimmt nicht für ${ref.rowId}.`)
    }

    verifiedFiles += 1
    verifiedBytes += sourceCipherBytes.byteLength
    await yieldToBrowser()
  }

  return {
    counts: actualCounts,
    verifiedFiles,
    verifiedBytes,
    missingDeletedFiles,
    exportedAt: manifest.exportedAt || '',
    keyringVersion: manifest.keyring?.crypto_version || 0,
  }
}
