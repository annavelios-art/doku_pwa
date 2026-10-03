import { supabase } from './supabase'

const BUCKET = 'doku-vault'

export function libraryItemFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    category: row.category || '',
    title: row.title || '',
    note: row.description || '',
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

export async function listLibraryItems(category) {
  const { data, error } = await supabase
    .from('library_items')
    .select('id,category,title,description,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
    .eq('category', category)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []).map(libraryItemFromRow)
}

export async function loadLibraryItemFile(item) {
  if (!item?.file?.storagePath) return item

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(item.file.storagePath)

  if (error) throw error

  const dataUrl = await blobToDataUrl(data, item.file.mimeType)

  return {
    ...item,
    file: {
      ...item.file,
      dataUrl,
    },
  }
}

export async function saveLibraryItemToSupabase(form, category, userId) {
  const id = crypto.randomUUID()
  let storagePath = ''

  if (form.file?.dataUrl) {
    storagePath = `${userId}/v2-media/library/${category}/${id}-${crypto.randomUUID()}.bin`
    const blob = dataUrlToStorageBlob(form.file.dataUrl)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, blob, {
        cacheControl: '3600',
        contentType: 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) throw uploadError
  }

  const { data, error } = await supabase
    .from('library_items')
    .insert({
      id,
      category,
      title: form.title?.trim() || '',
      description: form.note?.trim() || '',
      file_name: form.file?.fileName || null,
      mime_type: form.file?.mimeType || null,
      storage_path: storagePath || null,
      created_by: userId,
    })
    .select('id,category,title,description,file_name,mime_type,storage_path,created_at,updated_at,deleted_at')
    .single()

  if (error) {
    if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath])
    throw error
  }

  return libraryItemFromRow(data)
}
