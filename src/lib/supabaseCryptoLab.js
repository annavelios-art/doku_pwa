import { supabase } from './supabase'

const FANTASY_KIND = 'fantasy_patient_v1'

async function maybeSingleId(table, userId) {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('created_by', userId)
    .maybeSingle()

  if (error) throw error
  return data?.id || ''
}

export async function saveEncryptedFantasyPatient(payload, userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!payload) throw new Error('Kein verschlüsselter Testdatensatz vorhanden.')

  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('crypto_lab_records')
    .upsert(
      {
        created_by: userId,
        kind: FANTASY_KIND,
        payload,
        updated_at: now,
      },
      { onConflict: 'created_by,kind' },
    )
    .select('id, kind, payload, created_at, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function loadEncryptedFantasyPatient() {
  const { data, error } = await supabase
    .from('crypto_lab_records')
    .select('id, kind, payload, created_at, updated_at')
    .eq('kind', FANTASY_KIND)
    .maybeSingle()

  if (error) throw error
  return data || null
}

export async function getEncryptedMiniPracticeIds(userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const [existingPatientId, existingPrescriptionId, existingDocEntryId] = await Promise.all([
    maybeSingleId('crypto_lab_patients', userId),
    maybeSingleId('crypto_lab_prescriptions', userId),
    maybeSingleId('crypto_lab_doc_entries', userId),
  ])

  return {
    patientId: existingPatientId || crypto.randomUUID(),
    prescriptionId: existingPrescriptionId || crypto.randomUUID(),
    docEntryId: existingDocEntryId || crypto.randomUUID(),
  }
}

export async function saveEncryptedMiniPractice({
  patientId,
  patientPayload,
  prescriptionId,
  prescriptionPayload,
  docEntryId,
  docEntryPayload,
}, userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const now = new Date().toISOString()

  const { data: patient, error: patientError } = await supabase
    .from('crypto_lab_patients')
    .upsert(
      {
        id: patientId,
        created_by: userId,
        payload: patientPayload,
        updated_at: now,
      },
      { onConflict: 'id' },
    )
    .select('id, payload, created_at, updated_at')
    .single()

  if (patientError) throw patientError

  const { data: prescription, error: prescriptionError } = await supabase
    .from('crypto_lab_prescriptions')
    .upsert(
      {
        id: prescriptionId,
        created_by: userId,
        patient_id: patient.id,
        payload: prescriptionPayload,
        updated_at: now,
      },
      { onConflict: 'id' },
    )
    .select('id, patient_id, payload, created_at, updated_at')
    .single()

  if (prescriptionError) throw prescriptionError

  const { data: docEntry, error: docEntryError } = await supabase
    .from('crypto_lab_doc_entries')
    .upsert(
      {
        id: docEntryId,
        created_by: userId,
        prescription_id: prescription.id,
        payload: docEntryPayload,
        updated_at: now,
      },
      { onConflict: 'id' },
    )
    .select('id, prescription_id, payload, created_at, updated_at')
    .single()

  if (docEntryError) throw docEntryError

  return { patient, prescription, docEntry }
}

export async function loadEncryptedMiniPractice(userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const [patientResult, prescriptionResult, docEntryResult] = await Promise.all([
    supabase
      .from('crypto_lab_patients')
      .select('id, payload, created_at, updated_at')
      .eq('created_by', userId)
      .maybeSingle(),
    supabase
      .from('crypto_lab_prescriptions')
      .select('id, patient_id, payload, created_at, updated_at')
      .eq('created_by', userId)
      .maybeSingle(),
    supabase
      .from('crypto_lab_doc_entries')
      .select('id, prescription_id, payload, created_at, updated_at')
      .eq('created_by', userId)
      .maybeSingle(),
  ])

  if (patientResult.error) throw patientResult.error
  if (prescriptionResult.error) throw prescriptionResult.error
  if (docEntryResult.error) throw docEntryResult.error

  if (!patientResult.data || !prescriptionResult.data || !docEntryResult.data) {
    return null
  }

  return {
    patient: patientResult.data,
    prescription: prescriptionResult.data,
    docEntry: docEntryResult.data,
  }
}


const CRYPTO_LAB_BUCKET = 'doku-vault'

export async function getEncryptedLabFileId(userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const { data, error } = await supabase
    .from('crypto_lab_files')
    .select('id')
    .eq('created_by', userId)
    .maybeSingle()

  if (error) throw error
  return data?.id || crypto.randomUUID()
}

export async function saveEncryptedLabFile({
  id,
  docEntryId,
  metadata,
  storageEnvelope,
}, userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!id || !docEntryId) throw new Error('Technische Datei-Verknüpfung fehlt.')

  const storagePath = `${userId}/v2-crypto-lab/files/${id}.enc`
  const storageText = JSON.stringify(storageEnvelope)
  const storageBytes = new TextEncoder().encode(storageText)
  const storageBlob = new Blob([storageBytes], { type: 'application/octet-stream' })

  const { error: uploadError } = await supabase.storage
    .from(CRYPTO_LAB_BUCKET)
    .upload(storagePath, storageBlob, {
      contentType: 'application/octet-stream',
      upsert: true,
    })

  if (uploadError) throw uploadError

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('crypto_lab_files')
    .upsert(
      {
        id,
        created_by: userId,
        doc_entry_id: docEntryId,
        storage_path: storagePath,
        metadata,
        encrypted_size: storageBytes.byteLength,
        updated_at: now,
      },
      { onConflict: 'id' },
    )
    .select('id, doc_entry_id, storage_path, metadata, encrypted_size, created_at, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function loadEncryptedLabFile(userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const { data: row, error: rowError } = await supabase
    .from('crypto_lab_files')
    .select('id, doc_entry_id, storage_path, metadata, encrypted_size, created_at, updated_at')
    .eq('created_by', userId)
    .maybeSingle()

  if (rowError) throw rowError
  if (!row) return null

  const { data: blob, error: downloadError } = await supabase.storage
    .from(CRYPTO_LAB_BUCKET)
    .download(row.storage_path)

  if (downloadError) throw downloadError

  const storageEnvelope = JSON.parse(await blob.text())
  return { row, storageEnvelope }
}
