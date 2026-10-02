import { supabase } from './supabase'

export function docEntryFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    prescriptionId: row.prescription_id,
    entryDate: row.entry_date || '',
    text: row.text || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

export async function listDocEntriesForPrescription(prescriptionId) {
  const { data, error } = await supabase
    .from('doc_entries')
    .select('id,prescription_id,entry_date,text,created_at,updated_at,deleted_at')
    .eq('prescription_id', prescriptionId)
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []).map(docEntryFromRow)
}

export async function getDocEntryFromSupabase(id) {
  const { data, error } = await supabase
    .from('doc_entries')
    .select('id,prescription_id,entry_date,text,created_at,updated_at,deleted_at')
    .eq('id', id)
    .single()

  if (error) throw error
  return docEntryFromRow(data)
}

export async function saveDocEntryToSupabase(entry, prescriptionId, userId, expectedUpdatedAt = '') {
  if (!entry.id) {
    const { data, error } = await supabase
      .from('doc_entries')
      .insert({
        id: crypto.randomUUID(),
        prescription_id: prescriptionId,
        entry_date: entry.entryDate || null,
        text: entry.text?.trim() || '',
        created_by: userId,
      })
      .select('id,prescription_id,entry_date,text,created_at,updated_at,deleted_at')
      .single()

    if (error) throw error
    return { entry: docEntryFromRow(data), conflict: null }
  }

  const updatedAt = new Date().toISOString()
  let query = supabase
    .from('doc_entries')
    .update({
      entry_date: entry.entryDate || null,
      text: entry.text?.trim() || '',
      updated_at: updatedAt,
    })
    .eq('id', entry.id)

  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)

  const { data, error } = await query
    .select('id,prescription_id,entry_date,text,created_at,updated_at,deleted_at')
    .maybeSingle()

  if (error) throw error

  if (!data) {
    const current = await getDocEntryFromSupabase(entry.id)
    return { entry: null, conflict: current }
  }

  return { entry: docEntryFromRow(data), conflict: null }
}
