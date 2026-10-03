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
