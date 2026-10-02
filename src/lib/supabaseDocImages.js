import { supabase } from './supabase'

const BUCKET = 'doku-vault'

function rowToImageMeta(row) {
  return {
    id: row.id,
    docEntryId: row.doc_entry_id,
    fileName: row.file_name || 'Bild',
    mimeType: row.mime_type || 'image/jpeg',
    storagePath: row.storage_path || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    deletedAt: row.deleted_at || '',
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = String(dataUrl || '').split(',')
  if (!base64) throw new Error('Bilddaten sind ungültig.')
  const match = header.match(/data:([^;]+)/)
  const mimeType = match?.[1] || 'image/jpeg'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

function blobToDataUrl(blob, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'))
    reader.readAsDataURL(new Blob([blob], { type: mimeType || 'image/jpeg' }))
  })
}

export async function listDocEntryImageMeta(docEntryId) {
  const { data, error } = await supabase
    .from('doc_entry_images')
    .select('id,doc_entry_id,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
    .eq('doc_entry_id', docEntryId)
    .is('deleted_at', null)
    .order('created_at')

  if (error) throw error
  return (data || []).map(rowToImageMeta)
}

export async function loadDocEntryImagesFromSupabase(docEntryId) {
  const items = await listDocEntryImageMeta(docEntryId)

  return Promise.all(items.map(async item => {
    const { data, error } = await supabase.storage.from(BUCKET).download(item.storagePath)
    if (error) throw error
    const dataUrl = await blobToDataUrl(data, item.mimeType)

    return {
      id: item.id,
      docEntryId: item.docEntryId,
      fileName: item.fileName,
      mimeType: item.mimeType,
      dataUrl,
      storagePath: item.storagePath,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }))
}

export async function getDocEntryImageCountMapFromSupabase(entryIds) {
  const map = Object.fromEntries((entryIds || []).map(id => [id, 0]))
  if (!entryIds?.length) return map

  const { data, error } = await supabase
    .from('doc_entry_images')
    .select('doc_entry_id')
    .in('doc_entry_id', entryIds)
    .is('deleted_at', null)

  if (error) throw error
  for (const row of data || []) {
    map[row.doc_entry_id] = (map[row.doc_entry_id] || 0) + 1
  }
  return map
}

export async function syncDocEntryImagesToSupabase(docEntryId, images, userId, baseImageIds = []) {
  const existing = await listDocEntryImageMeta(docEntryId)
  const wantedIds = new Set((images || []).map(image => image.id))
  const baseIds = new Set(baseImageIds || [])

  // Nur Bilder löschen, die beim Öffnen dieses Editors tatsächlich vorhanden waren
  // und die hier bewusst entfernt wurden. Remote neu hinzugekommene Bilder bleiben erhalten.
  for (const item of existing) {
    if (!baseIds.has(item.id) || wantedIds.has(item.id)) continue

    const deletedAt = new Date().toISOString()
    const { error: rowError } = await supabase
      .from('doc_entry_images')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', item.id)

    if (rowError) throw rowError

    if (item.storagePath) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([item.storagePath])
      if (removeError) throw removeError
    }
  }

  for (const image of images || []) {
    if (image.storagePath) continue

    const mimeType = image.mimeType || 'image/jpeg'
    const path = `${userId}/v2-media/doc-images/${docEntryId}/${image.id}.bin`
    const blob = dataUrlToBlob(image.dataUrl)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, {
        cacheControl: '3600',
        contentType: 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) throw uploadError

    const { error: rowError } = await supabase
      .from('doc_entry_images')
      .insert({
        id: image.id,
        doc_entry_id: docEntryId,
        file_name: image.fileName || 'Bild',
        mime_type: mimeType,
        storage_path: path,
        created_by: userId,
      })

    if (rowError) {
      await supabase.storage.from(BUCKET).remove([path])
      throw rowError
    }
  }

  return loadDocEntryImagesFromSupabase(docEntryId)
}
