import { supabase } from './supabase'
import {
  decryptPracticeBytesRaw,
  decryptPracticeText,
  encryptPracticeBytesRaw,
  encryptPracticeText,
  sha256Hex,
} from './v2Crypto'

const BUCKET = 'doku-vault'

function patientAad(row) {
  return `physiooptima:v3:patient:${row.id}:payload:v1`
}
function prescriptionAad(row) {
  return `physiooptima:v3:prescription:${row.id}:patient:${row.patient_id}:payload:v1`
}
function docEntryAad(row) {
  return `physiooptima:v3:doc-entry:${row.id}:prescription:${row.prescription_id}:payload:v1`
}
function imageMetadataAad(row) {
  return `physiooptima:v3:doc-image:${row.id}:doc-entry:${row.doc_entry_id}:metadata:v1`
}
function imageBytesAad(row) {
  return `physiooptima:v3:doc-image:${row.id}:doc-entry:${row.doc_entry_id}:bytes:v1`
}
function patientDocumentMetadataAad(row) {
  return `physiooptima:v3:patient-document:${row.id}:patient:${row.patient_id}:metadata:v1`
}
function patientDocumentBytesAad(row) {
  return `physiooptima:v3:patient-document:${row.id}:patient:${row.patient_id}:bytes:v1`
}
function libraryPayloadAad(row) {
  return `physiooptima:v3:library:${row.id}:payload:v1`
}
function libraryBytesAad(row) {
  return `physiooptima:v3:library:${row.id}:bytes:v1`
}

async function encryptJson(value, key, aad) {
  return encryptPracticeText(JSON.stringify(value), key, aad)
}

async function decryptJson(envelope, key, aad) {
  return JSON.parse(await decryptPracticeText(envelope, key, aad))
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function getOne(table, select, id) {
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

async function downloadBytes(path, deletedAt = '') {
  if (!path) return null
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) {
    if (deletedAt) return null
    throw error
  }
  return new Uint8Array(await data.arrayBuffer())
}

async function uploadEncrypted(path, bytes) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([bytes], { type: 'application/octet-stream' }), {
      contentType: 'application/octet-stream',
      upsert: true,
    })
  if (error) throw error
}

async function removeEncrypted(path) {
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}

async function encryptSourceFile({ sourcePath, deletedAt, destinationPath, bytesAad, key }) {
  const plainBytes = await downloadBytes(sourcePath, deletedAt)

  if (!plainBytes) {
    await removeEncrypted(destinationPath).catch(() => {})
    return {
      hasFile: false,
      sourceFileMissing: Boolean(sourcePath),
      destinationPath: '',
      encryptedSize: 0,
      originalSize: 0,
      sha256: '',
      fileCrypto: null,
    }
  }

  const sha256 = await sha256Hex(plainBytes)
  const encrypted = await encryptPracticeBytesRaw(plainBytes, key, bytesAad)
  await uploadEncrypted(destinationPath, encrypted.data)

  return {
    hasFile: true,
    sourceFileMissing: false,
    destinationPath,
    encryptedSize: encrypted.data.byteLength,
    originalSize: plainBytes.byteLength,
    sha256,
    fileCrypto: {
      version: encrypted.version,
      algorithm: encrypted.algorithm,
      aad: encrypted.aad,
      iv: encrypted.iv,
    },
  }
}

