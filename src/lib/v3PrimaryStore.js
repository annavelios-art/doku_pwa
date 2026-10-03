import { supabase } from './supabase'
import {
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

function dataUrlToBytes(dataUrl) {
  const [, base64] = String(dataUrl || '').split(',')
  if (!base64) throw new Error('Dateidaten sind ungültig.')

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function uploadEncryptedFile(path, plainBytes, key, aad) {
  const sha256 = await sha256Hex(plainBytes)
  const encrypted = await encryptPracticeBytesRaw(plainBytes, key, aad)

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(
      path,
      new Blob([encrypted.data], { type: 'application/octet-stream' }),
      { contentType: 'application/octet-stream', upsert: true },
    )

  if (error) throw error

  return {
    storagePath: path,
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

async function removeStorageFile(path) {
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}

async function getRow(table, select, id) {
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data || null
}

function patientFromPlain(row, plain) {
  return {
    id: row.id,
    firstName: plain.firstName || '',
    lastName: plain.lastName || '',
    birthDate: plain.birthDate || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

function prescriptionFromPlain(row, plain) {
  return {
    id: row.id,
    patientId: row.patient_id,
    issueDate: plain.prescriptionDate || '',
    remedy: plain.remedy || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

function docFromPlain(row, plain) {
  return {
    id: row.id,
    prescriptionId: row.prescription_id,
    entryDate: plain.entryDate || '',
    text: plain.text || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

async function conflictPatient(row, key) {
  if (!row) return null
  const plain = await decryptJson(row.payload, key, patientAad(row))
  return patientFromPlain(row, plain)
}

async function conflictPrescription(row, key) {
  if (!row) return null
  const plain = await decryptJson(row.payload, key, prescriptionAad(row))
  return prescriptionFromPlain(row, plain)
}

async function conflictDoc(row, key) {
  if (!row) return null
  const plain = await decryptJson(row.payload, key, docEntryAad(row))
  return docFromPlain(row, plain)
}

export async function saveV3Patient(
  form,
  userId,
  key,
  expectedUpdatedAt = '',
  mode = 'update',
) {
  const id = form.id || crypto.randomUUID()
  const now = new Date().toISOString()
  const plain = {
    firstName: form.firstName?.trim() || '',
    lastName: form.lastName?.trim() || '',
    birthDate: form.birthDate || '',
  }
  const aadRow = { id }
  const payload = await encryptJson(plain, key, patientAad(aadRow))

  if (mode === 'insert') {
    const { data, error } = await supabase
      .from('v3_patients')
      .insert({
        id,
        created_by: userId,
        payload,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .select('id,payload,created_at,updated_at,deleted_at')
      .single()

    if (error) throw error
    return { patient: patientFromPlain(data, plain), conflict: null }
  }

  const current = await getRow(
    'v3_patients',
    'id,payload,created_at,updated_at,deleted_at',
    id,
  )
  if (!current) throw new Error('V3-Patient wurde nicht gefunden.')

  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) {
    return { patient: null, conflict: await conflictPatient(current, key) }
  }

  let query = supabase
    .from('v3_patients')
    .update({ payload, updated_at: now })
    .eq('id', id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,payload,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    const latest = await getRow(
      'v3_patients',
      'id,payload,created_at,updated_at,deleted_at',
      id,
    )
    return { patient: null, conflict: await conflictPatient(latest, key) }
  }

  return { patient: patientFromPlain(data, plain), conflict: null }
}

export async function saveV3Prescription(
  form,
  patientId,
  userId,
  key,
  expectedUpdatedAt = '',
  mode = 'update',
) {
  const id = form.id || crypto.randomUUID()
  const now = new Date().toISOString()
  const rowForAad = { id, patient_id: patientId }
  const plain = {
    prescriptionDate: form.issueDate || '',
    remedy: form.remedy?.trim() || '',
  }
  const payload = await encryptJson(plain, key, prescriptionAad(rowForAad))

  if (mode === 'insert') {
    const { data, error } = await supabase
      .from('v3_prescriptions')
      .insert({
        id,
        created_by: userId,
        patient_id: patientId,
        payload,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .select('id,patient_id,payload,created_at,updated_at,deleted_at')
      .single()

    if (error) throw error
    return { prescription: prescriptionFromPlain(data, plain), conflict: null }
  }

  const current = await getRow(
    'v3_prescriptions',
    'id,patient_id,payload,created_at,updated_at,deleted_at',
    id,
  )
  if (!current) throw new Error('V3-Verordnung wurde nicht gefunden.')

  if (current.patient_id !== patientId) {
    throw new Error('V3-Verordnung ist einem anderen Patienten zugeordnet.')
  }
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) {
    return { prescription: null, conflict: await conflictPrescription(current, key) }
  }

  let query = supabase
    .from('v3_prescriptions')
    .update({ payload, updated_at: now })
    .eq('id', id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,patient_id,payload,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    const latest = await getRow(
      'v3_prescriptions',
      'id,patient_id,payload,created_at,updated_at,deleted_at',
      id,
    )
    return {
      prescription: null,
      conflict: await conflictPrescription(latest, key),
    }
  }

  return {
    prescription: prescriptionFromPlain(data, plain),
    conflict: null,
  }
}

export async function saveV3DocEntry(
  form,
  prescriptionId,
  userId,
  key,
  expectedUpdatedAt = '',
  mode = 'update',
) {
  const id = form.id || crypto.randomUUID()
  const now = new Date().toISOString()
  const rowForAad = { id, prescription_id: prescriptionId }
  const plain = {
    entryDate: form.entryDate || '',
    text: form.text?.trim() || '',
  }
  const payload = await encryptJson(plain, key, docEntryAad(rowForAad))

  if (mode === 'insert') {
    const { data, error } = await supabase
      .from('v3_doc_entries')
      .insert({
        id,
        created_by: userId,
        prescription_id: prescriptionId,
        payload,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .select('id,prescription_id,payload,created_at,updated_at,deleted_at')
      .single()

    if (error) throw error
    return { entry: docFromPlain(data, plain), conflict: null }
  }

  const current = await getRow(
    'v3_doc_entries',
    'id,prescription_id,payload,created_at,updated_at,deleted_at',
    id,
  )
  if (!current) throw new Error('V3-Doku wurde nicht gefunden.')

  if (current.prescription_id !== prescriptionId) {
    throw new Error('V3-Doku ist einer anderen Verordnung zugeordnet.')
  }
  if (expectedUpdatedAt && current.updated_at !== expectedUpdatedAt) {
    return { entry: null, conflict: await conflictDoc(current, key) }
  }

  let query = supabase
    .from('v3_doc_entries')
    .update({ payload, updated_at: now })
    .eq('id', id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,prescription_id,payload,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    const latest = await getRow(
      'v3_doc_entries',
      'id,prescription_id,payload,created_at,updated_at,deleted_at',
      id,
    )
    return { entry: null, conflict: await conflictDoc(latest, key) }
  }

  return { entry: docFromPlain(data, plain), conflict: null }
}

export async function syncV3DocEntryImages(
  docEntryId,
  images,
  userId,
  key,
  baseImageIds = [],
) {
  const { data: currentRows, error } = await supabase
    .from('v3_doc_entry_images')
    .select('id,doc_entry_id,metadata,storage_path,encrypted_size,created_at,updated_at,deleted_at')
    .eq('doc_entry_id', docEntryId)
  if (error) throw error

  const currentById = new Map((currentRows || []).map(row => [row.id, row]))
  const wantedIds = new Set((images || []).map(image => image.id))
  const baseIds = new Set(baseImageIds || [])

  for (const row of currentRows || []) {
    if (!baseIds.has(row.id) || wantedIds.has(row.id) || row.deleted_at) continue

    const now = new Date().toISOString()
    const { error: rowError } = await supabase
      .from('v3_doc_entry_images')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', row.id)
    if (rowError) throw rowError
    await removeStorageFile(row.storage_path)
  }

  for (const image of images || []) {
    const existing = currentById.get(image.id)
    if (existing && !existing.deleted_at) continue

    const now = new Date().toISOString()
    const rowForAad = { id: image.id, doc_entry_id: docEntryId }
    const plainBytes = dataUrlToBytes(image.dataUrl)
    const storagePath = `${userId}/v3-encrypted/doc-images/${image.id}.bin`
    const file = await uploadEncryptedFile(
      storagePath,
      plainBytes,
      key,
      imageBytesAad(rowForAad),
    )
    const metadataPlain = {
      fileName: image.fileName || 'Bild',
      mimeType: image.mimeType || 'image/jpeg',
      hasFile: true,
      sourceFileMissing: false,
      sha256: file.sha256,
      originalSize: file.originalSize,
      fileCrypto: file.fileCrypto,
    }
    const metadata = await encryptJson(
      metadataPlain,
      key,
      imageMetadataAad(rowForAad),
    )

    const { error: insertError } = await supabase
      .from('v3_doc_entry_images')
      .upsert({
        id: image.id,
        created_by: userId,
        doc_entry_id: docEntryId,
        metadata,
        storage_path: storagePath,
        encrypted_size: file.encryptedSize,
        created_at: existing?.created_at || now,
        updated_at: now,
        deleted_at: null,
      }, { onConflict: 'id' })

    if (insertError) {
      await removeStorageFile(storagePath).catch(() => {})
      throw insertError
    }
  }
}

export async function saveV3PatientDocument(
  form,
  patientId,
  userId,
  key,
  expectedUpdatedAt = '',
) {
  const id = form.id || crypto.randomUUID()
  const now = new Date().toISOString()
  const existing = form.id
    ? await getRow(
        'v3_patient_documents',
        'id,patient_id,metadata,storage_path,encrypted_size,created_at,updated_at,deleted_at',
        id,
      )
    : null

  if (existing && expectedUpdatedAt && existing.updated_at !== expectedUpdatedAt) {
    const metadata = await decryptJson(
      existing.metadata,
      key,
      patientDocumentMetadataAad(existing),
    )
    return {
      document: null,
      conflict: {
        id: existing.id,
        patientId: existing.patient_id,
        documentDate: metadata.documentDate || '',
        title: metadata.title || '',
        note: metadata.note || '',
        file: metadata.hasFile ? {
          fileName: metadata.fileName || 'Datei',
          mimeType: metadata.mimeType || 'application/octet-stream',
          storagePath: existing.storage_path || '',
          dataUrl: '',
          cryptoMeta: metadata.fileCrypto || null,
        } : null,
        createdAt: existing.created_at || '',
        updatedAt: existing.updated_at || '',
        deletedAt: existing.deleted_at || '',
      },
    }
  }

  const rowForAad = { id, patient_id: patientId }
  let storagePath = existing?.storage_path || ''
  let encryptedSize = Number(existing?.encrypted_size || 0)
  let fileMeta = existing
    ? await decryptJson(
        existing.metadata,
        key,
        patientDocumentMetadataAad(existing),
      )
    : null

  if (!form.file && storagePath) {
    await removeStorageFile(storagePath)
    storagePath = ''
    encryptedSize = 0
    fileMeta = null
  } else if (form.file?.dataUrl && !form.file?.storagePath) {
    const plainBytes = dataUrlToBytes(form.file.dataUrl)
    storagePath = `${userId}/v3-encrypted/patient-documents/${id}.bin`
    const uploaded = await uploadEncryptedFile(
      storagePath,
      plainBytes,
      key,
      patientDocumentBytesAad(rowForAad),
    )
    encryptedSize = uploaded.encryptedSize
    fileMeta = {
      fileName: form.file.fileName || 'Datei',
      mimeType: form.file.mimeType || 'application/octet-stream',
      hasFile: true,
      sourceFileMissing: false,
      sha256: uploaded.sha256,
      originalSize: uploaded.originalSize,
      fileCrypto: uploaded.fileCrypto,
    }
  } else if (form.file?.storagePath && fileMeta) {
    fileMeta = {
      ...fileMeta,
      fileName: form.file.fileName || fileMeta.fileName || 'Datei',
      mimeType: form.file.mimeType || fileMeta.mimeType || 'application/octet-stream',
      hasFile: true,
    }
  }

  const metadataPlain = {
    documentDate: form.documentDate || '',
    title: form.title?.trim() || '',
    note: form.note?.trim() || '',
    fileName: fileMeta?.fileName || '',
    mimeType: fileMeta?.mimeType || 'application/octet-stream',
    hasFile: Boolean(storagePath),
    sourceFileMissing: false,
    sha256: fileMeta?.sha256 || '',
    originalSize: fileMeta?.originalSize || 0,
    fileCrypto: fileMeta?.fileCrypto || null,
  }
  const metadata = await encryptJson(
    metadataPlain,
    key,
    patientDocumentMetadataAad(rowForAad),
  )

  if (!existing) {
    const { data, error } = await supabase
      .from('v3_patient_documents')
      .insert({
        id,
        created_by: userId,
        patient_id: patientId,
        metadata,
        storage_path: storagePath || null,
        encrypted_size: encryptedSize,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .select('id,patient_id,metadata,storage_path,created_at,updated_at,deleted_at')
      .single()
    if (error) throw error

    return {
      document: {
        id: data.id,
        patientId: data.patient_id,
        documentDate: metadataPlain.documentDate,
        title: metadataPlain.title,
        note: metadataPlain.note,
        file: metadataPlain.hasFile ? {
          fileName: metadataPlain.fileName,
          mimeType: metadataPlain.mimeType,
          storagePath: data.storage_path || '',
          dataUrl: '',
          cryptoMeta: metadataPlain.fileCrypto,
        } : null,
        createdAt: data.created_at || '',
        updatedAt: data.updated_at || '',
        deletedAt: data.deleted_at || '',
      },
      conflict: null,
    }
  }

  let query = supabase
    .from('v3_patient_documents')
    .update({
      metadata,
      storage_path: storagePath || null,
      encrypted_size: encryptedSize,
      updated_at: now,
    })
    .eq('id', id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,patient_id,metadata,storage_path,created_at,updated_at,deleted_at')
    .maybeSingle()
  if (error) throw error

  if (!data) {
    const latest = await getRow(
      'v3_patient_documents',
      'id,patient_id,metadata,storage_path,created_at,updated_at,deleted_at',
      id,
    )
    const latestMeta = latest
      ? await decryptJson(latest.metadata, key, patientDocumentMetadataAad(latest))
      : null
    return {
      document: null,
      conflict: latest ? {
        id: latest.id,
        patientId: latest.patient_id,
        documentDate: latestMeta?.documentDate || '',
        title: latestMeta?.title || '',
        note: latestMeta?.note || '',
        file: latestMeta?.hasFile ? {
          fileName: latestMeta.fileName || 'Datei',
          mimeType: latestMeta.mimeType || 'application/octet-stream',
          storagePath: latest.storage_path || '',
          dataUrl: '',
          cryptoMeta: latestMeta.fileCrypto || null,
        } : null,
        createdAt: latest.created_at || '',
        updatedAt: latest.updated_at || '',
        deletedAt: latest.deleted_at || '',
      } : null,
    }
  }

  return {
    document: {
      id: data.id,
      patientId: data.patient_id,
      documentDate: metadataPlain.documentDate,
      title: metadataPlain.title,
      note: metadataPlain.note,
      file: metadataPlain.hasFile ? {
        fileName: metadataPlain.fileName,
        mimeType: metadataPlain.mimeType,
        storagePath: data.storage_path || '',
        dataUrl: '',
        cryptoMeta: metadataPlain.fileCrypto,
      } : null,
      createdAt: data.created_at || '',
      updatedAt: data.updated_at || '',
      deletedAt: data.deleted_at || '',
    },
    conflict: null,
  }
}

export async function saveV3LibraryItem(form, category, userId, key) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const rowForAad = { id }
  const plainBytes = dataUrlToBytes(form.file?.dataUrl)
  const storagePath = `${userId}/v3-encrypted/library/${id}.bin`
  const file = await uploadEncryptedFile(
    storagePath,
    plainBytes,
    key,
    libraryBytesAad(rowForAad),
  )

  const payloadPlain = {
    category,
    title: form.title?.trim() || '',
    description: form.note?.trim() || '',
    fileName: form.file?.fileName || 'Datei',
    mimeType: form.file?.mimeType || 'application/octet-stream',
    hasFile: true,
    sourceFileMissing: false,
    sha256: file.sha256,
    originalSize: file.originalSize,
    fileCrypto: file.fileCrypto,
  }
  const payload = await encryptJson(
    payloadPlain,
    key,
    libraryPayloadAad(rowForAad),
  )

  const { data, error } = await supabase
    .from('v3_library_items')
    .insert({
      id,
      created_by: userId,
      payload,
      storage_path: storagePath,
      encrypted_size: file.encryptedSize,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .select('id,payload,storage_path,created_at,updated_at,deleted_at')
    .single()

  if (error) {
    await removeStorageFile(storagePath).catch(() => {})
    throw error
  }

  return {
    id: data.id,
    category,
    title: payloadPlain.title,
    note: payloadPlain.description,
    file: {
      fileName: payloadPlain.fileName,
      mimeType: payloadPlain.mimeType,
      storagePath: data.storage_path,
      dataUrl: '',
      cryptoMeta: payloadPlain.fileCrypto,
    },
    createdAt: data.created_at || '',
    updatedAt: data.updated_at || '',
    deletedAt: data.deleted_at || '',
  }
}
