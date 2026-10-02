import { supabase } from './supabase'

export function patientFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    birthDate: row.birth_date || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

function rowFromPatient(patient, userId) {
  return {
    id: patient.id || crypto.randomUUID(),
    first_name: patient.firstName?.trim() || '',
    last_name: patient.lastName?.trim() || '',
    birth_date: patient.birthDate || null,
    created_by: userId,
  }
}

export async function listActivePatients() {
  const { data, error } = await supabase
    .from('patients')
    .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
    .is('deleted_at', null)
    .order('last_name')
    .order('first_name')

  if (error) throw error
  return (data || []).map(patientFromRow)
}

export async function listDeletedPatients() {
  const { data, error } = await supabase
    .from('patients')
    .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
    .not('deleted_at', 'is', null)
    .order('last_name')
    .order('first_name')

  if (error) throw error
  return (data || []).map(patientFromRow)
}

export async function getPatientFromSupabase(id) {
  const { data, error } = await supabase
    .from('patients')
    .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
    .eq('id', id)
    .single()

  if (error) throw error
  return patientFromRow(data)
}

export async function savePatientToSupabase(patient, userId, expectedUpdatedAt = '') {
  if (!patient.id) {
    const insertRow = rowFromPatient(patient, userId)
    const { data, error } = await supabase
      .from('patients')
      .insert(insertRow)
      .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
      .single()

    if (error) throw error
    return { patient: patientFromRow(data), conflict: null }
  }

  const updatedAt = new Date().toISOString()
  let query = supabase
    .from('patients')
    .update({
      first_name: patient.firstName?.trim() || '',
      last_name: patient.lastName?.trim() || '',
      birth_date: patient.birthDate || null,
      updated_at: updatedAt,
    })
    .eq('id', patient.id)

  if (expectedUpdatedAt) {
    query = query.eq('updated_at', expectedUpdatedAt)
  }

  const { data, error } = await query
    .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error

  if (!data) {
    const current = await getPatientFromSupabase(patient.id)
    return { patient: null, conflict: current }
  }

  return { patient: patientFromRow(data), conflict: null }
}

export async function softDeletePatientInSupabase(id, expectedUpdatedAt = '') {
  const deletedAt = new Date().toISOString()
  let query = supabase
    .from('patients')
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq('id', id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    const current = await getPatientFromSupabase(id)
    return { patient: null, conflict: current }
  }

  return { patient: patientFromRow(data), conflict: null }
}

export async function restorePatientInSupabase(id) {
  const updatedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('patients')
    .update({ deleted_at: null, updated_at: updatedAt })
    .eq('id', id)
    .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
    .single()

  if (error) throw error
  return patientFromRow(data)
}
