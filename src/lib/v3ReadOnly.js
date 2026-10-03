import { supabase } from './supabase'
import {
  decryptPracticeBytesRaw,
  decryptPracticeText,
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

async function decryptJson(envelope, practiceKey, aad) {
  return JSON.parse(await decryptPracticeText(envelope, practiceKey, aad))
}

function bytesToDataUrl(bytes, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Entschlüsselte Datei konnte nicht gelesen werden.'))
    reader.readAsDataURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' }))
  })
}

async function loadEncryptedFile(storagePath, cryptoMeta, practiceKey, aad, mimeType) {
  if (!storagePath) return ''

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath)

  if (error) throw error

  const encryptedBytes = new Uint8Array(await data.arrayBuffer())
  const plainBytes = await decryptPracticeBytesRaw(
    encryptedBytes,
    practiceKey,
    cryptoMeta?.iv,
    aad,
  )

  return bytesToDataUrl(plainBytes, mimeType)
}

export async function listV3ActivePatients(practiceKey) {
  const { data, error } = await supabase
    .from('v3_patients')
    .select('id,payload,created_at,updated_at,deleted_at')
    .is('deleted_at', null)

  if (error) throw error

  const items = await Promise.all((data || []).map(async row => {
    const plain = await decryptJson(row.payload, practiceKey, patientAad(row))
    return {
      id: row.id,
      firstName: plain.firstName || '',
      lastName: plain.lastName || '',
      birthDate: plain.birthDate || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))

  return items.sort((a, b) =>
    a.lastName.localeCompare(b.lastName, 'de') ||
    a.firstName.localeCompare(b.firstName, 'de')
  )
}

export async function listV3DeletedPatients(practiceKey) {
  const { data, error } = await supabase
    .from('v3_patients')
    .select('id,payload,created_at,updated_at,deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (error) throw error

  return Promise.all((data || []).map(async row => {
    const plain = await decryptJson(row.payload, practiceKey, patientAad(row))
    return {
      id: row.id,
      firstName: plain.firstName || '',
      lastName: plain.lastName || '',
      birthDate: plain.birthDate || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))
}

export async function listV3DeletedPatients(practiceKey) {
  const { data, error } = await supabase
    .from('v3_patients')
    .select('id,payload,created_at,updated_at,deleted_at')
    .not('deleted_at', 'is', null)

  if (error) throw error

  const items = await Promise.all((data || []).map(async row => {
    const plain = await decryptJson(row.payload, practiceKey, patientAad(row))
    return {
      id: row.id,
      firstName: plain.firstName || '',
      lastName: plain.lastName || '',
      birthDate: plain.birthDate || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))

  return items.sort((a, b) =>
    (b.deletedAt || '').localeCompare(a.deletedAt || '')
  )
}

export async function getV3Patient(patientId, practiceKey) {
  const { data, error } = await supabase
    .from('v3_patients')
    .select('id,payload,created_at,updated_at,deleted_at')
    .eq('id', patientId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const plain = await decryptJson(data.payload, practiceKey, patientAad(data))
  return {
    id: data.id,
    firstName: plain.firstName || '',
    lastName: plain.lastName || '',
    birthDate: plain.birthDate || '',
    createdAt: data.created_at || '',
    updatedAt: data.updated_at || '',
    deletedAt: data.deleted_at || '',
  }
}

export async function listV3PrescriptionsForPatient(patientId, practiceKey) {
  const { data, error } = await supabase
    .from('v3_prescriptions')
    .select('id,patient_id,payload,created_at,updated_at,deleted_at')
    .eq('patient_id', patientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error

  const items = await Promise.all((data || []).map(async row => {
    const plain = await decryptJson(row.payload, practiceKey, prescriptionAad(row))
    return {
      id: row.id,
      patientId: row.patient_id,
      issueDate: plain.prescriptionDate || '',
      remedy: plain.remedy || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))

  return items.sort((a, b) =>
    (b.issueDate || '').localeCompare(a.issueDate || '') ||
    (b.createdAt || '').localeCompare(a.createdAt || '')
  )
}

export async function listV3DocEntriesForPrescription(prescriptionId, practiceKey) {
  const { data, error } = await supabase
    .from('v3_doc_entries')
    .select('id,prescription_id,payload,created_at,updated_at,deleted_at')
    .eq('prescription_id', prescriptionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error

  const items = await Promise.all((data || []).map(async row => {
    const plain = await decryptJson(row.payload, practiceKey, docEntryAad(row))
    return {
      id: row.id,
      prescriptionId: row.prescription_id,
      entryDate: plain.entryDate || '',
      text: plain.text || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))

  return items.sort((a, b) =>
    (b.entryDate || '').localeCompare(a.entryDate || '') ||
    (b.createdAt || '').localeCompare(a.createdAt || '')
  )
}

export async function getV3DocEntryImageCountMap(entryIds) {
  const map = Object.fromEntries((entryIds || []).map(id => [id, 0]))
  if (!entryIds?.length) return map

  const { data, error } = await supabase
    .from('v3_doc_entry_images')
    .select('doc_entry_id')
    .in('doc_entry_id', entryIds)
    .is('deleted_at', null)

  if (error) throw error

  for (const row of data || []) {
    map[row.doc_entry_id] = (map[row.doc_entry_id] || 0) + 1
  }

  return map
}

export async function loadV3DocEntryImages(docEntryId, practiceKey) {
  const { data, error } = await supabase
    .from('v3_doc_entry_images')
    .select('id,doc_entry_id,metadata,storage_path,created_at,updated_at,deleted_at')
    .eq('doc_entry_id', docEntryId)
    .is('deleted_at', null)
    .order('created_at')

  if (error) throw error

  return Promise.all((data || []).map(async row => {
    const metadata = await decryptJson(
      row.metadata,
      practiceKey,
      imageMetadataAad(row),
    )

    const dataUrl = metadata.hasFile
      ? await loadEncryptedFile(
          row.storage_path,
          metadata.fileCrypto,
          practiceKey,
          imageBytesAad(row),
          metadata.mimeType,
        )
      : ''

    return {
      id: row.id,
      docEntryId: row.doc_entry_id,
      fileName: metadata.fileName || 'Bild',
      mimeType: metadata.mimeType || 'image/jpeg',
      dataUrl,
      storagePath: row.storage_path || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
    }
  }))
}

export async function listV3PatientDocumentsForPatient(patientId, practiceKey) {
  const { data, error } = await supabase
    .from('v3_patient_documents')
    .select('id,patient_id,metadata,storage_path,created_at,updated_at,deleted_at')
    .eq('patient_id', patientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error

  return Promise.all((data || []).map(async row => {
    const metadata = await decryptJson(
      row.metadata,
      practiceKey,
      patientDocumentMetadataAad(row),
    )

    return {
      id: row.id,
      patientId: row.patient_id,
      documentDate: metadata.documentDate || '',
      title: metadata.title || '',
      note: metadata.note || '',
      file: metadata.hasFile ? {
        fileName: metadata.fileName || 'Datei',
        mimeType: metadata.mimeType || 'application/octet-stream',
        storagePath: row.storage_path || '',
        dataUrl: '',
        cryptoMeta: metadata.fileCrypto || null,
      } : null,
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))
}

export async function loadV3PatientDocumentFile(document, practiceKey) {
  if (!document?.file?.storagePath) return document

  const row = {
    id: document.id,
    patient_id: document.patientId,
  }
  const dataUrl = await loadEncryptedFile(
    document.file.storagePath,
    document.file.cryptoMeta,
    practiceKey,
    patientDocumentBytesAad(row),
    document.file.mimeType,
  )

  return {
    ...document,
    file: {
      ...document.file,
      dataUrl,
    },
  }
}

export async function listV3LibraryItems(category, practiceKey) {
  const { data, error } = await supabase
    .from('v3_library_items')
    .select('id,payload,storage_path,created_at,updated_at,deleted_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error

  const all = await Promise.all((data || []).map(async row => {
    const plain = await decryptJson(row.payload, practiceKey, libraryPayloadAad(row))
    return {
      id: row.id,
      category: plain.category || '',
      title: plain.title || '',
      note: plain.description || '',
      file: plain.hasFile ? {
        fileName: plain.fileName || 'Datei',
        mimeType: plain.mimeType || 'application/octet-stream',
        storagePath: row.storage_path || '',
        dataUrl: '',
        cryptoMeta: plain.fileCrypto || null,
      } : null,
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      deletedAt: row.deleted_at || '',
    }
  }))

  return all.filter(item => item.category === category)
}

export async function loadV3LibraryItemFile(item, practiceKey) {
  if (!item?.file?.storagePath) return item

  const row = { id: item.id }
  const dataUrl = await loadEncryptedFile(
    item.file.storagePath,
    item.file.cryptoMeta,
    practiceKey,
    libraryBytesAad(row),
    item.file.mimeType,
  )

  return {
    ...item,
    file: {
      ...item.file,
      dataUrl,
    },
  }
}
