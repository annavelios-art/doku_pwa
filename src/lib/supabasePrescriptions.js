import { supabase } from './supabase'

export function prescriptionFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    patientId: row.patient_id,
    issueDate: row.prescription_date || '',
    remedy: row.remedy || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

export async function listPrescriptionsForPatient(patientId) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('id,patient_id,prescription_date,remedy,created_at,updated_at,deleted_at')
    .eq('patient_id', patientId)
    .is('deleted_at', null)
    .order('prescription_date', { ascending: false })

  if (error) throw error
  return (data || []).map(prescriptionFromRow)
}

export async function getPrescriptionFromSupabase(id) {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('id,patient_id,prescription_date,remedy,created_at,updated_at,deleted_at')
    .eq('id', id)
    .single()

  if (error) throw error
  return prescriptionFromRow(data)
}

export async function savePrescriptionToSupabase(prescription, patientId, userId, expectedUpdatedAt = '', mode = 'auto') {
  if (mode === 'insert' || !prescription.id) {
    const { data, error } = await supabase
      .from('prescriptions')
      .insert({
        id: prescription.id || crypto.randomUUID(),
        patient_id: patientId,
        prescription_date: prescription.issueDate || null,
        remedy: prescription.remedy?.trim() || '',
        created_by: userId,
      })
      .select('id,patient_id,prescription_date,remedy,created_at,updated_at,deleted_at')
      .single()

    if (error) throw error
    return { prescription: prescriptionFromRow(data), conflict: null }
  }

  const updatedAt = new Date().toISOString()
  let query = supabase
    .from('prescriptions')
    .update({
      prescription_date: prescription.issueDate || null,
      remedy: prescription.remedy?.trim() || '',
      updated_at: updatedAt,
    })
    .eq('id', prescription.id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,patient_id,prescription_date,remedy,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error

  if (!data) {
    const current = await getPrescriptionFromSupabase(prescription.id)
    return { prescription: null, conflict: current }
  }

  return { prescription: prescriptionFromRow(data), conflict: null }
}
