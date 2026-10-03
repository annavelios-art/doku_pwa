import { supabase } from './supabase'
import {
  decryptPracticeBytesRaw,
  decryptPracticeText,
  encryptPracticeBytesRaw,
  encryptPracticeText,
  sha256Hex,
} from './v2Crypto'

const BUCKET = 'doku-vault'

const SOURCE_SPECS = [
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

const V3_SELECTS = {
  patients: 'id,created_by,payload,created_at,updated_at,deleted_at',
  prescriptions: 'id,created_by,patient_id,payload,created_at,updated_at,deleted_at',
  docEntries: 'id,created_by,prescription_id,payload,created_at,updated_at,deleted_at',
  docEntryImages: 'id,created_by,doc_entry_id,metadata,storage_path,encrypted_size,created_at,updated_at,deleted_at',
  patientDocuments: 'id,created_by,patient_id,metadata,storage_path,encrypted_size,created_at,updated_at,deleted_at',
  libraryItems: 'id,created_by,payload,storage_path,encrypted_size,created_at,updated_at,deleted_at',
}

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

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

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
  for (const [key, value] of Object.entries(expected)) {
    if ((actual?.[key] ?? -1) !== value) {
      throw new Error(`V3-Prüfung: Anzahl ${key} stimmt nicht (${value} ≠ ${actual?.[key]}).`)
    }
  }
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function fetchSourceTables(userId) {
  const tables = {}

  for (const spec of SOURCE_SPECS) {
    const { data, error } = await supabase
      .from(spec.table)
      .select(spec.select)
      .eq('created_by', userId)

    if (error) throw error
    tables[spec.key] = data || []
  }

  return tables
}

async function fetchV3Tables(userId) {
  const queries = [
    ['patients', 'v3_patients'],
    ['prescriptions', 'v3_prescriptions'],
    ['docEntries', 'v3_doc_entries'],
    ['docEntryImages', 'v3_doc_entry_images'],
    ['patientDocuments', 'v3_patient_documents'],
    ['libraryItems', 'v3_library_items'],
  ]

  const results = await Promise.all(
    queries.map(async ([key, table]) => {
      const { data, error } = await supabase
        .from(table)
        .select(V3_SELECTS[key])
        .eq('created_by', userId)

      if (error) throw error
      return [key, data || []]
    }),
  )

  return Object.fromEntries(results)
}

function sourcePatientPayload(row) {
  return {
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    birthDate: row.birth_date || '',
  }
}

function sourcePrescriptionPayload(row) {
  return {
    prescriptionDate: row.prescription_date || '',
    remedy: row.remedy || '',
  }
}

function sourceDocPayload(row) {
  return {
    entryDate: row.entry_date || '',
    text: row.text || '',
  }
}

function baseFileMetadata(row) {
  return {
    fileName: row.file_name || '',
    mimeType: row.mime_type || 'application/octet-stream',
    hasFile: Boolean(row.storage_path),
  }
}

async function encryptJson(value, key, aad) {
  return encryptPracticeText(JSON.stringify(value), key, aad)
}

async function decryptJson(envelope, key, aad) {
  return JSON.parse(await decryptPracticeText(envelope, key, aad))
}

async function downloadSourceFile(row) {
  if (!row.storage_path) return null

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(row.storage_path)

  if (error) {
    if (row.deleted_at) return null
    throw new Error(`Aktive Quelldatei fehlt: ${row.storage_path} – ${error.message}`)
  }

  return new Uint8Array(await data.arrayBuffer())
}

async function uploadEncryptedFile(path, bytes) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(
      path,
      new Blob([bytes], { type: 'application/octet-stream' }),
      {
        contentType: 'application/octet-stream',
        upsert: true,
      },
    )

  if (error) throw error
}

