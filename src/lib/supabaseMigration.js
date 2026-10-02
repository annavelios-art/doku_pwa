import { supabase } from './supabase'

const BUCKET = 'doku-vault'

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function fileFromLegacy(item) {
  return item?.file && typeof item.file === 'object' ? item.file : null
}

function hasDataUrl(file) {
  return Boolean(file?.dataUrl && String(file.dataUrl).includes(','))
}

function dataUrlToStorageBlob(dataUrl) {
  const [, base64] = String(dataUrl || '').split(',')
  if (!base64) throw new Error('Dateidaten sind ungültig.')

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  return new Blob([bytes], { type: 'application/octet-stream' })
}

function storagePath(userId, kind, id) {
  return `${userId}/v2-migration/${kind}/${id}.bin`
}

async function uploadLegacyFile(path, file) {
  if (!hasDataUrl(file)) return ''

  const blob = dataUrlToStorageBlob(file.dataUrl)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      cacheControl: '3600',
      contentType: 'application/octet-stream',
      upsert: true,
    })

  if (error) throw error
  return path
}

export function inspectLegacyBackup(backup) {
  const required = ['version', 'exportedAt', 'patients', 'prescriptions', 'documentationEntries', 'images']
  const issues = []

  if (!backup || typeof backup !== 'object') {
    return {
      valid: false,
      blockingIssues: ['Die Datei enthält kein gültiges Backup-Objekt.'],
      counts: {},
      backup: null,
    }
  }

  for (const field of required) {
    if (!(field in backup)) issues.push(`Pflichtfeld fehlt: ${field}`)
  }

  const patients = asArray(backup.patients)
  const prescriptions = asArray(backup.prescriptions)
  const entries = asArray(backup.documentationEntries)
  const images = asArray(backup.images)
  const patientDocuments = asArray(backup.patientDocuments)
  const libraryItems = asArray(backup.libraryItems)

  const patientIds = new Set(patients.map(item => item?.id).filter(Boolean))
  const prescriptionIds = new Set(prescriptions.map(item => item?.id).filter(Boolean))
  const entryIds = new Set(entries.map(item => item?.id).filter(Boolean))

  const missingIds =
    patients.filter(item => !item?.id).length +
    prescriptions.filter(item => !item?.id).length +
    entries.filter(item => !item?.id).length +
    images.filter(item => !item?.id).length +
    patientDocuments.filter(item => !item?.id).length +
    libraryItems.filter(item => !item?.id).length

  if (missingIds) issues.push(`${missingIds} Einträge haben keine ID.`)

  const orphanPrescriptions = prescriptions.filter(item => !item?.patientId || !patientIds.has(item.patientId))
  const orphanEntries = entries.filter(item => !item?.prescriptionId || !prescriptionIds.has(item.prescriptionId))
  const orphanImages = images.filter(item => !item?.docEntryId || !entryIds.has(item.docEntryId))
  const orphanDocuments = patientDocuments.filter(item => !item?.patientId || !patientIds.has(item.patientId))

  if (orphanPrescriptions.length) issues.push(`${orphanPrescriptions.length} Verordnungen haben keinen passenden Patienten.`)
  if (orphanEntries.length) issues.push(`${orphanEntries.length} Doku-Einträge haben keine passende Verordnung.`)
  if (orphanImages.length) issues.push(`${orphanImages.length} Doku-Bilder haben keinen passenden Doku-Eintrag.`)
  if (orphanDocuments.length) issues.push(`${orphanDocuments.length} Befunde haben keinen passenden Patienten.`)

  const imagesWithoutData = images.filter(item => !hasDataUrl(item)).length
  const libraryFilesWithoutData = libraryItems.filter(item => item?.file && !hasDataUrl(fileFromLegacy(item))).length
  const documentFilesWithoutData = patientDocuments.filter(item => item?.file && !hasDataUrl(fileFromLegacy(item))).length

  if (imagesWithoutData) issues.push(`${imagesWithoutData} Doku-Bilder enthalten keine Dateidaten.`)
  if (libraryFilesWithoutData) issues.push(`${libraryFilesWithoutData} Bibliotheksdateien enthalten keine Dateidaten.`)
  if (documentFilesWithoutData) issues.push(`${documentFilesWithoutData} Befund-Dateien enthalten keine Dateidaten.`)

  return {
    valid: issues.length === 0,
    blockingIssues: issues,
    counts: {
      patients: patients.length,
      prescriptions: prescriptions.length,
      documentationEntries: entries.length,
      images: images.length,
      patientDocuments: patientDocuments.length,
      libraryItems: libraryItems.length,
      total:
        patients.length +
        prescriptions.length +
        entries.length +
        images.length +
        patientDocuments.length +
        libraryItems.length,
    },
    exportedAt: backup.exportedAt || '',
    version: backup.version,
    backup,
  }
}

async function upsertRows(table, rows) {
  if (!rows.length) return 0

  const { data, error } = await supabase
    .from(table)
    .upsert(rows, { onConflict: 'id' })
    .select('id')

  if (error) throw error
  return data?.length || 0
}

