import { supabase } from './supabase'

export async function loadV3Keyring(userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const { data, error } = await supabase
    .from('v3_keyring')
    .select('owner_id,crypto_version,password_envelope,recovery_envelope,created_at,updated_at')
    .eq('owner_id', userId)
    .maybeSingle()

  if (error) throw error
  return data || null
}

export async function createV3Keyring({
  userId,
  passwordEnvelope,
  recoveryEnvelope,
}) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')
  if (!passwordEnvelope || !recoveryEnvelope) {
    throw new Error('Praxisschlüssel-Hüllen fehlen.')
  }

  const existing = await loadV3Keyring(userId)
  if (existing) {
    throw new Error('Für diese Praxis ist bereits ein V3-Praxisschlüssel eingerichtet.')
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('v3_keyring')
    .insert({
      owner_id: userId,
      crypto_version: 1,
      password_envelope: passwordEnvelope,
      recovery_envelope: recoveryEnvelope,
      created_at: now,
      updated_at: now,
    })
    .select('owner_id,crypto_version,password_envelope,recovery_envelope,created_at,updated_at')
    .single()

  if (error) throw error
  return data
}

export async function getV3EncryptedCounts(userId) {
  if (!userId) throw new Error('Bitte zuerst bei Supabase anmelden.')

  const tables = [
    ['patients', 'v3_patients'],
    ['prescriptions', 'v3_prescriptions'],
    ['docEntries', 'v3_doc_entries'],
    ['docEntryImages', 'v3_doc_entry_images'],
    ['patientDocuments', 'v3_patient_documents'],
    ['libraryItems', 'v3_library_items'],
  ]

  const results = await Promise.all(
    tables.map(async ([key, table]) => {
      const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId)

      if (error) throw error
      return [key, count || 0]
    }),
  )

  return Object.fromEntries(results)
}