async function encryptAndUploadFile({
  row,
  practiceKey,
  aad,
  destinationPath,
}) {
  const plainBytes = await downloadSourceFile(row)

  if (!plainBytes) {
    return {
      hasFile: false,
      sourceFileMissing: Boolean(row.storage_path),
      destinationPath: '',
      encryptedSize: 0,
      fileCrypto: null,
      sha256: '',
      originalSize: 0,
    }
  }

  const sha256 = await sha256Hex(plainBytes)
  const encrypted = await encryptPracticeBytesRaw(
    plainBytes,
    practiceKey,
    aad,
  )

  await uploadEncryptedFile(destinationPath, encrypted.data)

  return {
    hasFile: true,
    sourceFileMissing: false,
    destinationPath,
    encryptedSize: encrypted.data.byteLength,
    fileCrypto: {
      version: encrypted.version,
      algorithm: encrypted.algorithm,
      aad: encrypted.aad,
      iv: encrypted.iv,
    },
    sha256,
    originalSize: plainBytes.byteLength,
  }
}

export async function buildV3EncryptedParallelCopy({
  userId,
  practiceKey,
  onProgress,
}) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!practiceKey) throw new Error('Bitte den V3-Praxisschlüssel zuerst entsperren.')
  if (!navigator.onLine) throw new Error('Für den Brückenbau wird eine Internetverbindung benötigt.')

  onProgress?.('Lese alte Praxisdaten …')
  const source = await fetchSourceTables(userId)
  const sourceCounts = countMap(source)

  for (let i = 0; i < source.patients.length; i += 1) {
    const row = source.patients[i]
    onProgress?.(`Patient ${i + 1}/${source.patients.length} verschlüsseln …`)
    const payload = await encryptJson(sourcePatientPayload(row), practiceKey, patientAad(row))

    const { error } = await supabase
      .from('v3_patients')
      .upsert({
        id: row.id,
        created_by: userId,
        payload,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }, { onConflict: 'id' })

    if (error) throw error
  }

  for (let i = 0; i < source.prescriptions.length; i += 1) {
    const row = source.prescriptions[i]
    onProgress?.(`Verordnung ${i + 1}/${source.prescriptions.length} verschlüsseln …`)
    const payload = await encryptJson(sourcePrescriptionPayload(row), practiceKey, prescriptionAad(row))

    const { error } = await supabase
      .from('v3_prescriptions')
      .upsert({
        id: row.id,
        created_by: userId,
        patient_id: row.patient_id,
        payload,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }, { onConflict: 'id' })

    if (error) throw error
  }

  for (let i = 0; i < source.docEntries.length; i += 1) {
    const row = source.docEntries[i]
    onProgress?.(`Doku ${i + 1}/${source.docEntries.length} verschlüsseln …`)
    const payload = await encryptJson(sourceDocPayload(row), practiceKey, docEntryAad(row))

    const { error } = await supabase
      .from('v3_doc_entries')
      .upsert({
        id: row.id,
        created_by: userId,
        prescription_id: row.prescription_id,
        payload,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }, { onConflict: 'id' })

    if (error) throw error
  }

  for (let i = 0; i < source.docEntryImages.length; i += 1) {
    const row = source.docEntryImages[i]
    onProgress?.(`Doku-Bild ${i + 1}/${source.docEntryImages.length} verschlüsseln …`)

    const fileResult = await encryptAndUploadFile({
      row,
      practiceKey,
      aad: imageBytesAad(row),
      destinationPath: `${userId}/v3-encrypted/doc-images/${row.id}.bin`,
    })

    const metadataPlain = {
      ...baseFileMetadata(row),
      hasFile: fileResult.hasFile,
      sourceFileMissing: fileResult.sourceFileMissing,
      sha256: fileResult.sha256,
      originalSize: fileResult.originalSize,
      fileCrypto: fileResult.fileCrypto,
    }
    const metadata = await encryptJson(metadataPlain, practiceKey, imageMetadataAad(row))

    const { error } = await supabase
      .from('v3_doc_entry_images')
      .upsert({
        id: row.id,
        created_by: userId,
        doc_entry_id: row.doc_entry_id,
        metadata,
        storage_path: fileResult.destinationPath,
        encrypted_size: fileResult.encryptedSize,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }, { onConflict: 'id' })

    if (error) throw error
    await yieldToBrowser()
  }

  for (let i = 0; i < source.patientDocuments.length; i += 1) {
    const row = source.patientDocuments[i]
    onProgress?.(`Befund ${i + 1}/${source.patientDocuments.length} verschlüsseln …`)

    const fileResult = await encryptAndUploadFile({
      row,
      practiceKey,
      aad: patientDocumentBytesAad(row),
      destinationPath: `${userId}/v3-encrypted/patient-documents/${row.id}.bin`,
    })

    const metadataPlain = {
      documentDate: row.document_date || '',
      title: row.title || '',
      note: row.note || '',
      ...baseFileMetadata(row),
      hasFile: fileResult.hasFile,
      sourceFileMissing: fileResult.sourceFileMissing,
      sha256: fileResult.sha256,
      originalSize: fileResult.originalSize,
      fileCrypto: fileResult.fileCrypto,
    }
    const metadata = await encryptJson(
      metadataPlain,
      practiceKey,
      patientDocumentMetadataAad(row),
    )

    const { error } = await supabase
      .from('v3_patient_documents')
      .upsert({
        id: row.id,
        created_by: userId,
        patient_id: row.patient_id,
        metadata,
        storage_path: fileResult.destinationPath || null,
        encrypted_size: fileResult.encryptedSize,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }, { onConflict: 'id' })

    if (error) throw error
    await yieldToBrowser()
  }

  for (let i = 0; i < source.libraryItems.length; i += 1) {
    const row = source.libraryItems[i]
    onProgress?.(`Bibliothek ${i + 1}/${source.libraryItems.length} verschlüsseln …`)

    const fileResult = await encryptAndUploadFile({
      row,
      practiceKey,
      aad: libraryBytesAad(row),
      destinationPath: `${userId}/v3-encrypted/library/${row.id}.bin`,
    })

    const payloadPlain = {
      category: row.category || '',
      title: row.title || '',
      description: row.description || '',
      ...baseFileMetadata(row),
      hasFile: fileResult.hasFile,
      sourceFileMissing: fileResult.sourceFileMissing,
      sha256: fileResult.sha256,
      originalSize: fileResult.originalSize,
      fileCrypto: fileResult.fileCrypto,
    }
    const payload = await encryptJson(payloadPlain, practiceKey, libraryPayloadAad(row))

    const { error } = await supabase
      .from('v3_library_items')
      .upsert({
        id: row.id,
        created_by: userId,
        payload,
        storage_path: fileResult.destinationPath || null,
        encrypted_size: fileResult.encryptedSize,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
      }, { onConflict: 'id' })

    if (error) throw error
    await yieldToBrowser()
  }

  onProgress?.('V3-Parallelbestand vollständig geschrieben.')
  return { sourceCounts }
}