export async function migrateLegacyBackupToSupabase(backup, userId, onProgress = () => {}) {
  const inspection = inspectLegacyBackup(backup)
  if (!inspection.valid) {
    throw new Error(`Backup-Prüfung fehlgeschlagen: ${inspection.blockingIssues.join(' ')}`)
  }

  const now = new Date().toISOString()
  const patients = asArray(backup.patients)
  const prescriptions = asArray(backup.prescriptions)
  const entries = asArray(backup.documentationEntries)
  const images = asArray(backup.images)
  const patientDocuments = asArray(backup.patientDocuments)
  const libraryItems = asArray(backup.libraryItems)

  const result = {
    patients: 0,
    prescriptions: 0,
    documentationEntries: 0,
    images: 0,
    patientDocuments: 0,
    libraryItems: 0,
  }

  onProgress('Patienten werden übertragen …')
  result.patients = await upsertRows('patients', patients.map(item => ({
    id: item.id,
    first_name: item.firstName?.trim() || '',
    last_name: item.lastName?.trim() || '',
    birth_date: item.birthDate || null,
    created_by: userId,
    created_at: item.createdAt || now,
    updated_at: item.updatedAt || item.createdAt || now,
    deleted_at: item.deletedAt || null,
  })))

  onProgress('Verordnungen werden übertragen …')
  result.prescriptions = await upsertRows('prescriptions', prescriptions.map(item => ({
    id: item.id,
    patient_id: item.patientId,
    prescription_date: item.issueDate || null,
    remedy: item.remedy?.trim() || '',
    created_by: userId,
    created_at: item.createdAt || now,
    updated_at: item.updatedAt || item.createdAt || now,
    deleted_at: item.deletedAt || null,
  })))

  onProgress('Doku-Einträge werden übertragen …')
  result.documentationEntries = await upsertRows('doc_entries', entries.map(item => ({
    id: item.id,
    prescription_id: item.prescriptionId,
    entry_date: item.entryDate || null,
    text: item.text?.trim() || '',
    created_by: userId,
    created_at: item.createdAt || now,
    updated_at: item.updatedAt || item.createdAt || now,
    deleted_at: item.deletedAt || null,
  })))

  for (let index = 0; index < images.length; index += 1) {
    const item = images[index]
    onProgress(`Doku-Bilder: ${index + 1} / ${images.length}`)

    const path = storagePath(userId, 'doc-images', item.id)
    await uploadLegacyFile(path, item)

    result.images += await upsertRows('doc_entry_images', [{
      id: item.id,
      doc_entry_id: item.docEntryId,
      file_name: item.fileName || 'Bild.jpg',
      mime_type: item.mimeType || 'image/jpeg',
      storage_path: path,
      created_by: userId,
      created_at: item.createdAt || now,
      updated_at: item.updatedAt || item.createdAt || now,
      deleted_at: item.deletedAt || null,
    }])
  }

  for (let index = 0; index < patientDocuments.length; index += 1) {
    const item = patientDocuments[index]
    onProgress(`Befunde/Dokumente: ${index + 1} / ${patientDocuments.length}`)

    const file = fileFromLegacy(item)
    const path = file && hasDataUrl(file)
      ? await uploadLegacyFile(storagePath(userId, 'patient-documents', item.id), file)
      : ''

    result.patientDocuments += await upsertRows('patient_documents', [{
      id: item.id,
      patient_id: item.patientId,
      document_date: item.documentDate || null,
      title: item.title?.trim() || '',
      note: item.note?.trim() || '',
      file_name: file?.fileName || null,
      mime_type: file?.mimeType || null,
      storage_path: path || null,
      created_by: userId,
      created_at: item.createdAt || now,
      updated_at: item.updatedAt || item.createdAt || now,
      deleted_at: item.deletedAt || null,
    }])
  }

  for (let index = 0; index < libraryItems.length; index += 1) {
    const item = libraryItems[index]
    onProgress(`Bibliothek: ${index + 1} / ${libraryItems.length}`)

    const file = fileFromLegacy(item)
    const path = file && hasDataUrl(file)
      ? await uploadLegacyFile(storagePath(userId, 'library', item.id), file)
      : ''

    result.libraryItems += await upsertRows('library_items', [{
      id: item.id,
      category: item.category || 'archiv',
      title: item.title?.trim() || '',
      description: item.note?.trim() || '',
      file_name: file?.fileName || null,
      mime_type: file?.mimeType || null,
      storage_path: path || null,
      created_by: userId,
      created_at: item.createdAt || now,
      updated_at: item.updatedAt || item.createdAt || now,
      deleted_at: item.deletedAt || null,
    }])
  }

  onProgress('Migration wird geprüft …')

  const expected = inspection.counts
  const migratedTotal =
    result.patients +
    result.prescriptions +
    result.documentationEntries +
    result.images +
    result.patientDocuments +
    result.libraryItems

  if (migratedTotal !== expected.total) {
    throw new Error(`Prüfung fehlgeschlagen: erwartet ${expected.total}, bestätigt ${migratedTotal} Einträge.`)
  }

  onProgress('Migration vollständig.')
  return { ...result, total: migratedTotal }
}
