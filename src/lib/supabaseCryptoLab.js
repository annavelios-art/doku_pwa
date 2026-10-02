import { supabase } from './supabase'

const FANTASY_KIND = 'fantasy_patient_v1'

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