async function verifyEncryptedFile({
  storagePath,
  encryptedSize,
  metadata,
  bytesAad,
  key,
}) {
  if (!metadata.hasFile) {
    if (storagePath) throw new Error('V3-Dateipfad vorhanden, obwohl keine Quelldatei existiert.')
    return
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw error

  const encryptedBytes = new Uint8Array(await data.arrayBuffer())
  if (encryptedBytes.byteLength !== Number(encryptedSize || 0)) {
    throw new Error('V3-Chiffretextgröße stimmt nicht.')
  }

  const plainBytes = await decryptPracticeBytesRaw(
    encryptedBytes,
    key,
    metadata.fileCrypto?.iv,
    bytesAad,
  )
  if (plainBytes.byteLength !== metadata.originalSize) {
    throw new Error('V3-Dateigröße stimmt nach Entschlüsselung nicht.')
  }
  const hash = await sha256Hex(plainBytes)
  if (hash !== metadata.sha256) {
    throw new Error('V3-Datei-SHA-256 stimmt nicht.')
  }
}

export async function mirrorV3PatientById(patientId, userId, key) {
  const row = await getOne(
    'patients',
    'id,first_name,last_name,birth_date,created_by,created_at,updated_at,deleted_at',
    patientId,
  )
  const plain = {
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    birthDate: row.birth_date || '',
  }
  const payload = await encryptJson(plain, key, patientAad(row))

  const { error } = await supabase.from('v3_patients').upsert({
    id: row.id,
    created_by: userId,
    payload,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }, { onConflict: 'id' })
  if (error) throw error

  const check = await getOne(
    'v3_patients',
    'id,payload,created_at,updated_at,deleted_at',
    patientId,
  )
  const decoded = await decryptJson(check.payload, key, patientAad(row))
  if (!sameJson(decoded, plain) || check.deleted_at !== row.deleted_at) {
    throw new Error('Patient stimmt nach V3-Spiegelung nicht überein.')
  }
}

export async function mirrorV3PrescriptionById(prescriptionId, userId, key) {
  const row = await getOne(
    'prescriptions',
    'id,patient_id,prescription_date,remedy,created_by,created_at,updated_at,deleted_at',
    prescriptionId,
  )
  const plain = {
    prescriptionDate: row.prescription_date || '',
    remedy: row.remedy || '',
  }
  const payload = await encryptJson(plain, key, prescriptionAad(row))

  const { error } = await supabase.from('v3_prescriptions').upsert({
    id: row.id,
    created_by: userId,
    patient_id: row.patient_id,
    payload,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }, { onConflict: 'id' })
  if (error) throw error

  const check = await getOne(
    'v3_prescriptions',
    'id,patient_id,payload,created_at,updated_at,deleted_at',
    prescriptionId,
  )
  const decoded = await decryptJson(check.payload, key, prescriptionAad(row))
  if (
    !sameJson(decoded, plain) ||
    check.patient_id !== row.patient_id ||
    check.deleted_at !== row.deleted_at
  ) {
    throw new Error('Verordnung stimmt nach V3-Spiegelung nicht überein.')
  }
}

async function mirrorImageRow(row, userId, key) {
  const destinationPath = `${userId}/v3-encrypted/doc-images/${row.id}.bin`
  const file = await encryptSourceFile({
    sourcePath: row.storage_path || '',
    deletedAt: row.deleted_at || '',
    destinationPath,
    bytesAad: imageBytesAad(row),
    key,
  })

  const metadataPlain = {
    fileName: row.file_name || '',
    mimeType: row.mime_type || 'application/octet-stream',
    hasFile: file.hasFile,
    sourceFileMissing: file.sourceFileMissing,
    sha256: file.sha256,
    originalSize: file.originalSize,
    fileCrypto: file.fileCrypto,
  }
  const metadata = await encryptJson(metadataPlain, key, imageMetadataAad(row))

  const { error } = await supabase.from('v3_doc_entry_images').upsert({
    id: row.id,
    created_by: userId,
    doc_entry_id: row.doc_entry_id,
    metadata,
    storage_path: file.destinationPath,
    encrypted_size: file.encryptedSize,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }, { onConflict: 'id' })
  if (error) throw error

  const check = await getOne(
    'v3_doc_entry_images',
    'id,doc_entry_id,metadata,storage_path,encrypted_size,deleted_at',
    row.id,
  )
  const decoded = await decryptJson(check.metadata, key, imageMetadataAad(row))
  if (
    !sameJson(decoded, metadataPlain) ||
    check.doc_entry_id !== row.doc_entry_id ||
    check.deleted_at !== row.deleted_at
  ) {
    throw new Error(`Bild ${row.id} stimmt nach V3-Spiegelung nicht überein.`)
  }

  await verifyEncryptedFile({
    storagePath: check.storage_path,
    encryptedSize: check.encrypted_size,
    metadata: decoded,
    bytesAad: imageBytesAad(row),
    key,
  })
}

export async function mirrorV3DocEntryById(docEntryId, userId, key) {
  const row = await getOne(
    'doc_entries',
    'id,prescription_id,entry_date,text,created_by,created_at,updated_at,deleted_at',
    docEntryId,
  )
  const plain = {
    entryDate: row.entry_date || '',
    text: row.text || '',
  }
  const payload = await encryptJson(plain, key, docEntryAad(row))

  const { error } = await supabase.from('v3_doc_entries').upsert({
    id: row.id,
    created_by: userId,
    prescription_id: row.prescription_id,
    payload,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }, { onConflict: 'id' })
  if (error) throw error

  const check = await getOne(
    'v3_doc_entries',
    'id,prescription_id,payload,created_at,updated_at,deleted_at',
    docEntryId,
  )
  const decoded = await decryptJson(check.payload, key, docEntryAad(row))
  if (
    !sameJson(decoded, plain) ||
    check.prescription_id !== row.prescription_id ||
    check.deleted_at !== row.deleted_at
  ) {
    throw new Error('Doku stimmt nach V3-Spiegelung nicht überein.')
  }

  const { data: images, error: imageError } = await supabase
    .from('doc_entry_images')
    .select('id,doc_entry_id,file_name,mime_type,storage_path,created_by,created_at,updated_at,deleted_at')
    .eq('doc_entry_id', docEntryId)
  if (imageError) throw imageError

  for (const image of images || []) {
    await mirrorImageRow(image, userId, key)
  }
}

export async function mirrorV3PatientDocumentById(documentId, userId, key) {
  const row = await getOne(
    'patient_documents',
    'id,patient_id,document_date,title,note,file_name,mime_type,storage_path,created_by,created_at,updated_at,deleted_at',
    documentId,
  )
  const destinationPath = `${userId}/v3-encrypted/patient-documents/${row.id}.bin`
  const file = await encryptSourceFile({
    sourcePath: row.storage_path || '',
    deletedAt: row.deleted_at || '',
    destinationPath,
    bytesAad: patientDocumentBytesAad(row),
    key,
  })

  const metadataPlain = {
    documentDate: row.document_date || '',
    title: row.title || '',
    note: row.note || '',
    fileName: row.file_name || '',
    mimeType: row.mime_type || 'application/octet-stream',
    hasFile: file.hasFile,
    sourceFileMissing: file.sourceFileMissing,
    sha256: file.sha256,
    originalSize: file.originalSize,
    fileCrypto: file.fileCrypto,
  }
  const metadata = await encryptJson(
    metadataPlain,
    key,
    patientDocumentMetadataAad(row),
  )

  const { error } = await supabase.from('v3_patient_documents').upsert({
    id: row.id,
    created_by: userId,
    patient_id: row.patient_id,
    metadata,
    storage_path: file.destinationPath || null,
    encrypted_size: file.encryptedSize,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }, { onConflict: 'id' })
  if (error) throw error

  const check = await getOne(
    'v3_patient_documents',
    'id,patient_id,metadata,storage_path,encrypted_size,deleted_at',
    documentId,
  )
  const decoded = await decryptJson(
    check.metadata,
    key,
    patientDocumentMetadataAad(row),
  )
  if (
    !sameJson(decoded, metadataPlain) ||
    check.patient_id !== row.patient_id ||
    check.deleted_at !== row.deleted_at
  ) {
    throw new Error('Befund stimmt nach V3-Spiegelung nicht überein.')
  }

  await verifyEncryptedFile({
    storagePath: check.storage_path,
    encryptedSize: check.encrypted_size,
    metadata: decoded,
    bytesAad: patientDocumentBytesAad(row),
    key,
  })
}

export async function mirrorV3LibraryItemById(itemId, userId, key) {
  const row = await getOne(
    'library_items',
    'id,category,title,description,file_name,mime_type,storage_path,created_by,created_at,updated_at,deleted_at',
    itemId,
  )
  const destinationPath = `${userId}/v3-encrypted/library/${row.id}.bin`
  const file = await encryptSourceFile({
    sourcePath: row.storage_path || '',
    deletedAt: row.deleted_at || '',
    destinationPath,
    bytesAad: libraryBytesAad(row),
    key,
  })

  const payloadPlain = {
    category: row.category || '',
    title: row.title || '',
    description: row.description || '',
    fileName: row.file_name || '',
    mimeType: row.mime_type || 'application/octet-stream',
    hasFile: file.hasFile,
    sourceFileMissing: file.sourceFileMissing,
    sha256: file.sha256,
    originalSize: file.originalSize,
    fileCrypto: file.fileCrypto,
  }
  const payload = await encryptJson(payloadPlain, key, libraryPayloadAad(row))

  const { error } = await supabase.from('v3_library_items').upsert({
    id: row.id,
    created_by: userId,
    payload,
    storage_path: file.destinationPath || null,
    encrypted_size: file.encryptedSize,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }, { onConflict: 'id' })
  if (error) throw error

  const check = await getOne(
    'v3_library_items',
    'id,payload,storage_path,encrypted_size,deleted_at',
    itemId,
  )
  const decoded = await decryptJson(check.payload, key, libraryPayloadAad(row))
  if (!sameJson(decoded, payloadPlain) || check.deleted_at !== row.deleted_at) {
    throw new Error('Bibliothek stimmt nach V3-Spiegelung nicht überein.')
  }

  await verifyEncryptedFile({
    storagePath: check.storage_path,
    encryptedSize: check.encrypted_size,
    metadata: decoded,
    bytesAad: libraryBytesAad(row),
    key,
  })
}


function offlineQueueContext(kind, entityId, parentId = '') {
  return `physiooptima:v3:mirror-outbox:${kind}:${entityId}:parent:${parentId || 'none'}:v1`
}

function normalizeOfflineRecord(kind, record, parentId = '') {
  if (kind === 'patient') {
    return {
      firstName: record.firstName || '',
      lastName: record.lastName || '',
      birthDate: record.birthDate || '',
    }
  }

  if (kind === 'prescription') {
    return {
      prescriptionDate: record.issueDate || '',
      remedy: record.remedy || '',
      patientId: parentId || record.patientId || '',
    }
  }

  if (kind === 'docEntry') {
    return {
      entryDate: record.entryDate || '',
      text: record.text || '',
      prescriptionId: parentId || record.prescriptionId || '',
    }
  }

  throw new Error(`Unbekannter V3-Offlinemirror-Typ: ${kind}`)
}

export async function createEncryptedV3MirrorOfflineItem(
  kind,
  record,
  parentId,
  key,
  userId,
) {
  if (!record?.id) throw new Error('V3-Offlinemirror: Datensatz-ID fehlt.')
  if (!key) throw new Error('V3-Offlinemirror: Praxisschlüssel fehlt.')

  const plain = normalizeOfflineRecord(kind, record, parentId)
  const aad = offlineQueueContext(kind, record.id, parentId)
  const encryptedPayload = await encryptPracticeText(
    JSON.stringify(plain),
    key,
    aad,
  )

  return {
    id: `${kind}:${record.id}`,
    kind,
    entityId: record.id,
    parentId: parentId || '',
    userId: userId || '',
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || '',
    deletedAt: record.deletedAt || '',
    encryptedPayload,
  }
}

export async function decryptEncryptedV3MirrorOfflineItem(item, key) {
  if (!item?.encryptedPayload) {
    throw new Error('V3-Offlinemirror: verschlüsselter Inhalt fehlt.')
  }

  const aad = offlineQueueContext(item.kind, item.entityId, item.parentId)
  const text = await decryptPracticeText(item.encryptedPayload, key, aad)
  return JSON.parse(text)
}

export async function mirrorQueuedV3OfflineItem(item, userId, key) {
  // Der verschlüsselte Queue-Inhalt wird absichtlich zuerst entschlüsselt,
  // damit ein beschädigter oder vertauschter Queue-Eintrag nicht stillschweigend
  // entfernt wird. Der eigentliche Spiegel liest danach den bestätigten Stand
  // aus der bisherigen Supabase-Struktur.
  await decryptEncryptedV3MirrorOfflineItem(item, key)

  if (item.kind === 'patient') {
    await mirrorV3PatientById(item.entityId, userId, key)
    return
  }

  if (item.kind === 'prescription') {
    await mirrorV3PrescriptionById(item.entityId, userId, key)
    return
  }

  if (item.kind === 'docEntry') {
    await mirrorV3DocEntryById(item.entityId, userId, key)
    return
  }

  throw new Error(`Unbekannter V3-Offlinemirror-Typ: ${item.kind}`)
}