function mapById(rows) {
  return new Map((rows || []).map(row => [row.id, row]))
}

async function verifyFileRow({
  sourceRow,
  v3Row,
  metadataPlain,
  practiceKey,
  bytesAad,
}) {
  if (!metadataPlain.hasFile) {
    if (v3Row.storage_path) {
      throw new Error(`V3-Prüfung: Datei ${sourceRow.id} sollte keinen Storage-Pfad haben.`)
    }
    return { verifiedFile: false, verifiedBytes: 0 }
  }

  if (!v3Row.storage_path) {
    throw new Error(`V3-Prüfung: verschlüsselte Datei ${sourceRow.id} hat keinen Storage-Pfad.`)
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(v3Row.storage_path)

  if (error) throw error

  const encryptedBytes = new Uint8Array(await data.arrayBuffer())
  if (encryptedBytes.byteLength !== Number(v3Row.encrypted_size || 0)) {
    throw new Error(`V3-Prüfung: Chiffretextgröße stimmt nicht für ${sourceRow.id}.`)
  }

  const plainBytes = await decryptPracticeBytesRaw(
    encryptedBytes,
    practiceKey,
    metadataPlain.fileCrypto?.iv,
    bytesAad,
  )

  if (plainBytes.byteLength !== metadataPlain.originalSize) {
    throw new Error(`V3-Prüfung: Originalgröße stimmt nicht für ${sourceRow.id}.`)
  }

  const hash = await sha256Hex(plainBytes)
  if (hash !== metadataPlain.sha256) {
    throw new Error(`V3-Prüfung: SHA-256 stimmt nicht für ${sourceRow.id}.`)
  }

  return { verifiedFile: true, verifiedBytes: plainBytes.byteLength }
}

export async function verifyV3EncryptedParallelCopy({
  userId,
  practiceKey,
  onProgress,
}) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!practiceKey) throw new Error('Bitte den V3-Praxisschlüssel zuerst entsperren.')

  onProgress?.('Lese Klartext-Quelle und verschlüsselten V3-Bestand …')
  const [source, v3] = await Promise.all([
    fetchSourceTables(userId),
    fetchV3Tables(userId),
  ])

  const sourceCounts = countMap(source)
  const v3Counts = countMap(v3)
  assertCounts(sourceCounts, v3Counts)

  const v3Patients = mapById(v3.patients)
  for (let i = 0; i < source.patients.length; i += 1) {
    const row = source.patients[i]
    onProgress?.(`Prüfe Patient ${i + 1}/${source.patients.length} …`)
    const encrypted = v3Patients.get(row.id)
    if (!encrypted) throw new Error(`V3-Prüfung: Patient ${row.id} fehlt.`)
    const plain = await decryptJson(encrypted.payload, practiceKey, patientAad(row))
    if (!sameJson(plain, sourcePatientPayload(row))) {
      throw new Error(`V3-Prüfung: Patient ${row.id} stimmt nicht überein.`)
    }
  }

  const v3Prescriptions = mapById(v3.prescriptions)
  for (let i = 0; i < source.prescriptions.length; i += 1) {
    const row = source.prescriptions[i]
    onProgress?.(`Prüfe Verordnung ${i + 1}/${source.prescriptions.length} …`)
    const encrypted = v3Prescriptions.get(row.id)
    if (!encrypted || encrypted.patient_id !== row.patient_id) {
      throw new Error(`V3-Prüfung: Verordnung ${row.id} fehlt oder ist falsch verknüpft.`)
    }
    const plain = await decryptJson(encrypted.payload, practiceKey, prescriptionAad(row))
    if (!sameJson(plain, sourcePrescriptionPayload(row))) {
      throw new Error(`V3-Prüfung: Verordnung ${row.id} stimmt nicht überein.`)
    }
  }

  const v3Docs = mapById(v3.docEntries)
  for (let i = 0; i < source.docEntries.length; i += 1) {
    const row = source.docEntries[i]
    onProgress?.(`Prüfe Doku ${i + 1}/${source.docEntries.length} …`)
    const encrypted = v3Docs.get(row.id)
    if (!encrypted || encrypted.prescription_id !== row.prescription_id) {
      throw new Error(`V3-Prüfung: Doku ${row.id} fehlt oder ist falsch verknüpft.`)
    }
    const plain = await decryptJson(encrypted.payload, practiceKey, docEntryAad(row))
    if (!sameJson(plain, sourceDocPayload(row))) {
      throw new Error(`V3-Prüfung: Doku ${row.id} stimmt nicht überein.`)
    }
  }

  let verifiedFiles = 0
  let verifiedBytes = 0
  let missingDeletedFiles = 0

  const v3Images = mapById(v3.docEntryImages)
  for (let i = 0; i < source.docEntryImages.length; i += 1) {
    const row = source.docEntryImages[i]
    onProgress?.(`Prüfe Doku-Bild ${i + 1}/${source.docEntryImages.length} …`)
    const encrypted = v3Images.get(row.id)
    if (!encrypted || encrypted.doc_entry_id !== row.doc_entry_id) {
      throw new Error(`V3-Prüfung: Doku-Bild ${row.id} fehlt oder ist falsch verknüpft.`)
    }
    const metadata = await decryptJson(
      encrypted.metadata,
      practiceKey,
      imageMetadataAad(row),
    )

    if (
      metadata.fileName !== (row.file_name || '') ||
      metadata.mimeType !== (row.mime_type || 'application/octet-stream')
    ) {
      throw new Error(`V3-Prüfung: Metadaten des Bildes ${row.id} stimmen nicht.`)
    }

    if (metadata.sourceFileMissing) missingDeletedFiles += 1

    const result = await verifyFileRow({
      sourceRow: row,
      v3Row: encrypted,
      metadataPlain: metadata,
      practiceKey,
      bytesAad: imageBytesAad(row),
    })
    if (result.verifiedFile) verifiedFiles += 1
    verifiedBytes += result.verifiedBytes
    await yieldToBrowser()
  }

  const v3PatientDocs = mapById(v3.patientDocuments)
  for (let i = 0; i < source.patientDocuments.length; i += 1) {
    const row = source.patientDocuments[i]
    onProgress?.(`Prüfe Befund ${i + 1}/${source.patientDocuments.length} …`)
    const encrypted = v3PatientDocs.get(row.id)
    if (!encrypted || encrypted.patient_id !== row.patient_id) {
      throw new Error(`V3-Prüfung: Befund ${row.id} fehlt oder ist falsch verknüpft.`)
    }

    const metadata = await decryptJson(
      encrypted.metadata,
      practiceKey,
      patientDocumentMetadataAad(row),
    )

    const expected = {
      documentDate: row.document_date || '',
      title: row.title || '',
      note: row.note || '',
      fileName: row.file_name || '',
      mimeType: row.mime_type || 'application/octet-stream',
    }
    for (const [key, value] of Object.entries(expected)) {
      if (metadata[key] !== value) {
        throw new Error(`V3-Prüfung: Befund-Metadaten ${row.id} stimmen nicht.`)
      }
    }

    if (metadata.sourceFileMissing) missingDeletedFiles += 1

    const result = await verifyFileRow({
      sourceRow: row,
      v3Row: encrypted,
      metadataPlain: metadata,
      practiceKey,
      bytesAad: patientDocumentBytesAad(row),
    })
    if (result.verifiedFile) verifiedFiles += 1
    verifiedBytes += result.verifiedBytes
    await yieldToBrowser()
  }

  const v3Library = mapById(v3.libraryItems)
  for (let i = 0; i < source.libraryItems.length; i += 1) {
    const row = source.libraryItems[i]
    onProgress?.(`Prüfe Bibliothek ${i + 1}/${source.libraryItems.length} …`)
    const encrypted = v3Library.get(row.id)
    if (!encrypted) {
      throw new Error(`V3-Prüfung: Bibliothekseintrag ${row.id} fehlt.`)
    }

    const payload = await decryptJson(
      encrypted.payload,
      practiceKey,
      libraryPayloadAad(row),
    )

    const expected = {
      category: row.category || '',
      title: row.title || '',
      description: row.description || '',
      fileName: row.file_name || '',
      mimeType: row.mime_type || 'application/octet-stream',
    }
    for (const [key, value] of Object.entries(expected)) {
      if (payload[key] !== value) {
        throw new Error(`V3-Prüfung: Bibliothek ${row.id} stimmt nicht.`)
      }
    }

    if (payload.sourceFileMissing) missingDeletedFiles += 1

    const result = await verifyFileRow({
      sourceRow: row,
      v3Row: encrypted,
      metadataPlain: payload,
      practiceKey,
      bytesAad: libraryBytesAad(row),
    })
    if (result.verifiedFile) verifiedFiles += 1
    verifiedBytes += result.verifiedBytes
    await yieldToBrowser()
  }

  onProgress?.('V3-Parallelbestand vollständig geprüft.')

  return {
    sourceCounts,
    v3Counts,
    verifiedFiles,
    verifiedBytes,
    missingDeletedFiles,
  }
}
