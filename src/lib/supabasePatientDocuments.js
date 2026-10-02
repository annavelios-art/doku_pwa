import { supabase } from './supabase'

const BUCKET = 'doku-vault'

export function patientDocumentFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    patientId: row.patient_id,
    documentDate: row.document_date || '',
    title: row.title || '',
    note: row.note || '',
    file: row.storage_path ? {
      fileName: row.file_name || 'Datei',
      mimeType: row.mime_type || 'application/octet-stream',
      storagePath: row.storage_path,
      dataUrl: '',
    } : null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

function dataUrlToStorageBlob(dataUrl) {
  const [, base64] = String(dataUrl || '').split(',')
  if (!base64) throw new Error('Dateidaten sind ungültig.')

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  return new Blob([bytes], { type: 'application/octet-stream' })
}

function blobToDataUrl(blob, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'))
    reader.readAsDataURL(new Blob([blob], { type: mimeType || 'application/octet-stream' }))
  })
}

async function getDocumentRow(id) {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id,patient_id,document_date,title,note,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
    .eq('id', id)
    .single()

  if (error) throw error
  return patientDocumentFromRow(data)
}

export async function listPatientDocumentsForPatient(patientId) {
  const { data, error } = await supabase
    .from('patient_documents')
    .select('id,patient_id,document_date,title,note,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
    .eq('patient_id', patientId)
    .is('deleted_at', null)
    .order('document_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []).map(rowToDocument)
}

export async function loadPatientDocumentFile(document) {
  if (!document?.file?.storagePath) return document

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(document.file.storagePath)

  if (error) throw error

  const dataUrl = await blobToDataUrl(data, document.file.mimeType)

  return {
    ...document,
    file: {
      ...document.file,
      dataUrl,
    },
  }
}

export async function savePatientDocumentToSupabase(
  form,
  patientId,
  userId,
  expectedUpdatedAt = '',
) {
  const documentId = form.id || crypto.randomUUID()
  const oldDocument = form.id ? await getDocumentRow(form.id) : null

  if (
    oldDocument &&
    expectedUpdatedAt &&
    oldDocument.updatedAt !== expectedUpdatedAt
  ) {
    return { document: null, conflict: oldDocument }
  }

  const oldPath = oldDocument?.file?.storagePath || ''
  let newPath = form.file?.storagePath || ''
  let uploadedPath = ''

  if (form.file?.dataUrl && !form.file?.storagePath) {
    newPath = `${userId}/v2-media/patient-documents/${patientId}/${documentId}-${crypto.randomUUID()}.bin`
    const blob = dataUrlToStorageBlob(form.file.dataUrl)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, blob, {
        cacheControl: '3600',
        contentType: 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) throw uploadError
    uploadedPath = newPath
  }

  const fileName = form.file ? (form.file.fileName || 'Datei') : null
  const mimeType = form.file ? (form.file.mimeType || 'application/octet-stream') : null

  if (!form.id) {
    const { data, error } = await supabase
      .from('patient_documents')
      .insert({
        id: documentId,
        patient_id: patientId,
        document_date: form.documentDate || null,
        title: form.title?.trim() || '',
        note: form.note?.trim() || '',
        file_name: fileName,
        mime_type: mimeType,
        storage_path: newPath || null,
        created_by: userId,
      })
      .select('id,patient_id,document_date,title,note,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
      .single()

    if (error) {
      if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath])
      throw error
    }

    return { document: patientDocumentFromRow(data), conflict: null }
  }

  const updatedAt = new Date().toISOString()
  let query = supabase
    .from('patient_documents')
    .update({
      document_date: form.documentDate || null,
      title: form.title?.trim() || '',
      note: form.note?.trim() || '',
      file_name: fileName,
      mime_type: mimeType,
      storage_path: newPath || null,
      updated_at: updatedAt,
    })
    .eq('id', form.id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,patient_id,document_date,title,note,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) {
    if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath])
    throw error
  }

  if (!data) {
    if (uploadedPath) await supabase.storage.from(BUCKET).remove([uploadedPath])
    const current = await getDocumentRow(form.id)
    return { document: null, conflict: current }
  }

  if (oldPath && oldPath !== newPath) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath])
    if (removeError) throw removeError
  }

  return { document: patientDocumentFromRow(data), conflict: null }
}
